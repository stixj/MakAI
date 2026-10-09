"""Map public Schema.org JobPosting data into a shared scraper contract."""

import hashlib
import json
import re
from datetime import UTC, datetime, time
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from ..schemas import RawJobOffer


def job_postings(value: object):
    if isinstance(value, list):
        for item in value:
            yield from job_postings(item)
    elif isinstance(value, dict):
        types = value.get("@type", [])
        if types == "JobPosting" or isinstance(types, list) and "JobPosting" in types:
            yield value
        if "@graph" in value:
            yield from job_postings(value["@graph"])


def source_date(value: str, *, allow_local_time: bool = False) -> datetime:
    # Prace.cz currently appends a redundant T23:59 after an aware validThrough.
    value = re.sub(r"([+-]\d{2}:\d{2})T\d{2}:\d{2}$", r"\1", value)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if len(value) == 10:
        return datetime.combine(parsed.date(), time(), ZoneInfo("Europe/Prague"))
    if parsed.tzinfo is None:
        if allow_local_time:
            return parsed.replace(tzinfo=ZoneInfo("Europe/Prague"))
        raise ValueError("Source timestamp has no timezone")
    return parsed


def clean_url(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def location_text(posting: dict) -> str | None:
    places = posting.get("jobLocation", [])
    if isinstance(places, dict):
        places = [places]
    locations = sorted({place["address"]["addressLocality"].strip()
                        for place in places if isinstance(place, dict)
                        and isinstance(place.get("address"), dict)
                        and isinstance(place["address"].get("addressLocality"), str)
                        and place["address"]["addressLocality"].strip()})
    return ", ".join(locations) or None


def salary_text(salary: object) -> str | None:
    if isinstance(salary, str):
        return salary.strip() or None
    if isinstance(salary, list):
        return "; ".join(filter(None, (salary_text(item) for item in salary))) or None
    if not isinstance(salary, dict):
        return None
    value = salary.get("value")
    if isinstance(value, dict):
        low, high = value.get("minValue"), value.get("maxValue")
        amount = (f"{low} – {high}" if low is not None and high is not None
                  else f"od {low}" if low is not None
                  else f"do {high}" if high is not None else str(value.get("value", "")))
        unit = value.get("unitText", "")
    else:
        amount, unit = str(value) if value is not None else "", ""
    if not amount:
        return None
    return " ".join(str(item) for item in (amount, salary.get("currency", ""), unit) if item)


def posting_to_offer(posting: dict, url: str, portal: str, *,
                     source_id: str | None = None, allow_local_time: bool = False) -> RawJobOffer | None:
    if posting.get("validThrough") and source_date(
        posting["validThrough"], allow_local_time=allow_local_time,
    ) < datetime.now(UTC):
        return None
    description = BeautifulSoup(posting["description"], "html.parser")
    for tag in description.select("script, style"):
        tag.decompose()
    text = description.get_text("\n", strip=True)
    if not text:
        raise ValueError("Empty job description")
    context = {key: posting[key] for key in (
        "jobLocation", "jobLocationType", "applicantLocationRequirements",
        "employmentType", "baseSalary", "skills", "qualifications", "jobBenefits",
    ) if key in posting}
    if context:
        text += "\n\nPodmínky uvedené zdrojem:\n" + json.dumps(context, ensure_ascii=False)
    return RawJobOffer(
        id=source_id or portal.casefold().replace(".", "-") + "-" + hashlib.sha256(url.encode()).hexdigest()[:20],
        title=posting["title"], company=posting["hiringOrganization"]["name"],
        url=url, raw_description=text,
        published_at=source_date(posting["datePosted"], allow_local_time=allow_local_time),
        location=location_text(posting), salary_raw=salary_text(posting.get("baseSalary")),
        sources=[{"portal": portal, "url": url}],
    )


def parse_job_detail(html: str, url: str, portal: str, *, allow_local_time: bool = False) -> RawJobOffer | None:
    soup = BeautifulSoup(html, "html.parser")
    postings = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            postings.extend(job_postings(json.loads(script.get_text())))
        except ValueError:
            continue
    matching = [posting for posting in postings
                if isinstance(posting.get("url"), str) and clean_url(posting["url"]) == clean_url(url)]
    if matching:
        posting = matching[0]
    elif len(postings) == 1 and not postings[0].get("url"):
        posting = postings[0]
    else:
        raise ValueError("Missing or ambiguous JobPosting detail")
    return posting_to_offer(posting, url, portal, allow_local_time=allow_local_time)
