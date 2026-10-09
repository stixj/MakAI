"""JSON bridge for the loopback-only Vite API. No credentials in stdout."""
import json
import sys

from app.config import get_settings
from app.hunt_filters import HuntSelection
from app.history import history_page
from app.profile_builder import builder_config, generate_profile, ProfileGenerationError
from app.evaluator import evaluation_context
from app.graph import build_graph
from app.profile_registry import (get_profile, profile_directory, profile_payload, reset_profile,
                                  result_rows, selected_id, upload_profile)
from app.scrapers import SCRAPERS, DEFAULT_PORTALS
from app.scrapers.base import ScraperError
from app.scrapers.startupjobs import fetch_startupjobs
from app.search_plan import startup_searches, jobs_listing_urls
from app.storage import JsonEvaluationStore, create_store
from app.turso import TursoEvaluationStore


def hunt(payload: dict, *, profile_override=None, store_override=None) -> dict:
    profile_id = payload["profileId"]
    profile = profile_override if profile_override is not None else get_profile(profile_id)[0]
    limit = payload.get("limit", 10)
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Limit musí být 1–100.")
    portals = payload.get("portals", list(DEFAULT_PORTALS))
    if not isinstance(portals, list) or not portals or any(not isinstance(p, str) or p not in SCRAPERS for p in portals):
        raise ValueError("Neplatné portály.")
    selection = HuntSelection(payload.get("period", "all"), payload.get("includeUnknownDates", False))
    settings = get_settings()
    if not ((settings.llm_provider in {"auto", "gemini"} and settings.gemini_api_key) or
            (settings.llm_provider in {"auto", "openai"} and settings.openai_api_key)):
        raise ValueError("Chybí API klíč pro hodnocení nabídek v .env.")
    personal = profile_id == "default" and profile_override is None
    store = store_override if store_override is not None else (create_store(settings) if personal else JsonEvaluationStore(profile_directory(profile_id) / "results.json", merge_existing=True))
    remote = isinstance(store, TursoEvaluationStore)
    if personal or remote:
        if not isinstance(store, TursoEvaluationStore):
            raise ValueError("Výchozí profil vyžaduje nakonfigurované Turso.")
        store.check_connection()
    previous = result_rows(profile_id) if not remote else []
    if remote:
        known_urls, known_ids = store.known_offer_identities()
    else:
        known = [json.loads(row["offer"]) for row in previous]
        known_urls = {offer["url"] for offer in known}
        known_urls.update(source["url"] for offer in known for source in offer.get("sources", []))
        known_ids = {offer.get("canonical_id") for offer in known if offer.get("canonical_id")}
    selection = HuntSelection(payload.get("period", "all"), payload.get("includeUnknownDates", False),
                              known_urls=known_urls, known_ids=known_ids, now=selection.now)
    offers, errors, sources = [], [], []
    for portal in dict.fromkeys(portals):
        try:
            selection.counts.clear()
            scraper = None
            if portal == "startupjobs":
                found = fetch_startupjobs(limit, searches=startup_searches(profile),
                                          accept_offer=selection.accept, skip_urls=selection.known_urls)
            elif portal == "jobs":
                scraper = SCRAPERS[portal](listing_urls=jobs_listing_urls(profile))
                found = scraper.fetch_jobs(limit, accept_offer=selection.accept, skip_urls=selection.known_urls)
            else:
                scraper = SCRAPERS[portal]()
                found = scraper.fetch_jobs(limit, accept_offer=selection.accept, skip_urls=selection.known_urls)
            offers.extend(found)
            stats = getattr(scraper, "stats", {}) if scraper is not None else {}
            stats = stats if isinstance(stats, dict) else {}
            sources.append({"portal": SCRAPERS[portal].portal, "found": len(found), "status": "done",
                            **dict(selection.counts), **stats})
        except ScraperError as exc:
            errors.append(str(exc))
            sources.append({"portal": SCRAPERS[portal].portal, "found": 0, "status": "error", "error": str(exc)})
    # Keep local history and avoid repeated paid evaluations for the same candidate.
    previous_urls = {json.loads(row["offer"])["url"] for row in previous}
    if remote:
        for offer in selection.known_matches:
            store.upsert_or_enrich_job(offer)
    with evaluation_context(profile, personal_history=personal):
        result = build_graph(settings=settings, store=store,
                             max_evaluations=payload.get("maxEvaluations"),
                             duplicate_checker=lambda url: url in previous_urls).invoke(
                                 {"offers": offers, "evaluations": {}, "errors": errors})
    return {"profileId": profile_id, "found": len(offers), "evaluated": len(result["evaluations"]),
            "saved": len(result["saved_ids"]), "errors": result["errors"], "sources": sources,
            "evaluationBlocked": result.get("evaluation_blocked"),
            "evaluationLimitReached": result.get("evaluation_limit_reached", False),
            "period": payload.get("period", "all"),
            "skippedDuplicates": len(result.get("skipped_duplicates", [])) + sum(s.get("duplicates", 0) + s.get("knownUrls", 0) for s in sources),
            "skippedUnknownDate": sum(s.get("unknownDate", 0) for s in sources),
            "skippedOutsidePeriod": sum(s.get("outsidePeriod", 0) for s in sources)}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        action = sys.argv[1]
        if action == "profile":
            output = profile_payload(selected_id())
        elif action == "upload":
            output = upload_profile(payload["name"], payload["content"])
        elif action == "reset":
            output = reset_profile()
        elif action == "history-page":
            output = history_page(payload)
        elif action == "rows":
            rows = sorted(result_rows(payload["profileId"]), key=lambda row: row["offer_id"])
            rows.sort(key=lambda row: row["evaluated_at"], reverse=True)
            offset, limit = payload.get("offset", 0), payload.get("limit", 50)
            if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
                raise ValueError("Neplatná stránka historie.")
            output = {"rows": rows[offset:offset + limit],
                      "nextOffset": offset + limit if len(rows) > offset + limit else None}
        elif action == "builder-config":
            output = builder_config()
        elif action == "generate-profile":
            output = generate_profile(payload)
        elif action == "hunt":
            output = hunt(payload)
        elif action == "cloud-hunt":
            import hashlib
            from app.profile import parse_candidate_profile
            from app.cloud_storage import ProfileTursoStore
            content, profile_id = payload["profile"]["content"], payload["profile"]["id"]
            if hashlib.sha256(content.encode("utf-8")).hexdigest() != profile_id:
                raise ValueError("Profil běhu neodpovídá uložené verzi.")
            settings = get_settings()
            if not settings.database_url or not settings.turso_auth_token:
                raise ValueError("Chybí připojení k Turso pro online hledání.")
            store = ProfileTursoStore(settings.database_url.get_secret_value(), settings.turso_auth_token.get_secret_value(), profile_id)
            output = hunt({**payload["options"], "profileId": profile_id}, profile_override=parse_candidate_profile(content), store_override=store)
        else:
            raise ValueError("Neznámá akce.")
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except Exception as exc:
        # Only our own plain ValueErrors have safe user messages, never SDK diagnostics.
        message = str(exc) if type(exc) is ValueError or isinstance(exc, ProfileGenerationError) else "Profil nebo hledání se nepodařilo zpracovat. Ověř formát profilu a konfiguraci backendu."
        print(json.dumps({"error": message}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
