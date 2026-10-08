"""Persistence adapters: atomic local snapshot or PostgreSQL batch upsert."""

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Protocol

import psycopg
from psycopg.types.json import Jsonb

from .config import Settings
from .schemas import JobFitEvaluation, JobOffer


class EvaluationStore(Protocol):
    def save(
        self, offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
    ) -> None: ...


class JsonEvaluationStore:
    """Single-process local snapshot, replaced atomically after a successful write."""

    def __init__(self, path: Path) -> None:
        self.path = path

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
        ) as connection:
            with connection.cursor() as cursor:
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
        return PostgresEvaluationStore(settings.database_url.get_secret_value())
    return JsonEvaluationStore(settings.local_results_path)
