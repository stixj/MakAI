"""Bounded public HTML readers for Czech portals, with shared normalized output."""

import json
import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from pydantic import HttpUrl

from ..schemas import RawJobOffer
from .base import BaseScraper, ScraperError, validate_limit
from .structured import clean_url, parse_job_detail, posting_to_offer, source_date

logger = logging.getLogger(__name__)
USER_AGENT = "MakAI/0.1 (+personal job-offer reader)"


class HtmlJobScraper(BaseScraper):
    domain: str
    listing_urls: tuple[str, ...]
    detail_pattern: str
    allow_local_time = False

    def __init__(self, listing_urls: tuple[str, ...] | None = None):
        if listing_urls is not None:
            self.listing_urls = listing_urls
        if not self.listing_urls or any(not self._allowed(url) for url in self.listing_urls):
            raise ValueError("Listing URLs must belong to the selected portal.")

    def _allowed(self, url: str) -> bool:
        try:
            parsed = urlsplit(url)
            host = parsed.hostname or ""
            return (parsed.scheme == "https" and not parsed.username and not parsed.password
                    and parsed.port in {None, 443}
                    and (host == self.domain or host.endswith("." + self.domain)))
        except ValueError:
            return False

    def _get(self, client: httpx.Client, url: str) -> httpx.Response:
        for _ in range(6):
            if not self._allowed(url):
                raise ScraperError(f"{self.portal}: neočekávaná cílová adresa.")
            response = client.get(url)
            if response.is_redirect:
                target = response.headers.get("location")
                if not target:
                    raise ScraperError(f"{self.portal}: přesměrování nemá cílovou adresu.")
                url = urljoin(url, target)
                continue
            return response
        raise ScraperError(f"{self.portal}: příliš mnoho přesměrování.")

    def _detail_urls(self, soup: BeautifulSoup, listing_url: str) -> list[str]:
        links = []
        for anchor in soup.select("a[href]"):
            url = clean_url(urljoin(listing_url, anchor["href"]))
            if self._allowed(url) and re.search(self.detail_pattern, urlsplit(url).path):
                links.append(url)
        return list(dict.fromkeys(links))

    def _parse_detail(self, html: str, url: str) -> RawJobOffer | None:
        return parse_job_detail(html, url, self.portal, allow_local_time=self.allow_local_time)

    def fetch_jobs(self, limit: int) -> list[RawJobOffer]:
        validate_limit(limit)
        if not limit:
            return []
        offers = []
        seen = set()
        invalid = 0
        try:
            with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20,
                              follow_redirects=False) as client:
                for start in self.listing_urls:
                    listing_url = start
                    visited = set()
                    for _ in range(10):
                        if listing_url in visited or len(offers) >= limit:
                            break
                        visited.add(listing_url)
                        listing = self._get(client, listing_url)
                        listing.raise_for_status()
                        soup = BeautifulSoup(listing.text, "html.parser")
                        links = self._detail_urls(soup, listing_url)
                        if not links and not re.search(r"(?:0\s+nabídek|žádné\s+nabídky)", soup.get_text(), re.I):
                            raise ScraperError(f"{self.portal}: výpis neobsahuje rozpoznatelné nabídky.")
                        for url in links:
                            if len(offers) >= limit:
                                break
                            if url in seen:
                                continue
                            seen.add(url)
                            response = self._get(client, url)
                            if response.status_code in {404, 410}:
                                continue
                            response.raise_for_status()
                            try:
                                offer = self._parse_detail(response.text, str(response.url))
                                if offer is not None:
                                    # Keep the direct portal URL used for discovery, even
                                    # when the portal redirects to its own career subdomain.
                                    offer = offer.model_copy(update={
                                        "url": HttpUrl(url),
                                        "sources": [{"portal": self.portal, "url": url}],
                                    })
                                    offers.append(offer)
                            except (KeyError, TypeError, ValueError):
                                invalid += 1
                                logger.warning("%s: přeskočen neplatný detail nabídky.", self.portal)
                        next_link = soup.select_one('a[rel~="next"][href]')
                        if next_link is None:
                            break
                        listing_url = urljoin(listing_url, next_link["href"])
        except httpx.HTTPError as exc:
            raise ScraperError(f"Stažení {self.portal} selhalo: {type(exc).__name__}.") from None
        if invalid and not offers:
            raise ScraperError(f"{self.portal}: žádný z nalezených detailů nebyl validní.")
        return offers


