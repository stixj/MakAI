"""Turso tests use local SQLite or mocked HTTP, never the real .env or network."""

import io
import json
import sqlite3
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from backend.app.config import Settings
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.storage import (
    JsonEvaluationStore,
    PostgresEvaluationStore,
    create_store,
)
from backend.app.turso import (
    StorageConfigurationError,
    TursoError,
    TursoEvaluationStore,
    _NoRedirect,
    turso_endpoint,
)


class SQLiteHrana:
    """Execute the adapter's actual SQL and batch conditions on an in-memory DB."""

    def __init__(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.fail_commit = False

    def __call__(self, command):
        if command["type"] == "execute":
            stmt = command["stmt"]
            cursor = self.db.execute(stmt["sql"], [arg["value"] for arg in stmt.get("args", [])])
            return {"rows": [
                [{"type": "integer" if isinstance(value, int) else "text", "value": str(value)}
                 for value in row] for row in cursor.fetchall()
            ]}
        successes, errors = [], []

        def permitted(condition):
            if condition is None:
                return True
            kind = condition["type"]
            if kind == "ok":
                return successes[condition["step"]] is not None
            if kind == "not":
                return not permitted(condition["cond"])
            if kind == "and":
                return all(permitted(item) for item in condition["conds"])
            raise AssertionError("Unexpected batch condition")

        for step in command["batch"]["steps"]:
            if not permitted(step.get("condition")):
                successes.append(None)
                errors.append(None)
                continue
            stmt = step["stmt"]
            try:
                if self.fail_commit and stmt["sql"] == "COMMIT":
                    raise sqlite3.OperationalError("simulated COMMIT failure")
                cursor = self.db.execute(
                    stmt["sql"], [arg["value"] for arg in stmt.get("args", [])]
                )
                successes.append(
                    {"rows": [], "affected_row_count": max(0, cursor.rowcount)}
                )
                errors.append(None)
            except sqlite3.Error:
                successes.append(None)
                errors.append({"message": "private server details"})
        return {"step_results": successes, "step_errors": errors}


class TursoTests(unittest.TestCase):
    def setUp(self):
        self.store = TursoEvaluationStore(
            "libsql://example.turso.io", "fake-test-token"
        )
        self.offers = sample_offers()
        self.evaluations = {offer.id: demo_evaluate_job(offer) for offer in self.offers}
        self.engine = SQLiteHrana()
        self.addCleanup(self.engine.db.close)

    def test_config_selects_turso_postgres_or_local_and_masks_token(self):
        settings = Settings(
            database_url="libsql://example.turso.io", turso_auth_token="fake-test-token"
        )
        self.assertIsInstance(create_store(settings), TursoEvaluationStore)
        self.assertNotIn("fake-test-token", repr(settings))
        self.assertIsInstance(
            create_store(Settings(database_url="postgresql://example")),
            PostgresEvaluationStore,
        )
        self.assertIsInstance(create_store(Settings()), JsonEvaluationStore)
        self.assertIsNone(Settings(turso_auth_token=" ").turso_auth_token)
        with self.assertRaisesRegex(StorageConfigurationError, "TURSO_AUTH_TOKEN"):
            create_store(Settings(database_url="libsql://example.turso.io"))
        with self.assertRaises(StorageConfigurationError):
            create_store(Settings(database_url="mysql://example"))

    def test_endpoint_requires_tls_and_rejects_credentials_or_malformed_urls(self):
        self.assertEqual(
            turso_endpoint("libsql://example.turso.io"),
            "https://example.turso.io/v2/pipeline",
        )
        self.assertEqual(
            turso_endpoint("https://example.turso.io/"),
            "https://example.turso.io/v2/pipeline",
        )
        for url in (
            "http://example",
            "libsql:///",
            "libsql://user:private@example",
            "libsql://example/path",
            "libsql://example?token=private",
            "libsql://example:bad",
            "libsql://[bad",
        ):
            with (
                self.subTest(url=url),
                self.assertRaises(StorageConfigurationError) as caught,
            ):
                turso_endpoint(url)
            self.assertNotIn("private", str(caught.exception))
        for token in ("", "bad\r\ntoken"):
            with self.assertRaises(StorageConfigurationError):
                TursoEvaluationStore("libsql://example", token)

    def test_sql_round_trip_upsert_unicode_and_injection_are_safe(self):
        attack = "id'); DROP TABLE makai_job_evaluations; --"
        offers = [
            self.offers[0].model_copy(
                update={"id": attack, "company": "Česká společnost"}
            )
        ]
        evaluations = {attack: self.evaluations[self.offers[0].id]}
        with patch.object(self.store, "_request", side_effect=self.engine):
            self.store.save(offers, evaluations)
            changed = offers[0].model_copy(update={"company": "Žlutý kůň"})
            self.store.save([changed], evaluations)
        rows = self.engine.db.execute(
            "SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations"
        ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], attack)
        self.assertEqual(json.loads(rows[0][1])["company"], "Žlutý kůň")
        self.assertEqual(
            json.loads(rows[0][2]), evaluations[attack].model_dump(mode="json")
        )
        self.assertTrue(rows[0][3].endswith("+00:00"))
        self.assertFalse(self.engine.db.in_transaction)

    def test_failure_after_first_upsert_rolls_back_and_preserves_prior_data(self):
        self.engine.db.execute("""CREATE TABLE makai_job_evaluations (
            offer_id TEXT PRIMARY KEY CHECK (offer_id != 'demo-sales'),
            offer TEXT NOT NULL, evaluation TEXT NOT NULL, evaluated_at TEXT NOT NULL
        )""")
        with patch.object(self.store, "_request", side_effect=self.engine):
            self.store.save(self.offers[:1], self.evaluations)
            before = self.engine.db.execute(
                "SELECT * FROM makai_job_evaluations"
            ).fetchall()
            changed = self.offers[0].model_copy(
                update={"company": "must be rolled back"}
            )
            with self.assertRaises(TursoError) as caught:
                self.store.save([changed, self.offers[1]], self.evaluations)
        self.assertNotIn("private", str(caught.exception))
        self.assertEqual(
            self.engine.db.execute("SELECT * FROM makai_job_evaluations").fetchall(),
            before,
        )
        self.assertFalse(self.engine.db.in_transaction)

    def test_commit_failure_rolls_back_table_creation_and_rows(self):
        self.engine.fail_commit = True
        with (
            patch.object(self.store, "_request", side_effect=self.engine),
            self.assertRaises(TursoError),
        ):
            self.store.save(self.offers, self.evaluations)
        self.assertEqual(
            self.engine.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall(),
            [],
        )
        self.assertFalse(self.engine.db.in_transaction)

    def test_empty_or_unevaluated_batch_does_not_connect(self):
        with patch.object(self.store, "_request") as request:
            self.store.save([], {})
            self.store.save(self.offers, {})
        request.assert_not_called()

    def test_http_auth_timeout_close_and_readonly_check(self):
        response = {
            "results": [
                {
                    "type": "ok",
                    "response": {
                        "type": "execute",
                        "result": {"rows": [[{"type": "integer", "value": "1"}]]},
                    },
                },
                {"type": "ok", "response": {"type": "close"}},
            ]
        }
        with patch("backend.app.turso.build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = json.dumps(
                response
            ).encode()
            self.store.check_connection()
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.turso.io/v2/pipeline")
        self.assertEqual(request.get_header("Authorization"), "Bearer fake-test-token")
        self.assertEqual(opener.return_value.open.call_args.kwargs["timeout"], 15)
        body = json.loads(request.data)
        self.assertEqual(body["requests"][0]["stmt"]["sql"], "SELECT 1")
        self.assertEqual(body["requests"][1], {"type": "close"})
        self.assertIsNone(
            _NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://other.example"
            )
        )

    def test_transport_and_sql_failures_are_redacted(self):
        cases = [
            HTTPError(
                "https://private",
                401,
                "private-token",
                {},
                io.BytesIO(b"private server body"),
            ),
            HTTPError(
                "https://private",
                302,
                "private-token",
                {},
                io.BytesIO(b"private server body"),
            ),
            URLError("private-token"),
            TimeoutError("private-token"),
        ]
        for error in cases:
            with (
                self.subTest(error=type(error).__name__),
                patch("backend.app.turso.build_opener") as opener,
            ):
                opener.return_value.open.side_effect = error
                with self.assertRaises(TursoError) as caught:
                    self.store.check_connection()
                self.assertNotIn("private", str(caught.exception))
        payload = {
            "results": [
                {"type": "error", "error": {"message": "private-token"}},
                {"type": "ok"},
            ]
        }
        with patch("backend.app.turso.build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = json.dumps(
                payload
            ).encode()
            with self.assertRaises(TursoError) as caught:
                self.store.check_connection()
        self.assertNotIn("private", str(caught.exception))

    def test_invalid_or_incomplete_responses_cannot_report_success(self):
        for raw in (
            b"not json",
            b"[]",
            b"{}",
            b'{"results":[null,null]}',
            b"x" * 2_000_001,
        ):
            with (
                self.subTest(size=len(raw)),
                patch("backend.app.turso.build_opener") as opener,
            ):
                opener.return_value.open.return_value.__enter__.return_value.read.return_value = raw
                with self.assertRaises(TursoError):
                    self.store.check_connection()
        for result in (
            {},
            {"step_results": [], "step_errors": []},
            {"step_results": [None] * 6, "step_errors": [None] * 6},
        ):
            with (
                patch.object(self.store, "_request", return_value=result),
                self.assertRaises(TursoError),
            ):
                self.store.save(self.offers, self.evaluations)
