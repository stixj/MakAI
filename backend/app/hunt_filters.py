"""Filter publication dates and saved identities before offers consume a search limit."""
from collections import Counter
from datetime import UTC, datetime, timedelta
from .scrapers.structured import clean_url

PERIOD_HOURS = {"all": None, "24h": 24, "7d": 168, "30d": 720}


class HuntSelection:
    def __init__(self, period="all", include_unknown=False, *, known_urls=(), known_ids=(), now=None):
        if not isinstance(period, str) or period not in PERIOD_HOURS:
            raise ValueError("Období musí být all, 24h, 7d nebo 30d.")
        if type(include_unknown) is not bool:
            raise ValueError("Volba pro nabídky bez data musí být ano/ne.")
        self.now = now or datetime.now(UTC)
        hours = PERIOD_HOURS[period]
        self.since = self.now - timedelta(hours=hours) if hours else None
        self.include_unknown = include_unknown
        self.known_urls = {clean_url(url) for url in known_urls}
        self.known_ids = set(known_ids)
        self.counts = Counter()
        self.known_matches = []

    def accept(self, offer):
        if clean_url(str(offer.url)) in self.known_urls or offer.canonical_id in self.known_ids:
            self.counts["duplicates"] += 1
            self.known_matches.append(offer)
            return False
        if self.since is not None:
            if offer.published_at is None:
                if not self.include_unknown:
                    self.counts["unknownDate"] += 1
                    return False
                self.counts["includedUnknownDate"] += 1
            elif not self.since <= offer.published_at <= self.now:
                self.counts["outsidePeriod"] += 1
                return False
        return True
