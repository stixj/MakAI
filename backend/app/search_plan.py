"""Search terms come from the selected candidate, without inferred qualifications."""
from urllib.parse import urlencode
from .profile import CandidateProfile


def search_terms(profile: CandidateProfile) -> tuple[str, ...]:
    return tuple(dict.fromkeys(role.strip().rstrip(".") for role in profile.target_roles if role.strip().rstrip(".")))


def startup_searches(profile: CandidateProfile) -> tuple[dict, ...]:
    return tuple({"query": term} for term in search_terms(profile))


def jobs_listing_urls(profile: CandidateProfile) -> tuple[str, ...]:
    return tuple("https://www.jobs.cz/prace/?" + urlencode({"q[]": term}) for term in search_terms(profile))
