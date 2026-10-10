"""Common, synchronous scraper contract; imports never perform I/O."""

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
import random
import time

import httpx

from ..schemas import RawJobOffer


class ScraperError(RuntimeError):
    """Actionable source failure, without response bodies or credentials."""


def request_with_backoff(client, url: str, *, method: str = "GET", detail: bool = False,
                         max_retries: int = 3, **kwargs) -> httpx.Response:
    """Make a polite request and retry rate limits with Retry-After/backoff."""
    for attempt in range(max_retries + 1):
        if detail:
            time.sleep(random.uniform(0.3, 0.8))
        response = getattr(client, method.lower())(url, **kwargs)
        if response.status_code != 429:
            return response
        if attempt >= max_retries:
            raise ScraperError("Zdroj dočasně omezuje požadavky (HTTP 429).")
        retry_after = response.headers.get("Retry-After", "")
        try:
            delay = max(0.0, float(retry_after))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=UTC)
                delay = max(0.0, (retry_at - datetime.now(UTC)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                delay = 0.5 * (2 ** attempt) + random.uniform(0.1, 0.5)
        time.sleep(min(delay, 60.0))
    raise ScraperError("Požadavek se nepodařilo dokončit.")


def validate_limit(limit: int) -> None:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= 100:
        raise ValueError("limit musí být celé číslo v rozsahu 0–100.")


class BaseScraper(ABC):
    portal: str

    @abstractmethod
    def fetch_jobs(self, limit: int) -> list[RawJobOffer]:
        """Return at most limit validated offers with company, title and locality."""
