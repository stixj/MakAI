"""Filter publication dates and saved identities before offers consume a search limit."""
from collections import Counter
from datetime import UTC, datetime, timedelta
import re
import unicodedata

from .profile import CandidateProfile
from .schemas import RawJobOffer
from .scrapers.structured import clean_url

PERIOD_HOURS = {"all": None, "24h": 24, "7d": 168, "30d": 720}

# Broad, unambiguous occupations outside the candidate's stated AI/business
# direction. Keep this title-only: description mentions are not sufficient.
DEFAULT_NO_GO_KEYWORDS = (
    "svářeč", "řidič", "skladník", "zedník", "účetní", "kuchař",
    "operátor výroby", "výrobní operátor", "pokladní", "číšník", "servírka",
)
REMOTE_TERMS = ("remote", "home office", "práce z domova", "celá čr", "celá česká republika",
                "celá česká republika", "czech republic", "anywhere in czech")
COUNTRY_TERMS = ("česká republika", "celá čr", "celá česká republika", "czech republic")
KNOWN_LOCALITIES = (
    "brno", "praha", "ostrava", "plzeň", "liberec", "olomouc", "pardubice",
    "hradec králové", "české budějovice", "ústí nad labem", "zlin", "zlín",
    "jihomoravský kraj", "moravskoslezský kraj", "plzeňský kraj",
)
LOCALITY_ALIASES = {
    "brno": ("brno", "brně", "jihomoravský kraj"),
    # A stem handles inflected forms such as Pražská/Prahu.
    "praha": ("praha", "pražsk"),
    "plzeň": ("plzeň", "plzeňský kraj"),
    "ostrava": ("ostrava", "moravskoslezský kraj"),
}


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in value if not unicodedata.combining(char))


def _contains_term(value: str, term: str) -> bool:
    normalized_value, normalized_term = _normalized(value), _normalized(term.strip())
    if not normalized_term:
        return False
    if " " in normalized_term:
        return normalized_term in normalized_value
    return re.search(rf"(?<!\w){re.escape(normalized_term)}(?!\w)", normalized_value) is not None


def _contains_prefix(value: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(_normalized(term))}", _normalized(value)) is not None


def _location_rejected(location: str | None, profile: CandidateProfile) -> bool:
    if not location:
        return False  # Unknown locality is not proof that a job is inaccessible.
    if any(_contains_term(location, term) for term in REMOTE_TERMS):
        return False
    preferences = " ".join(profile.location_preferences)
    if any(_contains_term(location, term) for term in COUNTRY_TERMS) and any(
        _contains_term(preferences, term) for term in COUNTRY_TERMS
    ):
        return False
    offered_places = [place for place in KNOWN_LOCALITIES if _contains_term(location, place)]
    preferred_places = [place for place in KNOWN_LOCALITIES
                        if any(_contains_term(preferences, alias) or _contains_prefix(preferences, alias)
                               for alias in LOCALITY_ALIASES.get(place, (place,)))]
    if offered_places:
        return not any(place in preferred_places for place in offered_places)
    # A direct locality written in the profile can be matched even if it is not
    # in the common-city list above.
    profile_places = [part.strip() for pref in profile.location_preferences
                      for part in re.split(r"[,;/]|\b(?:a|nebo|primarnÄ›|primárně)\b", pref, flags=re.I)
                      if len(part.strip()) >= 3]
    if any(_contains_term(location, place) for place in profile_places):
        return False
    return False


def filter_promising_offers(
    offers: list[RawJobOffer], profile: CandidateProfile,
) -> tuple[list[RawJobOffer], list[RawJobOffer]]:
    """Drop clearly inaccessible locations and unrelated occupations before AI."""
    rejected: list[RawJobOffer] = []
    accepted: list[RawJobOffer] = []
    profile_keywords = getattr(profile, "no_go_keywords", ())
    profile_keywords = (*profile_keywords, *profile.no_go_criteria)
    keywords = tuple(dict.fromkeys((*DEFAULT_NO_GO_KEYWORDS, *profile_keywords)))
    for offer in offers:
        if (_location_rejected(offer.location, profile)
                or any(_contains_term(offer.title, keyword) for keyword in keywords)):
            rejected.append(offer)
        else:
            accepted.append(offer)
    return accepted, rejected


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
