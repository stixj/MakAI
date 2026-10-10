"""Portal-native search filters for the candidate's target commute and schedule."""
from urllib.parse import urlencode
from .profile import CandidateProfile


def search_terms(profile: CandidateProfile) -> tuple[str, ...]:
    return tuple(dict.fromkeys(role.strip().rstrip(".") for role in profile.target_roles if role.strip().rstrip(".")))


def startup_searches(profile: CandidateProfile) -> tuple[dict, ...]:
    return tuple({"query": term} for term in search_terms(profile))


def jobs_listing_urls(profile: CandidateProfile) -> tuple[str, ...]:
    return tuple("https://www.jobs.cz/prace/?" + urlencode({"q[]": term}) for term in search_terms(profile))


def portal_listing_urls(portal: str) -> tuple[str, ...]:
    """Start at each portal with Brno, a 10 km radius where supported, and full-time.

    Portals that do not expose a dependable URL filter still start from their
    Brno locality page. Publication age is checked from each advert's own date.
    """
    urls = {
        "jobs": (
            "https://www.jobs.cz/prace/brno/plny-uvazek/?" + urlencode({
                "employment": "full", "locality[code]": "M265747",
                "locality[coords]": "49.19186,16.61108", "locality[label]": "Brno",
                "locality[radius]": "10", "date": "24h",
            }),
        ),
        "prace": (
            "https://www.prace.cz/nabidky/plny-uvazek/?" + urlencode({
                "workLocationIds[]": "M265747;10",
            }),
        ),
        "jenprace": (
            "https://www.jenprace.cz/prace-dle-preference/pracovni-uvazky-a-pomery/prace-na-plny-uvazek?"
            + urlencode({"ld[736551]": "10", "locations[0]": "736551"}),
        ),
        "atmoskop": (
            "https://www.atmoskop.cz/prehled-pracovnich-pozic?" + urlencode({
                "locality[0][label]": "Brno, okres Brno-město",
                "locality[0][latitude]": "49.191864177059585",
                "locality[0][longitude]": "16.611085007483528",
                "locality[0][radius]": "10",
            }),
        ),
        # Práce za rohem supports coordinate-based radius searches, but its
        # employment-type filter is not stable as a public URL parameter.
        "pracezarohem": ("https://www.pracezarohem.cz/nabidky/@49.191864177059585,16.611085007483528?radius=10&sort=time",),
        # DobráPráce exposes a city page but no confirmed radius filter.
        "dobraprace": ("https://www.dobraprace.cz/nabidka-prace/brno/",),
    }
    try:
        return urls[portal]
    except KeyError as exc:
        raise ValueError("Pro tento portál není nastavené hledání podle lokality.") from exc
