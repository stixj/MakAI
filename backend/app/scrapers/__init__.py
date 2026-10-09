"""External job sources; importing scrapers never performs network requests."""

from .base import BaseScraper, ScraperError
from .portals import AtmoskopScraper, JenPraceCzScraper, JobsCzScraper, PraceCzScraper
from .startupjobs import StartupJobsScraper

SCRAPERS: dict[str, type[BaseScraper]] = {
    "startupjobs": StartupJobsScraper,
    "jobs": JobsCzScraper,
    "prace": PraceCzScraper,
    "jenprace": JenPraceCzScraper,
    "atmoskop": AtmoskopScraper,
}
