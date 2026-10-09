"""External job sources; importing scrapers never performs network requests."""

from .base import BaseScraper, ScraperError
from .portals import AtmoskopScraper, JenPraceCzScraper, JobsCzScraper, PraceCzScraper, PraceZaRohemScraper, DobraPraceScraper
from .startupjobs import StartupJobsScraper

SCRAPERS: dict[str, type[BaseScraper]] = {
    "startupjobs": StartupJobsScraper,
    "jobs": JobsCzScraper,
    "pracezarohem": PraceZaRohemScraper,
    "dobraprace": DobraPraceScraper,
    "prace": PraceCzScraper,
    "jenprace": JenPraceCzScraper,
    "atmoskop": AtmoskopScraper,
}

# These six sources are the default in both the localhost app and CLI.
DEFAULT_PORTALS = ("jobs", "pracezarohem", "dobraprace", "jenprace", "atmoskop", "prace")
