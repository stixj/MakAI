"""Small adapters for durable per-offer ingestion checkpoints."""

from collections.abc import Callable

from .schemas import JobOffer
from .scrapers.structured import clean_url


def discovery_callback(store) -> Callable[[JobOffer], bool]:
    """Persist each newly fetched identity once, before adding it to the batch."""
    seen: set[str] = set()
    seen_urls: set[str] = set()
    discover = getattr(store, "discover_job", None)

    def persist(offer: JobOffer) -> bool:
        normalized_url = clean_url(str(offer.url))
        if offer.canonical_id in seen or normalized_url in seen_urls:
            # Keep duplicates in the graph so it can merge source URLs while
            # evaluating the canonical offer only once.
            return True
        seen.add(offer.canonical_id)
        seen_urls.add(normalized_url)
        if discover is not None:
            try:
                discover(offer)
            except Exception as exc:
                raise RuntimeError(f"discovery checkpoint failed ({type(exc).__name__})") from None
        return True

    return persist
