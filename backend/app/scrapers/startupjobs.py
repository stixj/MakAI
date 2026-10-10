"""Public StartupJobs search API and JobPosting JSON-LD from offer details."""

import json
import logging
import re
from collections.abc import Iterator
from itertools import cycle
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup
from pydantic import ValidationError

from ..schemas import RawJobOffer
from .base import BaseScraper, ScraperError, request_with_backoff, validate_limit
from .structured import job_postings as _job_postings, posting_to_offer

SEARCH_URL = "https://back.startupjobs.cz/api/search-offers"
BASE_URL = "https://www.startupjobs.cz"
USER_AGENT = "MakAI/0.1 (+personal job-offer reader)"
SEARCHES = ({"fields": ["ai-vyvojar"]}, {"fields": ["vyvoj"], "query": "Python"},
            {"fields": ["vyvoj"]})
logger = logging.getLogger(__name__)


def _parse_offer(html: str, url: str, source_id: int) -> RawJobOffer | None:
    soup = BeautifulSoup(html, "html.parser")
    postings = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            postings.extend(_job_postings(json.loads(script.string or script.get_text())))
        except ValueError:
            continue
    if not postings:
        if "Nabídce vypršela platnost" in soup.get_text():
            return None
        raise ValueError("Missing JobPosting data")
    posting = next((item for item in postings if item.get("url") == url), None)
    if posting is None:
        raise ValueError("JobPosting URL does not match detail")
    return posting_to_offer(posting, url, "StartupJobs", source_id=f"startupjobs-{source_id}")


def _search_members(client: httpx.Client, criteria: dict, size: int) -> Iterator[dict]:
    for page in range(1, 11):
        response = client.post(
            SEARCH_URL, json=criteria, params={"page": page, "itemsPerPage": size},
            headers={"Content-Type": "application/ld+json"},
        )
        response.raise_for_status()
        payload = response.json()
        members = payload.get("member") if isinstance(payload, dict) else None
        if not isinstance(members, list):
            raise ScraperError("StartupJobs změnil formát výpisu nabídek.")
        view = payload.get("view", {})
        if not isinstance(view, dict):
            raise ScraperError("StartupJobs změnil formát stránkování.")
        yield from members
        if not members or not view.get("next"):
            return


def fetch_startupjobs(limit: int = 15, *, searches: tuple[dict, ...] | None = None,
                      accept_offer=None, skip_urls=None) -> list[RawJobOffer]:
    """Fetch at most limit current offers; persistent deduplication belongs to the graph.

    Rotate AI, Python and Development searches, deduplicate source IDs, and use
    bounded pagination (ten pages per search). Never silently return an empty
    success when the server or its response contract fails.
    """
    validate_limit(limit)
    if limit == 0:
        return []
    skip_urls = skip_urls or set()
    criteria_list = SEARCHES if searches is None else searches
    if not criteria_list:
        return []
    offers: list[RawJobOffer] = []
    seen: set[int] = set()
    exhausted: set[int] = set()
    invalid = 0
    try:
        with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20,
                          follow_redirects=False) as client:
            streams = [_search_members(client, criteria, min(limit, 20)) for criteria in criteria_list]
            for index in cycle(range(len(criteria_list))):
                if len(exhausted) == len(criteria_list) or len(offers) >= limit:
                    break
                if index in exhausted:
                    continue
                try:
                    member = next(streams[index])
                except StopIteration:
                    exhausted.add(index)
                    continue
                try:
                    source_id = member["id"]
                    slug = member["slug"]["cs"]
                    if (type(source_id) is not int or source_id <= 0
                            or not isinstance(slug, str)
                            or not re.fullmatch(r"[a-z0-9-]+", slug)):
                        raise ValueError("Invalid offer identity")
                    if source_id in seen:
                        continue
                    seen.add(source_id)
                    url = f"{BASE_URL}/nabidka/{source_id}/{slug}"
                    if url in skip_urls:
                        continue
                    detail = request_with_backoff(client, url, detail=True)
                    if detail.status_code in {404, 410}:
                        continue
                    detail.raise_for_status()
                    # Redirects are errors: never ingest a login page or external URL.
                    if urlsplit(str(detail.url)).hostname != "www.startupjobs.cz":
                        raise ScraperError("Neočekávaná adresa detailu StartupJobs.")
                    offer = _parse_offer(detail.text, url, source_id)
                    if offer is not None and (accept_offer is None or accept_offer(offer)):
                        offers.append(offer)
                except (KeyError, TypeError, ValueError, ValidationError):
                    invalid += 1
                    logger.warning("StartupJobs: přeskočen neplatný detail nabídky.")
    except httpx.HTTPError as exc:
        raise ScraperError(f"Stažení StartupJobs selhalo: {type(exc).__name__}.") from None
    except ValueError:
        raise ScraperError("StartupJobs vrátil neplatnou JSON odpověď.") from None
    if invalid and not offers:
        raise ScraperError("StartupJobs: žádný z nalezených detailů nebyl validní.")
    return offers


class StartupJobsScraper(BaseScraper):
    portal = "StartupJobs"

    def fetch_jobs(self, limit: int) -> list[RawJobOffer]:
        return fetch_startupjobs(limit)
