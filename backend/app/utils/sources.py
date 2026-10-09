"""Source provenance and lossless offer enrichment."""

from urllib.parse import urlsplit
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..schemas import JobOffer


def source_for_url(url: str) -> dict[str, str]:
    host = (urlsplit(url).hostname or "").casefold()
    portals = {"jobs.cz": "Jobs.cz", "prace.cz": "Prace.cz",
               "jenprace.cz": "JenPrace.cz", "atmoskop.cz": "Atmoskop",
               "pracezarohem.cz": "Práce za rohem", "startupjobs.cz": "StartupJobs"}
    portal = next((label for domain, label in portals.items()
                   if host == domain or host.endswith("." + domain)), host)
    return {"portal": portal, "url": url}


def merge_sources(*groups: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = []
    seen = set()
    for group in groups:
        for source in group:
            if set(source) != {"portal", "url"} or not all(
                isinstance(source[key], str) and source[key].strip() for key in ("portal", "url")
            ):
                raise ValueError("A source requires portal and url.")
            parsed = urlsplit(source["url"])
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise ValueError("A source requires an HTTP(S) URL.")
            item = {"portal": source["portal"].strip(), "url": source["url"].strip()}
            key = (item["portal"], item["url"])
            if key not in seen:
                seen.add(key)
                merged.append(item)
    return merged


def enrich_offer(existing: "JobOffer", incoming: "JobOffer") -> "JobOffer":
    """Preserve identity and original content; fill salary and append sources."""
    return existing.model_copy(update={
        "sources": merge_sources(existing.sources, incoming.sources),
        "salary_raw": existing.salary_raw or incoming.salary_raw,
    })
