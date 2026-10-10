"""Persistence adapters: atomic local snapshot, PostgreSQL or Turso batch upsert."""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Protocol
from urllib.parse import urlsplit

import psycopg
from psycopg.types.json import Jsonb

from .config import Settings
from .schemas import JobFitEvaluation, JobOffer
from .turso import StorageConfigurationError, TursoEvaluationStore


class EvaluationStore(Protocol):
    def save(
        self, offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
    ) -> None: ...


class JsonEvaluationStore:
    """Single-process local snapshot, replaced atomically after a successful write."""

    def __init__(self, path: Path, *, merge_existing: bool = False) -> None:
        self.path = path
        self.merge_existing = merge_existing

    def save(
        self, offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
        *, merge_existing: bool | None = None,
    ) -> None:
        payload = {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "results": [
                {"offer": offer.model_dump(mode="json"),
                 "evaluation": evaluations[offer.id].model_dump(mode="json")}
                for offer in offers if offer.id in evaluations
            ],
        }
        should_merge = self.merge_existing if merge_existing is None else merge_existing
        old = {"results": [], "ingestion": []}
        if self.path.exists():
            try:
                old = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                old = {"results": [], "ingestion": []}
        payload["ingestion"] = old.get("ingestion", [])
        if should_merge:
            timestamp = payload["saved_at"]
            previous = {item["offer"]["id"]: {**item, "evaluated_at": item.get("evaluated_at", old.get("saved_at", timestamp))}
                        for item in old.get("results", [])}
            previous.update({item["offer"]["id"]: {**item, "evaluated_at": timestamp} for item in payload["results"]})
            payload["results"] = list(previous.values())
        evaluated = {offer.canonical_id: evaluation.model_dump(mode="json")
                     for offer in offers if (evaluation := evaluations.get(offer.id)) is not None}
        for row in payload["ingestion"]:
            if row.get("canonical_id") in evaluated:
                row.update(status="evaluated", evaluation=evaluated[row["canonical_id"]], updated_at=payload["saved_at"])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            self._write_atomic(payload)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def _write_atomic(self, payload: dict) -> None:
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                    prefix=".makai-", suffix=".json", delete=False) as handle:
                temporary_path = Path(handle.name)
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            temporary_path.replace(self.path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def discover_job(self, offer: JobOffer) -> None:
        payload = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {
            "saved_at": datetime.now(timezone.utc).isoformat(), "results": [], "ingestion": [],
        }
        now = datetime.now(timezone.utc).isoformat()
        rows = payload.setdefault("ingestion", [])
        existing = next((row for row in rows if row.get("canonical_id") == offer.canonical_id), None)
        if existing:
            if existing.get("status") == "discovered":
                existing.update(offer=offer.model_dump(mode="json"), updated_at=now)
        else:
            rows.append({"offer_id": offer.id, "canonical_id": offer.canonical_id,
                         "offer": offer.model_dump(mode="json"), "status": "discovered",
                         "evaluation": None, "created_at": now, "updated_at": now})
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_atomic(payload)

    def mark_filtered_jobs(self, offers: Sequence[JobOffer]) -> None:
        if not offers or not self.path.exists():
            return
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        rejected = {offer.canonical_id for offer in offers}
        now = datetime.now(timezone.utc).isoformat()
        for row in payload.get("ingestion", []):
            if row.get("canonical_id") in rejected and row.get("status") == "discovered":
                row.update(status="filtered", updated_at=now)
        self._write_atomic(payload)


class PostgresEvaluationStore:
    """All rows are saved in one transaction; SQL values are parameterized."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def save(
        self, offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
    ) -> None:
        with psycopg.connect(
            self._database_url, connect_timeout=10,
            options="-c statement_timeout=15000",
        ) as connection, connection.cursor() as cursor:
            cursor.execute("""
                    CREATE TABLE IF NOT EXISTS makai_job_evaluations (
                        offer_id TEXT PRIMARY KEY,
                        offer JSONB NOT NULL,
                        evaluation JSONB NOT NULL,
                        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
            cursor.executemany(
                """
                    INSERT INTO makai_job_evaluations (offer_id, offer, evaluation)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (offer_id) DO UPDATE SET
                        offer = EXCLUDED.offer,
                        evaluation = EXCLUDED.evaluation,
                        evaluated_at = NOW()
                    """,
                [
                    (offer.id, Jsonb(offer.model_dump(mode="json")),
                     Jsonb(evaluations[offer.id].model_dump(mode="json")))
                    for offer in offers if offer.id in evaluations
                ],
            )
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS makai_job_ingestion (
                    offer_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL UNIQUE,
                    offer JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'discovered',
                    evaluation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            for offer in offers:
                if offer.id in evaluations:
                    cursor.execute("""
                        UPDATE makai_job_ingestion SET status='evaluated', evaluation=%s, updated_at=NOW()
                        WHERE canonical_id=%s
                    """, (Jsonb(evaluations[offer.id].model_dump(mode="json")), offer.canonical_id))

    def discover_job(self, offer: JobOffer) -> None:
        with psycopg.connect(self._database_url, connect_timeout=10,
                              options="-c statement_timeout=15000") as connection, connection.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS makai_job_ingestion (
                    offer_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL UNIQUE,
                    offer JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'discovered',
                    evaluation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cursor.execute("""
                INSERT INTO makai_job_ingestion (offer_id, canonical_id, offer)
                VALUES (%s, %s, %s)
                ON CONFLICT (canonical_id) DO UPDATE SET offer=EXCLUDED.offer, updated_at=NOW()
                WHERE makai_job_ingestion.status='discovered'
            """, (offer.id, offer.canonical_id, Jsonb(offer.model_dump(mode="json"))))

    def mark_filtered_jobs(self, offers: Sequence[JobOffer]) -> None:
        if not offers:
            return
        with psycopg.connect(self._database_url, connect_timeout=10,
                              options="-c statement_timeout=15000") as connection, connection.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS makai_job_ingestion (
                    offer_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL UNIQUE,
                    offer JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'discovered',
                    evaluation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            for offer in offers:
                cursor.execute("""
                    UPDATE makai_job_ingestion SET status='filtered', updated_at=NOW()
                    WHERE canonical_id=%s AND status='discovered'
                """, (offer.canonical_id,))


def create_store(settings: Settings) -> EvaluationStore:
    if settings.database_url is not None:
        url = settings.database_url.get_secret_value()
        try:
            scheme = urlsplit(url).scheme
        except ValueError:
            raise StorageConfigurationError("Neplatná DATABASE_URL v .env.") from None
        if scheme in {"libsql", "https"}:
            if settings.turso_auth_token is None:
                raise StorageConfigurationError("Pro Turso doplň TURSO_AUTH_TOKEN v .env.")
            return TursoEvaluationStore(url, settings.turso_auth_token.get_secret_value())
        if scheme in {"postgres", "postgresql"}:
            return PostgresEvaluationStore(url)
        raise StorageConfigurationError("DATABASE_URL musí používat libsql, https nebo postgresql.")
    return JsonEvaluationStore(settings.local_results_path)
