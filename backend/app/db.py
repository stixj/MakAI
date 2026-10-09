"""Canonical Turso schema, legacy migration and atomic enrichment.

The transport stays in turso.py. No LLM is invoked here: callers check for an
existing offer before evaluating, then persist with upsert_or_enrich_job.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from .schemas import JobFitEvaluation, JobOffer
from .utils.sources import enrich_offer

if TYPE_CHECKING:
    from .turso import TursoEvaluationStore

TABLE = "makai_job_evaluations"
# A new index name marks completion of the seniority-preserving backfill.
INDEX = "makai_job_canonical_v2_idx"
CREATE_TABLE = """
    CREATE TABLE IF NOT EXISTS makai_job_evaluations (
        offer_id TEXT PRIMARY KEY,
        offer TEXT NOT NULL,
        evaluation TEXT NOT NULL,
        evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
"""
CREATE_INDEX = """
    CREATE UNIQUE INDEX IF NOT EXISTS makai_job_canonical_v2_idx
    ON makai_job_evaluations (json_extract(offer, '$.canonical_id'))
"""
UPSERT = """
    INSERT INTO makai_job_evaluations (offer_id, offer, evaluation, evaluated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (json_extract(offer, '$.canonical_id')) DO UPDATE SET offer = json_set(
        makai_job_evaluations.offer,
        '$.salary_raw', COALESCE(
            NULLIF(json_extract(makai_job_evaluations.offer, '$.salary_raw'), ''),
            json_extract(excluded.offer, '$.salary_raw')),
        '$.sources', json((
            SELECT json_group_array(json(value)) FROM (
                SELECT value FROM (
                    SELECT value FROM json_each(makai_job_evaluations.offer, '$.sources')
                    UNION ALL
                    SELECT value FROM json_each(excluded.offer, '$.sources')
                ) GROUP BY json_extract(value, '$.portal'), json_extract(value, '$.url')
            )
        ))
    )
"""


def _args(*values: str) -> list[dict]:
    return [{"type": "text", "value": value} for value in values]


def _execute(store: "TursoEvaluationStore", sql: str, *values: str) -> list:
    from .turso import TursoError
    rows = store._request({"type": "execute", "stmt": {
        "sql": sql, "args": _args(*values),
    }}).get("rows")
    if not isinstance(rows, list):
        raise TursoError("Neplatný výsledek dotazu Turso.")
    return rows


def _table_exists(store: "TursoEvaluationStore") -> bool:
    return bool(_execute(store, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", TABLE))


def _schema_statements(store: "TursoEvaluationStore") -> list[tuple[str, list[dict]]]:
    """Backfill old JSON and merge collisions, preserving the oldest evaluation.

    All returned DDL/DML is applied in one transaction. Existing offer_id keys
    stay intact for downstream consumers; canonical identity has a unique index.
    """
    if getattr(store, "_canonical_ready", False):
        return []
    statements = [(CREATE_TABLE, [])]
    if _table_exists(store):
        if _execute(store, "SELECT name FROM sqlite_master WHERE type='index' AND name=?", INDEX):
            store._canonical_ready = True
            return []
        # Drop the old constraint in the same transaction as the backfill;
        # rollback restores both the old identities and their unique index.
        statements.append(("DROP INDEX IF EXISTS makai_job_canonical_idx", []))
        rows = _execute(store, "SELECT offer_id, offer FROM makai_job_evaluations ORDER BY evaluated_at, offer_id")
        groups: dict[str, tuple[str, JobOffer]] = {}
        for row in rows:
            try:
                offer_id, payload = (cell["value"] for cell in row)
                offer = JobOffer.model_validate_json(payload)
            except (ValueError, KeyError, TypeError):
                from .turso import TursoError
                raise TursoError("Starší nabídku v Turso nelze migrovat; data zůstala zachována.") from None
            if offer.canonical_id in groups:
                kept_id, kept = groups[offer.canonical_id]
                groups[offer.canonical_id] = (kept_id, enrich_offer(kept, offer))
                statements.append(("DELETE FROM makai_job_evaluations WHERE offer_id=?", _args(offer_id)))
            else:
                groups[offer.canonical_id] = (offer_id, offer)
        for offer_id, offer in groups.values():
            statements.append(("UPDATE makai_job_evaluations SET offer=? WHERE offer_id=?",
                               _args(offer.model_dump_json(), offer_id)))
    statements.extend([
        (CREATE_INDEX, []),
        ("CREATE INDEX IF NOT EXISTS makai_job_url_idx ON makai_job_evaluations (json_extract(offer, '$.url'))", []),
    ])
    return statements


def _transaction(store: "TursoEvaluationStore", statements: list[tuple[str, list[dict]]]) -> None:
    from .turso import TursoError
    steps: list[dict] = [{"stmt": {"sql": "BEGIN IMMEDIATE", "want_rows": False}}]
    for sql, args in [*statements, ("COMMIT", [])]:
        steps.append({"condition": {"type": "ok", "step": len(steps) - 1},
                      "stmt": {"sql": sql, "args": args, "want_rows": False}})
    commit_index = len(steps) - 1
    steps.append({"condition": {"type": "and", "conds": [
        {"type": "ok", "step": 0},
        {"type": "not", "cond": {"type": "ok", "step": commit_index}},
    ]}, "stmt": {"sql": "ROLLBACK", "want_rows": False}})
    result = store._request({"type": "batch", "batch": {"steps": steps}})
    successes, errors = result.get("step_results"), result.get("step_errors")
    if (not isinstance(successes, list) or not isinstance(errors, list)
            or len(successes) != len(steps) or len(errors) != len(steps)
            or any(error is not None for error in errors)
            or not all(isinstance(item, dict) for item in successes[:commit_index + 1])
            or successes[-1] is not None):
        raise TursoError("Uložení do Turso selhalo; úspěšný COMMIT nebyl potvrzen.")
    store._canonical_ready = True


def find_existing_job(store: "TursoEvaluationStore", offer: JobOffer) -> JobOffer | None:
    if not _table_exists(store):
        return None
    statements = _schema_statements(store)
    if statements:
        _transaction(store, statements)
    # Keep canonical lookup separate so SQLite can use the unique index instead
    # of scanning every JSON source array for the common cross-portal case.
    rows = _execute(store, "SELECT offer FROM makai_job_evaluations WHERE json_extract(offer, '$.canonical_id') = ?",
                    offer.canonical_id)
    if rows:
        return JobOffer.model_validate_json(rows[0][0]["value"])
    rows = _execute(store, """
        SELECT offer FROM makai_job_evaluations
        WHERE json_extract(offer, '$.url') = ?
           OR EXISTS (SELECT 1 FROM json_each(offer, '$.sources')
                      WHERE json_extract(value, '$.url') = ?)
        LIMIT 1
    """, str(offer.url), str(offer.url))
    return JobOffer.model_validate_json(rows[0][0]["value"]) if rows else None


def save_evaluations(store: "TursoEvaluationStore", offers: Sequence[JobOffer],
                     evaluations: Mapping[str, JobFitEvaluation]) -> None:
    rows = [JobOffer.model_validate(offer.model_dump()) for offer in offers if offer.id in evaluations]
    if not rows:
        return
    statements = _schema_statements(store)
    timestamp = datetime.now(UTC).isoformat()
    for offer in rows:
        statements.append((UPSERT, _args(offer.id, offer.model_dump_json(),
                                       evaluations[offer.id].model_dump_json(), timestamp)))
    _transaction(store, statements)


def upsert_or_enrich_job(
    offer: JobOffer, eval: JobFitEvaluation | None = None, *,
    store: "TursoEvaluationStore | None" = None,
) -> None:
    """Insert with evaluation or enrich without changing the stored evaluation.

    Supplying store permits offline injection. Without it, configured Turso is
    selected lazily. New offers require an evaluation; existing ones never do.
    """
    offer = JobOffer.model_validate(offer.model_dump())
    if store is None:
        from .config import get_settings
        from .storage import create_store
        from .turso import TursoEvaluationStore, StorageConfigurationError
        store = create_store(get_settings())
        if not isinstance(store, TursoEvaluationStore):
            raise StorageConfigurationError("Obohacení vyžaduje Turso.")
    existing = find_existing_job(store, offer)
    if existing is None:
        if eval is None:
            raise ValueError("A new offer requires a JobFitEvaluation.")
        save_evaluations(store, [offer], {offer.id: eval})
        return
    # SQL merges against the current row, so simultaneous sources cannot erase
    # each other. Do not write a Python read/modify/write snapshot.
    statements = [("""
        UPDATE makai_job_evaluations SET offer = json_set(
            offer, '$.salary_raw', COALESCE(NULLIF(json_extract(offer, '$.salary_raw'), ''), NULLIF(?, '')),
            '$.sources', json((SELECT json_group_array(json(value)) FROM (
                SELECT value FROM (
                    SELECT value FROM json_each(makai_job_evaluations.offer, '$.sources')
                    UNION ALL SELECT value FROM json_each(?)
                ) GROUP BY json_extract(value, '$.portal'), json_extract(value, '$.url')
            )))
        ) WHERE json_extract(offer, '$.canonical_id') = ?
    """, [{"type": "text", "value": offer.salary_raw or ""},
           {"type": "text", "value": json.dumps(offer.sources, ensure_ascii=False)},
           {"type": "text", "value": existing.canonical_id}])]
    _transaction(store, statements)
