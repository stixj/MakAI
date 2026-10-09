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
    ) -> None:
        payload = {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "results": [
                {"offer": offer.model_dump(mode="json"),
                 "evaluation": evaluations[offer.id].model_dump(mode="json")}
                for offer in offers if offer.id in evaluations
            ],
        }
        if self.merge_existing:
            timestamp = payload["saved_at"]
            old = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {"results": [], "saved_at": timestamp}
            previous = {item["offer"]["id"]: {**item, "evaluated_at": item.get("evaluated_at", old["saved_at"])}
                        for item in old["results"]}
            previous.update({item["offer"]["id"]: {**item, "evaluated_at": timestamp} for item in payload["results"]})
            payload["results"] = list(previous.values())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.path.parent,
                prefix=".makai-", suffix=".json", delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            temporary_path.replace(self.path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)


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
