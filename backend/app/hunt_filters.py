"""Filter publication dates and saved identities before offers consume a search limit."""
from collections import Counter
from datetime import UTC, datetime, timedelta
import re
import unicodedata

from .profile import CandidateProfile
from .schemas import RawJobOffer
from .scrapers.structured import clean_url

PERIOD_HOURS = {"all": None, "24h": 24, "7d": 168, "30d": 720}

# Only explicit primary-role title patterns are eligible for deterministic exclusion.
REMOTE_TERMS = ("remote", "home office", "práce z domova", "celá čr", "celá česká republika",
                "czech republic", "anywhere in czech")
COUNTRY_TERMS = ("česká republika", "celá čr", "celá česká republika", "czech republic")
AMBIGUOUS_LOCATION_TERMS = ("čr", "cesko", "czechia", "hybrid", "kombinovaně", "více lokalit")
TECHNICAL_ROLE_TERMS = (
    "developer", "engineer", "vývojář", "programátor", "analyst", "analytik",
    "architect", "architekt", "data scientist", "technolog",
)
PRIMARY_NO_GO_ROLE_PATTERNS = (
    r"^(?:(?:hlavni|samostatny|juniorni|seniorni|mzdovy)\s+)?ucetni(?:\s+(?:junior|senior|samostatny))?$",
    r"^svarec(?:\s+[\w/+.-]+)*$",
    r"^ridic(?:\s+[\w/+.-]+)*$",
    r"^skladnik(?:\s+[\w/+.-]+)*$",
    r"^zednik(?:\s+[\w/+.-]+)*$",
    r"^kuchar(?:\s+[\w/+.-]+)*$",
    r"^(?:operator vyroby|vyrobni operator|pokladni|cisnik|servirka)$",
)
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
    return re.search(rf"(?<!\w){re.escape(normalized_term)}(?!\w)", normalized_value) is not None


def _contains_prefix(value: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(_normalized(term))}", _normalized(value)) is not None


def _location_rejected(location: str | None, profile: CandidateProfile) -> bool:
    if not location:
        return False  # Unknown locality is not proof that a job is inaccessible.
    if any(_contains_term(location, term) for term in REMOTE_TERMS):
        return False
    if any(_contains_term(location, term) for term in AMBIGUOUS_LOCATION_TERMS):
        return False
    if _contains_term(location, "kraj"):
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
                      for part in re.split(r"[,;/]|\b(?:a|nebo|primárně)\b", pref, flags=re.I)
                      if len(part.strip()) >= 3]
    if any(_contains_term(location, place) for place in profile_places):
        return False
    return False


def _title_rejection_reason(offer: RawJobOffer, profile: CandidateProfile) -> str | None:
    title = offer.title
    # Domain words are often part of a technical product or customer context,
    # not the occupation itself (e.g. "Python Developer pro účetní software").
    if any(_contains_term(title, term) for term in TECHNICAL_ROLE_TERMS):
        return None
    normalized_title = re.sub(r"\s*\((?:m|z|m/z|z/m)\)\s*", " ", _normalized(title))
    normalized_title = re.sub(r"\s*[-–—]\s*", " ", normalized_title)
    normalized_title = re.sub(r"\s+", " ", normalized_title).strip()
    if any(re.fullmatch(pattern, normalized_title) for pattern in PRIMARY_NO_GO_ROLE_PATTERNS):
        return "title_primary_non_target_role"
    # Explicit profile keywords stay whole-token matches, but generic free text
    # in no_go_criteria is reserved for semantic evaluation by the LLM.
    if any(_contains_term(title, keyword) for keyword in profile.no_go_keywords):
        return "profile_no_go_keyword"
    return None


def prefilter_rejection_reason(offer: RawJobOffer, profile: CandidateProfile) -> str | None:
    if _location_rejected(offer.location, profile):
        return "explicit_location_outside_preferences"
    return _title_rejection_reason(offer, profile)


def filter_promising_offers(
    offers: list[RawJobOffer], profile: CandidateProfile,
) -> tuple[list[RawJobOffer], list[dict[str, object]]]:
    """Drop only clear location/occupation mismatches; preserve an audit reason."""
    rejected: list[dict[str, object]] = []
    accepted: list[RawJobOffer] = []
    for offer in offers:
        reason = prefilter_rejection_reason(offer, profile)
        if reason:
            rejected.append({"offer": offer, "reason": reason})
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
