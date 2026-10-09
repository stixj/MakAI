"""Workflow and persistence checks; no network, credentials or database needed."""

from collections.abc import Mapping, Sequence
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
import unittest
from unittest.mock import Mock, patch

from backend.app.config import PROJECT_ROOT, Settings, get_settings
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.evaluator import EvaluationError
from backend.app.graph import build_graph, filter_offers
from backend.app.schemas import JobFitEvaluation, JobOffer, MakAIState
from backend.app.storage import JsonEvaluationStore, PostgresEvaluationStore, create_store


class RecordingStore:
    def __init__(self) -> None:
        self.calls: list[dict[str, JobFitEvaluation]] = []

    def save(self, offers: Sequence[JobOffer], evaluations: Mapping[str, JobFitEvaluation]) -> None:
        self.calls.append(dict(evaluations))


def initial_state(offers: list[JobOffer] | None = None) -> MakAIState:
    return {"offers": sample_offers() if offers is None else offers, "evaluations": {}, "errors": []}


class GraphTests(unittest.TestCase):
    def test_entire_graph_produces_strong_fit_and_no_go_and_saves(self) -> None:
        store = RecordingStore()
        graph = build_graph(evaluator=demo_evaluate_job, store=store)
        result = cast(MakAIState, graph.invoke(initial_state()))
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["evaluations"]["demo-ai-agent"].verdict, "STRONG_FIT")
        self.assertEqual(result["evaluations"]["demo-sales"].verdict, "NO_GO")
        self.assertEqual(store.calls, [{offer.id: result["evaluations"][offer.id]}
                                       for offer in sample_offers()])

    def test_filter_returns_only_modified_channels(self):
        state = initial_state()
        update = filter_offers(state)
        self.assertEqual(set(update), {"offers", "errors"})
        self.assertEqual(state, initial_state())

    def test_state_is_updated_and_saved_before_next_offer(self):
        offers = sample_offers()
        store = RecordingStore()

        def evaluator(offer):
            if offer.id == offers[1].id:
                self.assertEqual(store.calls, [{offers[0].id: demo_evaluate_job(offers[0])}])
            return demo_evaluate_job(offer)

        updates = list(build_graph(store=store, evaluator=evaluator).stream(
            initial_state(offers), stream_mode="updates"))
        saves = [update["save"] for update in updates if "save" in update]
        self.assertEqual([update["saved_ids"] for update in saves],
                         [[offers[0].id], [offer.id for offer in offers]])
        self.assertTrue(all("offers" not in update for update in saves))

    def test_large_batch_does_not_hit_default_graph_recursion_limit(self):
        base = sample_offers()[0]
        offers = [JobOffer.model_validate(base.model_dump() | {
            "id": f"offer-{i}", "title": f"Position {i}",
            "url": f"https://example.com/{i}", "canonical_id": "", "sources": [],
        }) for i in range(100)]
        store = RecordingStore()
        result = build_graph(store=store, evaluator=lambda offer: demo_evaluate_job(base)).invoke(initial_state(offers))
        self.assertEqual(len(result["saved_ids"]), 100)
        self.assertEqual(len(store.calls), 100)

    def test_failed_save_does_not_report_success_and_next_save_can_recover(self):
        offers = sample_offers()
        store = Mock()
        store.save.side_effect = [OSError("private database details"), None]
        result = build_graph(store=store, evaluator=demo_evaluate_job).invoke(initial_state(offers))
        self.assertEqual(result["saved_ids"], [offers[1].id])
        self.assertEqual(len(result["evaluations"]), 2)
        self.assertEqual(len(result["errors"]), 1)
        self.assertNotIn("private", result["errors"][0])

    def test_json_results_survive_interruption_on_fifth_offer(self):
        base = sample_offers()[0]
        offers = [JobOffer.model_validate(base.model_dump() | {
            "id": f"offer-{i}", "title": f"Position {i}",
            "url": f"https://example.com/{i}", "canonical_id": "", "sources": [],
        }) for i in range(10)]
        with TemporaryDirectory() as directory:
            path = Path(directory) / "results.json"

            def evaluator(offer):
                if offer.id == offers[4].id:
                    raise KeyboardInterrupt()
                return demo_evaluate_job(base)

            with self.assertRaises(KeyboardInterrupt):
                build_graph(store=JsonEvaluationStore(path), evaluator=evaluator).invoke(initial_state(offers))
            persisted = json.loads(path.read_text(encoding="utf-8"))["results"]
            self.assertEqual([item["offer"]["id"] for item in persisted],
                             [offer.id for offer in offers[:4]])

    def test_failure_of_one_offer_preserves_and_saves_other_result(self) -> None:
        def sometimes_fails(offer: JobOffer) -> JobFitEvaluation:
            if offer.id == "demo-ai-agent":
                raise EvaluationError("Test provider failure")
            return demo_evaluate_job(offer)

        store = RecordingStore()
        result = build_graph(evaluator=sometimes_fails, store=store).invoke(initial_state())
        self.assertEqual(set(result["evaluations"]), {"demo-sales"})
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(len(store.calls), 1)

    def test_quota_failure_stops_remaining_offers_and_preserves_saved_results(self):
        evaluator = Mock(side_effect=[demo_evaluate_job(sample_offers()[0]),
                         EvaluationError("Gemini: vyčerpán denní limit", kind="daily_quota", stop_batch=True)])
        third = JobOffer.model_validate(sample_offers()[1].model_dump() | {"id": "third", "title": "Jiná pozice", "url": "https://example.com/third", "canonical_id": "", "sources": []})
        store = RecordingStore()
        result = build_graph(evaluator=evaluator, store=store).invoke(initial_state([*sample_offers(), third]))
        self.assertEqual(evaluator.call_count, 2)
        self.assertEqual(result["saved_ids"], ["demo-ai-agent"])
        self.assertEqual(result["evaluation_blocked"]["notEvaluated"], 2)
        self.assertEqual(result["evaluation_blocked"]["kind"], "daily_quota")
        self.assertEqual(len(result["errors"]), 1)

    def test_duplicate_ids_are_evaluated_once(self) -> None:
        offer = sample_offers()[0]
        evaluator = Mock(side_effect=demo_evaluate_job)
        result = build_graph(evaluator=evaluator, store=RecordingStore()).invoke(initial_state([offer, offer]))
        evaluator.assert_called_once_with(offer)
        self.assertEqual(len(result["offers"]), 1)
        self.assertIn("duplicitní id", result["errors"][0])

    def test_empty_batch_does_not_overwrite_saved_data(self) -> None:
        store = RecordingStore()
        result = build_graph(evaluator=demo_evaluate_job, store=store).invoke(initial_state([]))
        self.assertEqual(result["evaluations"], {})
        self.assertEqual(store.calls, [])

    def test_invalid_offer_is_reported_without_stopping_valid_offers(self) -> None:
        state = initial_state()
        state["offers"] = cast(list[JobOffer], [{"id": "invalid"}, sample_offers()[0]])
        result = build_graph(evaluator=demo_evaluate_job, store=RecordingStore()).invoke(state)
        self.assertEqual(set(result["evaluations"]), {"demo-ai-agent"})
        self.assertIn("Ingest", result["errors"][0])

    def test_stale_evaluation_is_not_reused(self) -> None:
        state = initial_state([sample_offers()[0]])
        state["evaluations"] = {"stale-id": demo_evaluate_job(sample_offers()[0])}
        result = build_graph(evaluator=demo_evaluate_job, store=RecordingStore()).invoke(state)
        self.assertEqual(set(result["evaluations"]), {"demo-ai-agent"})

    def test_save_failure_keeps_evaluations_and_redacts_database_details(self) -> None:
        store = Mock()
        store.save.side_effect = RuntimeError("postgresql://secret:password@host")
        result = build_graph(evaluator=demo_evaluate_job, store=store).invoke(initial_state())
        self.assertEqual(len(result["evaluations"]), 2)
        self.assertIn("Save: RuntimeError", result["errors"][0])
        self.assertNotIn("password", result["errors"][0])


