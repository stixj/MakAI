"""Turso libSQL persistence over HTTPS, using only the Python standard library."""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .schemas import JobFitEvaluation, JobOffer


class StorageConfigurationError(ValueError):
    """Actionable configuration error whose message never contains secrets."""


class TursoError(RuntimeError):
    """Redacted transport or SQL error; never exposes server responses."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Authorization must never follow a redirect to another destination.
        return None


def turso_endpoint(database_url: str) -> str:
    try:
        parsed = urlsplit(database_url)
        valid = (
            parsed.scheme in {"libsql", "https"}
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )
        # Accessing port also rejects malformed/non-numeric ports.
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise StorageConfigurationError(
            "Neplatná Turso URL: použij libsql://HOST bez hesla, cesty a parametrů."
        )
    return f"https://{parsed.netloc}/v2/pipeline"


class TursoEvaluationStore:
    """Parameterized upserts in a conditional Hrana batch with commit/rollback."""

    def __init__(self, database_url: str, auth_token: str) -> None:
        self._endpoint = turso_endpoint(database_url)
        if not auth_token.strip() or "\r" in auth_token or "\n" in auth_token:
            raise StorageConfigurationError(
                "Chybí nebo je neplatný TURSO_AUTH_TOKEN v .env."
            )
        self._auth_token = auth_token.strip()

    def _request(self, command: dict) -> dict:
        body = json.dumps({"requests": [command, {"type": "close"}]}).encode("utf-8")
        request = Request(
            self._endpoint,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._auth_token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with build_opener(_NoRedirect).open(request, timeout=15) as response:
                # Bound unexpected error bodies; never log or return raw responses.
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise TursoError("Příliš velká odpověď Turso.")
            payload = json.loads(raw)
        except HTTPError as exc:
            exc.close()
            raise TursoError(
                f"Turso HTTP {exc.code}; zkontroluj URL a databázový token."
            ) from None
        except (URLError, OSError):
            raise TursoError(
                "Spojení s Turso selhalo; stav zápisu nelze potvrdit."
            ) from None
        except (ValueError, UnicodeError):
            raise TursoError("Neplatná JSON odpověď Turso.") from None
        if not isinstance(payload, dict):
            raise TursoError("Neplatná odpověď Turso.")
        results = payload.get("results")
        if not isinstance(results, list) or len(results) != 2:
            raise TursoError("Neúplná odpověď Turso.")
        first, closed = results
        if (
            not isinstance(first, dict)
            or first.get("type") != "ok"
            or not isinstance(closed, dict)
            or closed.get("type") != "ok"
        ):
            raise TursoError("Turso odmítlo databázový požadavek.")
        response = first.get("response")
        if not isinstance(response, dict) or response.get("type") != command["type"]:
            raise TursoError("Neočekávaná odpověď Turso.")
        result = response.get("result")
        if not isinstance(result, dict):
            raise TursoError("Chybí výsledek Turso.")
        return result

    def check_connection(self) -> None:
        """Read-only health check: does not create a table or save offers."""
        result = self._request({"type": "execute", "stmt": {"sql": "SELECT 1"}})
        if result.get("rows") != [[{"type": "integer", "value": "1"}]]:
            raise TursoError("Turso nepotvrdilo kontrolní dotaz.")

    def is_job_duplicate(self, url: str) -> bool:
        """Read stored JSON URLs, including rows saved before ingestion existed."""
        table = self._request({"type": "execute", "stmt": {
            "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            "args": [{"type": "text", "value": "makai_job_evaluations"}],
        }})
        if table.get("rows") == []:
            return False
        if table.get("rows") != [[{"type": "text", "value": "makai_job_evaluations"}]]:
            raise TursoError("Neplatný výsledek kontroly tabulky Turso.")
        result = self._request({"type": "execute", "stmt": {
            "sql": "SELECT EXISTS (SELECT 1 FROM makai_job_evaluations "
                   "WHERE json_extract(offer, '$.url') = ?)",
            "args": [{"type": "text", "value": str(url)}],
        }})
        rows = result.get("rows")
        if rows == [[{"type": "integer", "value": "1"}]]:
            return True
        if rows == [[{"type": "integer", "value": "0"}]]:
            return False
        raise TursoError("Neplatný výsledek deduplikace Turso.")

    def save_evaluated_job(self, offer: JobOffer, evaluation: JobFitEvaluation) -> None:
        """Save an offer and its evaluation together in the existing transaction."""
        self.save([offer], {offer.id: evaluation})

    def save(
        self,
        offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
    ) -> None:
        rows = [offer for offer in offers if offer.id in evaluations]
        if not rows:
            return
        steps: list[dict] = [{"stmt": {"sql": "BEGIN IMMEDIATE", "want_rows": False}}]

        def append_statement(sql: str, args: list[dict] | None = None) -> None:
            steps.append(
                {
                    "condition": {"type": "ok", "step": len(steps) - 1},
                    "stmt": {"sql": sql, "args": args or [], "want_rows": False},
                }
            )

        append_statement("""
            CREATE TABLE IF NOT EXISTS makai_job_evaluations (
                offer_id TEXT PRIMARY KEY,
                offer TEXT NOT NULL,
                evaluation TEXT NOT NULL,
                evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        append_statement("""
            CREATE INDEX IF NOT EXISTS makai_job_url_idx
            ON makai_job_evaluations (json_extract(offer, '$.url'))
        """)
        timestamp = datetime.now(UTC).isoformat()
        for offer in rows:
            append_statement(
                """
                INSERT INTO makai_job_evaluations (offer_id, offer, evaluation, evaluated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (offer_id) DO UPDATE SET
                    offer = excluded.offer,
                    evaluation = excluded.evaluation,
                    evaluated_at = excluded.evaluated_at
            """,
                [
                    {"type": "text", "value": value}
                    for value in (
                        offer.id,
                        offer.model_dump_json(),
                        evaluations[offer.id].model_dump_json(),
                        timestamp,
                    )
                ],
            )
        commit_index = len(steps)
        append_statement("COMMIT")
        steps.append(
            {
                "condition": {
                    "type": "and",
                    "conds": [
                        {"type": "ok", "step": 0},
                        {"type": "not", "cond": {"type": "ok", "step": commit_index}},
                    ],
                },
                "stmt": {"sql": "ROLLBACK", "want_rows": False},
            }
        )
        result = self._request({"type": "batch", "batch": {"steps": steps}})
        successes, errors = result.get("step_results"), result.get("step_errors")
        if (
            not isinstance(successes, list)
            or not isinstance(errors, list)
            or len(successes) != len(steps)
            or len(errors) != len(steps)
            or any(error is not None for error in errors)
            or not all(isinstance(item, dict) for item in successes[: commit_index + 1])
            or successes[-1] is not None
        ):
            raise TursoError("Uložení do Turso selhalo; úspěšný COMMIT nebyl potvrzen.")
