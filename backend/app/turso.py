"""Turso libSQL persistence over HTTPS, using only the Python standard library."""

import json
from collections.abc import Mapping, Sequence
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

    def known_offer_identities(self) -> tuple[set[str], set[str]]:
        """Read only saved identities, including every portal URL, in bounded pages."""
        table = self._request({"type": "execute", "stmt": {
            "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            "args": [{"type": "text", "value": "makai_job_evaluations"}],
        }})
        if not table.get("rows"):
            return set(), set()
        urls, identities = set(), set()
        offset = 0
        while True:
            result = self._request({"type": "execute", "stmt": {
                "sql": "SELECT json_extract(offer, '$.url'), json_extract(offer, '$.canonical_id'), "
                       "json_extract(offer, '$.sources') FROM makai_job_evaluations "
                       "ORDER BY offer_id LIMIT 500 OFFSET ?",
                "args": [{"type": "integer", "value": str(offset)}],
            }})
            rows = result["rows"]
            for row in rows:
                url, canonical, sources = [cell.get("value") for cell in row]
                if url:
                    urls.add(url)
                if canonical:
                    identities.add(canonical)
                for source in json.loads(sources or "[]"):
                    if isinstance(source, dict) and isinstance(source.get("url"), str):
                        urls.add(source["url"])
            if len(rows) < 500:
                break
            offset += 500
        return urls, identities

    def save_evaluated_job(self, offer: JobOffer, evaluation: JobFitEvaluation) -> None:
        self.upsert_or_enrich_job(offer, evaluation)

    def discover_job(self, offer: JobOffer) -> None:
        from .db import discover_job
        discover_job(self, offer)

    def mark_filtered_jobs(self, offers) -> None:
        from .db import mark_filtered_jobs
        mark_filtered_jobs(self, offers)

    def find_existing_job(self, offer: JobOffer) -> JobOffer | None:
        from .db import find_existing_job
        return find_existing_job(self, offer)

    def upsert_or_enrich_job(self, offer: JobOffer, eval: JobFitEvaluation | None = None) -> None:
        from .db import upsert_or_enrich_job
        upsert_or_enrich_job(offer, eval, store=self)

    def save(
        self,
        offers: Sequence[JobOffer],
        evaluations: Mapping[str, JobFitEvaluation],
    ) -> None:
        from .db import save_evaluations
        save_evaluations(self, offers, evaluations)
