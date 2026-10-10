"""The localhost bridge uses the requested six sources and reports each outcome."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from datetime import UTC, datetime, timedelta
from backend.app.demo import sample_offers, demo_evaluate_job
from backend.tests.test_portals import posting_html

from backend.app.scrapers import DEFAULT_PORTALS

# The executable bridge imports app from its backend script directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    spec = importlib.util.spec_from_file_location("makai_test_local_api", Path(__file__).resolve().parents[1] / "local_api.py")
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
finally:
    sys.path.pop(0)


class LocalHuntTests(unittest.TestCase):
    def test_default_sources_continue_after_failure_and_preserve_profile(self):
        profile = api.get_profile("default")[0]
        settings = Mock(llm_provider="gemini", gemini_api_key="test-only")
        store = Mock(spec=api.TursoEvaluationStore)
        store.known_offer_identities.return_value = (set(), set())
        sources = {key: Mock(portal=api.SCRAPERS[key].portal) for key in DEFAULT_PORTALS}
        for source in sources.values():
            source.return_value.fetch_jobs.return_value = []
        sources["dobraprace"].return_value.fetch_jobs.side_effect = api.ScraperError("DobráPráce.cz: chyba zdroje")
        graph = Mock()
        graph.invoke.side_effect = lambda state: {**state, "saved_ids": []}
        with patch.object(api, "get_profile", return_value=(profile, None, None)), \
             patch.object(api, "get_settings", return_value=settings), \
             patch.object(api, "create_store", return_value=store), \
             patch.object(api, "build_graph", return_value=graph), \
             patch.object(api, "fetch_startupjobs") as startup, \
             patch.dict(api.SCRAPERS, sources):
            result = api.hunt({"profileId": "default", "limit": 1})
        startup.assert_not_called()
        self.assertEqual(len(result["sources"]), 6)
        self.assertEqual([s["status"] for s in result["sources"]], ["done", "done", "error", "done", "done", "done"])
        self.assertEqual(result["errors"], ["DobráPráce.cz: chyba zdroje"])
        for source in sources.values():
            self.assertEqual(source.return_value.fetch_jobs.call_args.args, (1,))
            self.assertIn("accept_offer", source.return_value.fetch_jobs.call_args.kwargs)
        self.assertEqual(result["profileId"], "default")

    def test_time_filter_and_saved_history_reach_only_new_offers_to_evaluator(self):
        now = datetime(2026, 10, 9, 12, tzinfo=UTC)
        cls = api.SCRAPERS["prace"]
        urls = [f"https://www.prace.cz/nabidka/{i}/" for i in range(1, 5)]
        details = [cls()._parse_detail(posting_html(url, datePosted=stamp if stamp is not None else "2026-01-01"), url) for url, stamp in zip(urls,
                   [now.isoformat(), (now - timedelta(days=10)).isoformat(), None, (now - timedelta(hours=1)).isoformat()])]
        # Missing publication date stays unknown rather than using discovery time.
        details[2] = details[2].model_copy(update={"published_at": None})
        store = Mock(spec=api.TursoEvaluationStore)
        store.known_offer_identities.return_value = ({urls[0]}, set())
        store.find_existing_job.return_value = None
        evaluator = Mock(return_value=demo_evaluate_job(sample_offers()[0]))
        graph = api.build_graph(store=store, evaluator=evaluator)
        scraper = Mock(portal="Prace.cz")
        def fetch(limit, *, accept_offer, skip_urls, on_offer=None):
            accepted = [offer for offer in details if str(offer.url) not in skip_urls and accept_offer(offer)]
            if on_offer is not None:
                accepted = [offer for offer in accepted if on_offer(offer) is not False]
            return accepted[:limit]
        scraper.return_value.fetch_jobs.side_effect = fetch
        selection_cls = api.HuntSelection
        settings = Mock(llm_provider="gemini", gemini_api_key="test-only")
        with patch.object(api, "get_settings", return_value=settings), \
             patch.object(api, "create_store", return_value=store), \
             patch.object(api, "build_graph", return_value=graph), \
             patch.object(api, "HuntSelection", side_effect=lambda *a, **kw: selection_cls(*a, **(kw | {"now": now}))), \
             patch.dict(api.SCRAPERS, {"prace": scraper}):
            result = api.hunt({"profileId": "default", "limit": 1, "period": "24h", "portals": ["prace"]})
        self.assertEqual(result["saved"], 1)
        self.assertEqual(result["skippedOutsidePeriod"], 1)
        self.assertEqual(result["skippedUnknownDate"], 1)
        evaluator.assert_called_once()
        self.assertEqual(str(evaluator.call_args.args[0].url), urls[-1])
