"""Common, synchronous scraper contract; imports never perform I/O."""

from abc import ABC, abstractmethod

from ..schemas import RawJobOffer


class ScraperError(RuntimeError):
    """Actionable source failure, without response bodies or credentials."""


def validate_limit(limit: int) -> None:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= 100:
        raise ValueError("limit musí být celé číslo v rozsahu 0–100.")


class BaseScraper(ABC):
    portal: str

    @abstractmethod
    def fetch_jobs(self, limit: int) -> list[RawJobOffer]:
        """Return at most limit validated offers with company, title and locality."""
