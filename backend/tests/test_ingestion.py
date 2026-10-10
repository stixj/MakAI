"""Actual HTTP parser and graph/storage integration; no external services."""

import io
import json
import unittest
from unittest.mock import Mock, patch

import httpx
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.graph import build_graph
from backend.app.scrapers.startupjobs import ScraperError, fetch_startupjobs
from backend.app.turso import TursoError, TursoEvaluationStore
from backend.tests.test_turso import SQLiteHrana
from backend import run_hunt


def listing(source_id=123):
    return {"id": source_id, "name": {"cs": "Python AI Engineer"},
            "slug": {"cs": "python-ai-engineer"}, "company": {"name": "Test firma"}}


def detail(source_id=123, **updates):
    posting = {"@type": "JobPosting", "title": "Python AI Engineer",
               "url": f"https://www.startupjobs.cz/nabidka/{source_id}/python-ai-engineer",
               "hiringOrganization": {"name": "Test firma"},
               "description": "<h2>Vývoj AI</h2><p>Python &amp; RAG.</p>",
               "datePosted": "2026-09-15T07:14:20.000Z",
               "jobLocation": {"address": {"addressLocality": "Brno"}}}
    posting.update(updates)
    return '<script type="application/ld+json">' + json.dumps({"@graph": [posting]}) + '</script>'


class ScraperTests(unittest.TestCase):
    def fetch(self, handler, limit=3):
        real_client = httpx.Client
        with patch("backend.app.scrapers.startupjobs.httpx.Client",
                   side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
            return fetch_startupjobs(limit)

    def test_mocked_source_maps_valid_offer_and_deduplicates_source_ids(self):
        requests = []

        def handler(request):
            requests.append(request)
            if request.method == "POST":
                self.assertIn("fields", json.loads(request.content))
                self.assertEqual(request.headers["Content-Type"], "application/ld+json")
                return httpx.Response(200, json={"member": [listing(), listing()], "view": {}})
            return httpx.Response(200, text=detail())

        offers = self.fetch(handler)
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual((offer.id, offer.title, offer.company),
                         ("startupjobs-123", "Python AI Engineer", "Test firma"))
        self.assertIn("Python & RAG.", offer.raw_description)
        self.assertIn("Brno", offer.raw_description)
        self.assertNotIn("<p>", offer.raw_description)
        self.assertEqual(offer.published_at.isoformat(), "2026-09-15T07:14:20+00:00")
        self.assertEqual(sum(r.method == "GET" for r in requests), 1)
        self.assertTrue(all(r.headers["User-Agent"].startswith("MakAI/") for r in requests))
        self.assertEqual(requests[0].extensions["timeout"]["read"], 20)

    def test_limit_zero_and_invalid_limits_do_not_connect(self):
        with patch("backend.app.scrapers.startupjobs.httpx.Client") as client:
            self.assertEqual(fetch_startupjobs(0), [])
            for value in (-1, 101, True, 1.5):
                with self.assertRaises(ValueError):
                    fetch_startupjobs(value)
        client.assert_not_called()

    def test_searches_rotate_and_pagination_backfills_overlapping_results(self):
        searches = []

        def handler(request):
            if request.method == "POST":
                criteria = json.loads(request.content)
                page = int(request.url.params["page"])
                searches.append((criteria, page))
                # All searches overlap on page 1; Python adds a result on page 2.
                members = [listing(123)] if page == 1 else [listing(124)]
                return httpx.Response(200, json={"member": members,
                    "view": {"next": "/api/search-offers?page=2"} if page == 1 else {}})
            source_id = int(request.url.path.split("/")[2])
            return httpx.Response(200, text=detail(source_id))

        offers = self.fetch(handler, limit=2)
        self.assertEqual([o.id for o in offers], ["startupjobs-123", "startupjobs-124"])
        self.assertEqual(len(searches), 4)
        self.assertEqual(searches[1][0]["query"], "Python")
        self.assertEqual(searches[-1][1], 2)

    def test_source_date_without_time_uses_prague_timezone(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"member": [listing()], "view": {}})
            return httpx.Response(200, text=detail(datePosted="2026-09-15"))
        offers = self.fetch(handler, limit=1)
        self.assertEqual(offers[0].published_at.isoformat(), "2026-09-15T00:00:00+02:00")

    def test_expired_and_gone_offers_are_skipped(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"member": [listing(123), listing(124)], "view": {}})
            if "/124/" in str(request.url):
                return httpx.Response(410)
            return httpx.Response(200, text=detail(validThrough="2020-01-01T00:00:00Z"))
        self.assertEqual(self.fetch(handler), [])

    def test_invalid_dates_and_empty_description_are_not_invented(self):
        for updates in ({"datePosted": ""}, {"datePosted": "2026-01-01T12:00:00"},
                        {"description": ""}):
            def handler(request):
                if request.method == "POST":
                    return httpx.Response(200, json={"member": [listing()], "view": {}})
                return httpx.Response(200, text=detail(**updates))
            with self.subTest(updates=updates), self.assertRaises(ScraperError):
                self.fetch(handler)

    def test_http_and_changed_response_contract_raise_redacted_error(self):
        for response in (httpx.Response(429, text="private response"),
                         httpx.Response(200, json={"changed": []}),
                         httpx.Response(200, text="invalid json")):
            with self.subTest(status=response.status_code), self.assertRaises(ScraperError) as caught:
                self.fetch(lambda request: response)
            self.assertNotIn("private response", str(caught.exception))


class IngestionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = TursoEvaluationStore("libsql://example.turso.io", "test-token")
        self.engine = SQLiteHrana()
        self.addCleanup(self.engine.db.close)
        self.offers = sample_offers()

    def test_mocked_scraper_runs_end_to_end_and_second_run_never_calls_llm(self):
        evaluator = Mock(side_effect=demo_evaluate_job)
        with patch.object(self.store, "_request", side_effect=self.engine), \
             patch("backend.run_hunt.fetch_startupjobs", return_value=self.offers) as scraper:
            graph = build_graph(store=self.store, evaluator=evaluator)
            first = graph.invoke({"offers": scraper(), "evaluations": {}, "errors": []})
            self.assertEqual(first["errors"], [])
            self.assertEqual(first["saved_ids"], [o.id for o in self.offers])
            self.assertEqual(evaluator.call_count, 2)
            evaluator.reset_mock()
            second = graph.invoke({"offers": scraper(), "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(second["errors"], [])
        self.assertEqual(len(second["skipped_duplicates"]), 2)
        self.assertEqual(second["evaluations"], {})
        self.assertEqual(second["saved_ids"], [])
        self.assertEqual(self.engine.db.execute("SELECT COUNT(*) FROM makai_job_evaluations").fetchone()[0], 2)

    def test_url_duplicate_is_skipped_even_with_different_id(self):
        offer = self.offers[0]
        with patch.object(self.store, "_request", side_effect=self.engine):
            self.store.save_evaluated_job(offer, demo_evaluate_job(offer))
            changed = offer.model_copy(update={"id": "different-source-id"})
            evaluator = Mock()
            result = build_graph(store=self.store, evaluator=evaluator).invoke(
                {"offers": [changed], "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(result["skipped_duplicates"], [str(offer.url)])

    def test_db_check_failure_prevents_llm_and_redacts_details(self):
        evaluator = Mock()
        with patch.object(self.store, "_request", side_effect=TursoError("private-token")):
            result = build_graph(store=self.store, evaluator=evaluator).invoke(
                {"offers": self.offers, "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(len(result["errors"]), 2)
        self.assertNotIn("private-token", str(result))

    def test_same_url_in_one_batch_is_evaluated_once(self):
        evaluator = Mock(side_effect=demo_evaluate_job)
        second = self.offers[0].model_copy(update={"id": "second-id"})
        with patch.object(self.store, "_request", side_effect=self.engine):
            result = build_graph(store=self.store, evaluator=evaluator).invoke(
                {"offers": [self.offers[0], second], "evaluations": {}, "errors": []})
        evaluator.assert_called_once()
        self.assertEqual(len(result["skipped_duplicates"]), 1)

    def test_first_run_without_table_is_new_and_sql_values_are_parameterized(self):
        with patch.object(self.store, "_request", side_effect=self.engine):
            self.assertFalse(self.store.is_job_duplicate(str(self.offers[0].url)))
            self.store.save_evaluated_job(self.offers[0], demo_evaluate_job(self.offers[0]))
            self.assertFalse(self.store.is_job_duplicate("'); DROP TABLE makai_job_evaluations; --"))
        self.assertEqual(self.engine.db.execute("SELECT COUNT(*) FROM makai_job_evaluations").fetchone()[0], 1)

    def test_discovered_snapshot_is_committed_then_updated_to_evaluated(self):
        offer = self.offers[0]
        with patch.object(self.store, "_request", side_effect=self.engine):
            self.store.discover_job(offer)
            row = self.engine.db.execute(
                "SELECT status, offer, evaluation FROM makai_job_ingestion WHERE canonical_id=?",
                (offer.canonical_id,),
            ).fetchone()
            self.assertEqual(row[0], "discovered")
            self.assertEqual(json.loads(row[1])["raw_description"], offer.raw_description)
            self.assertIsNone(row[2])
            self.store.save_evaluated_job(offer, demo_evaluate_job(offer))
        row = self.engine.db.execute(
            "SELECT status, evaluation FROM makai_job_ingestion WHERE canonical_id=?",
            (offer.canonical_id,),
        ).fetchone()
        self.assertEqual(row[0], "evaluated")
        self.assertEqual(json.loads(row[1])["score"], 95)

    def test_discovery_checkpoint_failure_prevents_paid_evaluation(self):
        self.engine.fail_commit = True
        with patch.object(self.store, "_request", side_effect=self.engine):
            result = build_graph(store=self.store, evaluator=demo_evaluate_job).invoke(
                {"offers": self.offers[:1], "evaluations": {}, "errors": []})
        self.assertEqual(len(result["evaluations"]), 0)
        self.assertEqual(result["saved_ids"], [])
        self.assertEqual(len(result["errors"]), 1)
        self.assertFalse(self.engine.db.in_transaction)

    def test_cli_displays_counts_scores_reasons_and_successful_saves(self):
        output = io.StringIO()
        from rich.console import Console
        graph = build_graph(store=self.store, evaluator=demo_evaluate_job)
        with patch.object(self.store, "_request", side_effect=self.engine), \
             patch.object(self.store, "check_connection"), \
             patch("backend.run_hunt.get_settings"), \
             patch("backend.run_hunt.create_store", return_value=self.store), \
             patch("backend.run_hunt.build_graph", return_value=graph), \
             patch("backend.run_hunt.fetch_startupjobs", return_value=self.offers), \
             patch("backend.run_hunt.Console", return_value=Console(file=output, width=180)):
            self.assertEqual(run_hunt.main(["--portals", "startupjobs", "--limit", "2"]), 0)
            self.assertEqual(run_hunt.main(["--portals", "startupjobs", "--limit", "2"]), 0)
        text = output.getvalue()
        self.assertIn("STRONG_FIT", text)
        self.assertIn("95/100", text)
        self.assertIn("Klíčové důvody", text)
        self.assertIn("Přeskočeno duplicit: 2", text)
        self.assertIn("uloženo do Turso: 2", text)


if __name__ == "__main__":
    unittest.main()
