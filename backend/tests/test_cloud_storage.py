"""Cloud storage scoping and evaluation caps without network calls."""
import unittest
from unittest.mock import Mock, patch
from backend.app.cloud_storage import ProfileTursoStore
from backend.app.turso import TursoEvaluationStore
from backend.app.graph import build_graph
from backend.app.demo import sample_offers, demo_evaluate_job
from backend.app.evaluator import EvaluationError
from backend.tests.test_graph import RecordingStore, initial_state


class CloudStorageTests(unittest.TestCase):
    def test_profile_scope_rewrites_sql_and_schema_args_without_touching_values(self):
        store = ProfileTursoStore("libsql://example.turso.io", "test-secret", "a" * 64)
        command = {"type": "batch", "batch": {"steps": [
            {"stmt": {"sql": "INSERT INTO makai_job_evaluations VALUES(?,?)", "args": [
                {"type": "text", "value": "makai_job_evaluations"},
                {"type": "text", "value": '{"description":"mentions makai_job_evaluations"}'},
            ]}},
            {"stmt": {"sql": "CREATE INDEX makai_job_canonical_idx ON makai_job_evaluations(offer_id)"}},
        ]}}
        with patch.object(TursoEvaluationStore, "_request", return_value={}) as request:
            store._request(command)
        scoped = request.call_args.args[0]["batch"]["steps"]
        self.assertIn("makai_profile_" + "a" * 64, scoped[0]["stmt"]["sql"])
        self.assertEqual(scoped[0]["stmt"]["args"][0]["value"], store.table)
        self.assertEqual(scoped[0]["stmt"]["args"][1]["value"], command["batch"]["steps"][0]["stmt"]["args"][1]["value"])
        self.assertIn(store.table + "_canonical_idx", scoped[1]["stmt"]["sql"])
        self.assertEqual(command["batch"]["steps"][0]["stmt"]["sql"], "INSERT INTO makai_job_evaluations VALUES(?,?)")

    def test_profile_identifier_cannot_inject_sql(self):
        for profile_id in ("default", "a; DROP TABLE profiles", "../profile", "a" * 63):
            with self.assertRaises(ValueError):
                ProfileTursoStore("libsql://example.turso.io", "test", profile_id)

    def test_cap_applies_after_dedup_and_counts_failed_evaluations(self):
        offers = sample_offers()
        evaluator = Mock(side_effect=EvaluationError("Safe evaluation failure"))
        result = build_graph(evaluator=evaluator, store=RecordingStore(), max_evaluations=1).invoke(initial_state(offers))
        self.assertEqual(evaluator.call_count, 1)
        self.assertTrue(result["evaluation_limit_reached"])
        self.assertFalse(result["evaluations"])
        evaluator = Mock(side_effect=demo_evaluate_job)
        result = build_graph(evaluator=evaluator, store=RecordingStore(), max_evaluations=1).invoke(initial_state([offers[0], offers[0]]))
        self.assertEqual(evaluator.call_count, 1)
        self.assertFalse(result["evaluation_limit_reached"])


if __name__ == "__main__":
    unittest.main()