class JobsCzScraper(HtmlJobScraper):
    portal = "Jobs.cz"
    domain = "jobs.cz"
    listing_urls = ("https://www.jobs.cz/prace/?q%5B%5D=AI",
                    "https://www.jobs.cz/prace/?q%5B%5D=Python")
    detail_pattern = r"/(?:rpd|fp|pd)/[^/]+"

    def _parse_detail(self, html: str, url: str) -> RawJobOffer | None:
        soup = BeautifulSoup(html, "html.parser")
        if soup.select_one('script[type="application/ld+json"]'):
            return super()._parse_detail(html, url)
        title = soup.select_one("h1")
        body = soup.select_one('[data-test="jd-body-richtext"]')
        if title is None or body is None:
            raise ValueError("Missing server-rendered Jobs.cz detail")
        fields = [node.get_text(" ", strip=True) for node in soup.select('[data-test="jd-info-item"]')]
        company = next((value.removeprefix("Společnost").strip() for value in fields
                        if value.startswith("Společnost ")), None)
        if not company:
            raise ValueError("Missing Jobs.cz company")
        for node in body.select("script, style"):
            node.decompose()
        description = body.get_text("\n", strip=True)
        if not description:
            raise ValueError("Empty Jobs.cz description")
        locations = sorted({node.get_text(" ", strip=True)
                            for node in soup.select('[data-test="jd-info-location"]')})
        salary = next((value for value in fields if value.startswith(("Plat ", "Mzda "))), None)
        date = soup.select_one("time[datetime]")
        return RawJobOffer(
            id="jobs-cz-" + urlsplit(url).path.rstrip("/").split("/")[-1],
            title=title.get_text(" ", strip=True), company=company, url=url,
            raw_description=description + "\n\nPodmínky uvedené zdrojem:\n" + "\n".join(fields),
            location=", ".join(filter(None, locations)) or None,
            salary_raw=salary, published_at=source_date(date["datetime"]) if date else None,
            sources=[{"portal": self.portal, "url": url}],
        )


class PraceCzScraper(HtmlJobScraper):
    portal = "Prace.cz"
    domain = "prace.cz"
    listing_urls = ("https://www.prace.cz/nabidky/",)
    detail_pattern = r"/nabidka/[^/]+"


class JenPraceCzScraper(HtmlJobScraper):
    portal = "JenPrace.cz"
    domain = "jenprace.cz"
    listing_urls = ("https://www.jenprace.cz/nabidky",)
    detail_pattern = r"/nabidka/[^/]+"
    allow_local_time = True


class AtmoskopScraper(HtmlJobScraper):
    portal = "Atmoskop"
    domain = "atmoskop.cz"
    listing_urls = ("https://www.atmoskop.cz/prehled-pracovnich-pozic",)
    detail_pattern = r"/nabidka-prace/[^/]+"

    def _parse_detail(self, html: str, url: str) -> RawJobOffer | None:
        soup = BeautifulSoup(html, "html.parser")
        script = soup.select_one("#__NEXT_DATA__")
        if script is None:
            return super()._parse_detail(html, url)
        root = json.loads(script.get_text())["props"]["pageProps"]["initialApolloState"]["ROOT_QUERY"]
        detail_id = urlsplit(url).path.rstrip("/").split("/")[-1]
        detail = next((value for key, value in root.items()
                      if key.startswith("advertComposerJobDetail(")
                      and isinstance(value, dict) and value.get("advertId") == detail_id), None)
        if detail is None:
            raise ValueError("Missing Atmoskop job detail")
        posting = {
            "title": detail["title"], "description": detail["content"],
            "hiringOrganization": {"name": detail["companyName"]},
            "datePosted": datetime.fromtimestamp(detail["publishedAt"], UTC).isoformat(),
            "jobLocation": [{"address": {"addressLocality": place}} for place in detail["workLocations"]],
            "employmentType": detail.get("jobTypes"), "jobBenefits": detail.get("benefits"),
            "qualifications": detail.get("education"),
        }
        salary = detail.get("salary")
        posting["baseSalary"] = ({"currency": salary.get("currency"), "value": {
            "minValue": salary.get("min"), "maxValue": salary.get("max"),
            "unitText": salary.get("period"),
        }} if isinstance(salary, dict) else salary)
        return posting_to_offer(posting, url, self.portal)
