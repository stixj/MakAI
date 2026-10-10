"""Local active profile selection; imported candidates never inherit personal files."""
import hashlib
import json
import re
import base64
from datetime import datetime, timezone
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


def cv_document_path(profile_id: str) -> Path:
    return (PROFILES_DIR / "default" / "cv_document.json") if profile_id == "default" else profile_directory(profile_id) / "cv_document.json"


def cv_document_payload(profile_id: str, include_content: bool = False) -> dict | None:
    path = cv_document_path(profile_id)
    if not path.exists():
        return None
    document = json.loads(path.read_text(encoding="utf-8"))
    result = {key: document[key] for key in ("name", "contentType", "size", "uploadedAt")}
    if include_content:
        result["base64"] = document["base64"]
    return result


def save_cv_document(profile_id: str, document: dict, *, require_active: bool = True) -> dict:
    if require_active and profile_id != selected_id():
        raise ValueError("Aktivní profil se změnil. Obnov stránku.")
    name = document.get("name")
    base64_data = document.get("base64")
    extracted_text = document.get("extractedText")
    if not isinstance(name, str) or not isinstance(base64_data, str) or not isinstance(extracted_text, str):
        raise ValueError("Zkontroluj nahrané CV.")
    extension = name.rsplit(".", 1)[-1].lower()
    if extension not in {"pdf", "docx", "txt", "md"}:
        raise ValueError("Použij PDF, DOCX, TXT nebo Markdown.")
    try:
        content = base64.b64decode(base64_data, validate=True)
    except Exception as exc:
        raise ValueError("Soubor CV není platný.") from exc
    if not content or len(content) > 2_000_000 or len(extracted_text) < 40 or len(extracted_text) > 60_000:
        raise ValueError("CV musí mít do 2 MB a obsahovat čitelný text.")
    content_types = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "txt": "text/plain", "md": "text/markdown"}
    saved = {"name": re.sub(r"[\\/\x00-\x1f]", "_", name)[:180], "contentType": content_types[extension],
             "size": len(content), "base64": base64_data, "extractedText": extracted_text,
             "uploadedAt": datetime.now(timezone.utc).isoformat()}
    atomic_json(cv_document_path(profile_id), saved)
    return {key: saved[key] for key in ("name", "contentType", "size", "uploadedAt")}


def get_profile(profile_id: str):
    if profile_id == "default":
        return load_candidate_profile(), "Tvůj profil z projektu", (PROJECT_ROOT / "candidate_profile.md").read_text(encoding="utf-8")
    payload = json.loads((profile_directory(profile_id) / "profile.json").read_text(encoding="utf-8"))
    return parse_candidate_profile(payload["content"]), payload["name"], payload["content"]


def profile_payload(profile_id: str) -> dict:
    profile, name, content = get_profile(profile_id)
    return {"id": profile_id, "name": name, "isDefault": profile_id == "default",
            "content": content, "profile": profile.model_dump(mode="json"), "searchTerms": search_terms(profile),
            "cvDocument": cv_document_payload(profile_id)}


def upload_profile(name: str, content: str, cv_document: dict | None = None, preserve_cv_from_profile_id: str | None = None) -> dict:
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
    if cv_document:
        save_cv_document(profile_id, cv_document, require_active=False)
    elif preserve_cv_from_profile_id == selected_id():
        previous_document = cv_document_path(preserve_cv_from_profile_id)
        if previous_document.exists() and previous_document != cv_document_path(profile_id):
            atomic_json(cv_document_path(profile_id), json.loads(previous_document.read_text(encoding="utf-8")))
    atomic_json(ACTIVE_PATH, {"id": profile_id})
    return profile_payload(profile_id)


def delete_cv_document(profile_id: str) -> dict:
    if profile_id != selected_id():
        raise ValueError("Aktivní profil se změnil. Obnov stránku.")
    cv_document_path(profile_id).unlink(missing_ok=True)
    return {"cvDocument": None}


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
