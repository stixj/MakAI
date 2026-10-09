"""Local active profile selection; imported candidates never inherit personal files."""
import hashlib
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

from .config import PROJECT_ROOT
from .profile import load_candidate_profile, parse_candidate_profile
from .search_plan import search_terms

PROFILES_DIR = PROJECT_ROOT / "data" / "profiles"
ACTIVE_PATH = PROFILES_DIR / "active.json"


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def selected_id() -> str:
    return json.loads(ACTIVE_PATH.read_text(encoding="utf-8"))["id"] if ACTIVE_PATH.exists() else "default"


def profile_directory(profile_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{64}", profile_id):
        raise ValueError("Neplatný identifikátor profilu.")
    return PROFILES_DIR / profile_id


def get_profile(profile_id: str):
    if profile_id == "default":
        return load_candidate_profile(), "Tvůj profil z projektu", (PROJECT_ROOT / "candidate_profile.md").read_text(encoding="utf-8")
    payload = json.loads((profile_directory(profile_id) / "profile.json").read_text(encoding="utf-8"))
    return parse_candidate_profile(payload["content"]), payload["name"], payload["content"]


def profile_payload(profile_id: str) -> dict:
    profile, name, content = get_profile(profile_id)
    return {"id": profile_id, "name": name, "isDefault": profile_id == "default",
            "content": content, "profile": profile.model_dump(mode="json"), "searchTerms": search_terms(profile)}


def upload_profile(name: str, content: str) -> dict:
    if not isinstance(name, str) or not isinstance(content, str) or not content.strip():
        raise ValueError("Profil nesmí být prázdný.")
    if len(content.encode("utf-8")) > 250_000:
        raise ValueError("Profil může mít nejvýše 250 kB.")
    profile = parse_candidate_profile(content)
    if not search_terms(profile):
        raise ValueError("Profil musí obsahovat alespoň jednu cílovou pozici.")
    profile_id = hashlib.sha256(content.encode("utf-8")).hexdigest()
    directory = profile_directory(profile_id)
    atomic_json(directory / "profile.json", {"name": name[:120], "content": content})
    atomic_json(ACTIVE_PATH, {"id": profile_id})
    return profile_payload(profile_id)


def reset_profile() -> dict:
    payload = profile_payload("default")
    atomic_json(ACTIVE_PATH, {"id": "default"})
    return payload


def result_rows(profile_id: str) -> list[dict]:
    snapshot = profile_directory(profile_id) / "results.json"
    if not snapshot.exists():
        return []
    data = json.loads(snapshot.read_text(encoding="utf-8"))
    return [{"offer_id": item["offer"]["id"], "offer": json.dumps(item["offer"], ensure_ascii=False),
             "evaluation": json.dumps(item["evaluation"], ensure_ascii=False), "evaluated_at": item.get("evaluated_at", data["saved_at"])}
            for item in data["results"]]
