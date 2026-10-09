"""Conservative, versioned identity shared by all job portals."""

import hashlib
import json
import re
import unicodedata


def _ascii(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(char)
    )


def _company(value: str) -> str:
    value = _ascii(value)
    value = re.sub(
        r"(?<!\w)(?:spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?)(?!\w)",
        "", value,
    )
    return re.sub(r"[^a-z0-9]", "", value)


_GENDER = r"(?<!\w)(?:m\s*[/\\]\s*z|f\s*[/\\]\s*m|m\s*[/\\]\s*f|m\s*[/\\]\s*w\s*[/\\]\s*d)(?!\w)"
_EMPLOYMENT = (
    r"\b(?:full[\s-]*time|part[\s-]*time|(?:plny|plneho|zkraceny|zkraceneho|"
    r"castecny|castecneho|polovicni|polovicniho)\s+uvaz(?:ek|ku)|hpp|vpp|dpp|dpc)\b"
)
_ADMINISTRATIVE = rf"(?:{_EMPLOYMENT}|\bico\b)"
_GRADUATES = r"\bvhodne\s+pro\s+absolventy\b"


def _title(value: str) -> str:
    value = _ascii(value)
    # Keep meaningful parentheses, e.g. (Python) or (C++). Only decorations go.
    def bracket(match: re.Match) -> str:
        content = match.group(1).strip()
        cleaned = re.sub(_GENDER, "", content)
        cleaned = re.sub(_ADMINISTRATIVE, "", cleaned)
        cleaned = re.sub(_GRADUATES, "", cleaned)
        if not re.sub(r"[\s,;/+-]", "", cleaned):
            return " "
        return f"({cleaned})"

    value = re.sub(r"\(([^()]*)\)", bracket, value)
    value = re.sub(_GENDER, "", value)
    value = re.sub(_EMPLOYMENT, "", value)
    # Preserve + and # to distinguish C/C++/C# roles.
    return " ".join(re.sub(r"[^a-z0-9+#]+", " ", value).split())


def _canonical_id(company: str, normalized_title: str, location: str) -> str:
    parts = [_company(company), normalized_title,
             " ".join(re.sub(r"[^a-z0-9]+", " ", _ascii(location)).split())]
    if not parts[0] or not parts[1]:
        raise ValueError("Company and title must contain an identity.")
    payload = json.dumps(parts, ensure_ascii=True, separators=(",", ":"))
    return "job-v1-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def generate_canonical_id(company: str, title: str, location: str) -> str:
    """Hash normalized company, role and locality; unknown locality stays distinct.

    No fuzzy city guessing or translation: different localities and meaningful
    title qualifiers must not silently collapse into one paid evaluation.
    """
    return _canonical_id(company, _title(title), location)


def legacy_canonical_id(company: str, title: str, location: str) -> str:
    """Validate old persisted hashes only; never generate identities for new jobs."""
    level = r"(?:junior|medior|senior|juniorni|seniorni|jr\.?|sr\.?)(?:\s*[/,-]\s*(?:junior|medior|senior))*"

    def bracket(match: re.Match) -> str:
        cleaned = re.sub(_GENDER, "", match.group(1).strip())
        cleaned = re.sub(_EMPLOYMENT, "", cleaned)
        if not re.sub(r"[\s,;/+-]", "", cleaned) or re.fullmatch(level, cleaned.strip()):
            return " "
        return match.group(0)

    value = re.sub(r"\(([^()]*)\)", bracket, _ascii(title))
    value = re.sub(_GENDER, "", value)
    value = re.sub(_EMPLOYMENT, "", value)
    normalized = " ".join(re.sub(r"[^a-z0-9+#]+", " ", value).split())
    return _canonical_id(company, normalized, location)