class StorageAndConfigTests(unittest.TestCase):
    def test_local_snapshot_round_trips_domain_objects(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "results.json"
            offers = sample_offers()
            evaluations = {offer.id: demo_evaluate_job(offer) for offer in offers}
            JsonEvaluationStore(path).save(offers, evaluations)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["results"]), 2)
            for row in payload["results"]:
                offer = JobOffer.model_validate(row["offer"])
                self.assertEqual(JobFitEvaluation.model_validate(row["evaluation"]), evaluations[offer.id])

    def test_failed_local_write_preserves_previous_snapshot(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "results.json"
            path.write_text("previous data", encoding="utf-8")
            with patch("backend.app.storage.json.dump", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    JsonEvaluationStore(path).save(sample_offers(), {})
            self.assertEqual(path.read_text(encoding="utf-8"), "previous data")
            self.assertEqual(list(path.parent.glob(".makai-*")), [])

    def test_postgres_adapter_uses_transaction_and_parameterized_upsert(self) -> None:
        offers = sample_offers()
        evaluations = {offer.id: demo_evaluate_job(offer) for offer in offers}
        with patch("backend.app.storage.psycopg.connect") as connect:
            PostgresEvaluationStore("postgresql://test-only").save(offers, evaluations)
        connection = connect.return_value.__enter__.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        sql, rows = cursor.executemany.call_args.args
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("VALUES (%s, %s, %s)", sql)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], offers[0].id)
        connect.return_value.__exit__.assert_called_once()

    def test_store_selection_and_root_relative_path(self) -> None:
        settings = Settings(local_results_path="data/custom.json")
        self.assertEqual(settings.local_results_path, PROJECT_ROOT / "data" / "custom.json")
        self.assertIsInstance(create_store(settings), JsonEvaluationStore)
        self.assertIsInstance(create_store(Settings(database_url="postgresql://test-only")), PostgresEvaluationStore)

    def test_environment_overrides_dotenv_and_blanks_disable_secrets(self) -> None:
        get_settings.cache_clear()
        try:
            with patch("backend.app.config.dotenv_values", return_value={"GEMINI_API_KEY": "file-key"}), \
                 patch.dict("os.environ", {"GEMINI_API_KEY": "", "LLM_PROVIDER": "openai"}, clear=True):
                settings = get_settings()
            self.assertIsNone(settings.gemini_api_key)
            self.assertEqual(settings.llm_provider, "openai")
        finally:
            get_settings.cache_clear()


if __name__ == "__main__":
    unittest.main()
