"""Date boundaries, unknown dates, persisted identities and atomic history append."""
import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import httpx
from backend.app.hunt_filters import HuntSelection, filter_promising_offers
from backend.app.profile import MASTER_PROFILE
from backend.app.scrapers.portals import PraceCzScraper
from backend.app.demo import sample_offers, demo_evaluate_job
from backend.app.storage import JsonEvaluationStore
from backend.app.turso import TursoEvaluationStore
from backend.tests.test_turso import SQLiteHrana
from backend.tests.test_portals import posting_html


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 9, 12, tzinfo=UTC)
        self.offer = sample_offers()[0]

    def _raw_offer(self, title, location):
        return self.offer.model_copy(update={"title": title, "location": location})

    def test_deterministic_prefilter_keeps_brno_remote_and_junior_senior_roles(self):
        offers = [self._raw_offer("Python Developer (Junior)", "Brno"),
                  self._raw_offer("Python Developer (Senior)", "Remote")]
        accepted, rejected = filter_promising_offers(offers, MASTER_PROFILE)
        self.assertEqual(accepted, offers)
        self.assertEqual(rejected, [])

    def test_deterministic_prefilter_drops_other_city_without_remote_and_no_go_title(self):
        ostrava = self._raw_offer("Python Developer", "Ostrava")
        welder = self._raw_offer("Svářeč CO2", "Brno")
        accepted, rejected = filter_promising_offers([ostrava, welder], MASTER_PROFILE)
        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [ostrava, welder])

    def test_rolling_windows_include_boundary_and_exclude_older_or_future(self):
        for period, hours in (("24h", 24), ("7d", 168), ("30d", 720)):
            selection = HuntSelection(period, now=self.now)
            boundary = self.now - timedelta(hours=hours)
            for stamp, expected in ((boundary, True), (boundary - timedelta(seconds=1), False),
                                    (self.now, True), (self.now + timedelta(seconds=1), False)):
                with self.subTest(period=period, stamp=stamp):
                    self.assertEqual(selection.accept(self.offer.model_copy(update={"published_at": stamp})), expected)

    def test_unknown_dates_require_explicit_inclusion_and_are_counted(self):
        offer = self.offer.model_copy(update={"published_at": None})
        selection = HuntSelection("24h", now=self.now)
        self.assertFalse(selection.accept(offer))
        self.assertEqual(selection.counts["unknownDate"], 1)
        self.assertTrue(HuntSelection("24h", True, now=self.now).accept(offer))
        self.assertTrue(HuntSelection("all", now=self.now).accept(offer))
        for period, flag in (("week", False), (24, False), ("7d", "true")):
            with self.assertRaises(ValueError):
                HuntSelection(period, flag)

    def test_saved_identity_is_skipped_even_when_url_changes_or_date_is_recent(self):
        fresh = self.offer.model_copy(update={"published_at": self.now})
        by_url = HuntSelection("24h", known_urls=[str(fresh.url) + "?tracking=old"], now=self.now)
        self.assertFalse(by_url.accept(fresh))
        by_identity = HuntSelection("all", known_ids=[fresh.canonical_id], now=self.now)
        self.assertFalse(by_identity.accept(fresh.model_copy(update={"url": "https://www.prace.cz/nabidka/other/"})))

    def test_rejected_and_known_offers_do_not_consume_limit_or_repeat_detail_requests(self):
        urls = [f"https://www.prace.cz/nabidka/{i}/" for i in range(1, 5)]
        requests = []
        def handler(request):
            url = str(request.url)
            requests.append(url)
            if url in urls:
                return httpx.Response(200, text=posting_html(url, datePosted="2026-10-09T11:00:00Z" if url == urls[-1] else "2026-01-01"))
            return httpx.Response(200, text="".join(f'<a href="{url}">Pozice</a>' for url in urls))
        selection = HuntSelection("24h", known_urls=[urls[0]], now=self.now)
        client = httpx.Client
        with patch("backend.app.scrapers.portals.httpx.Client", side_effect=lambda **kw: client(transport=httpx.MockTransport(handler), **kw)):
            scraper = PraceCzScraper()
            offers = scraper.fetch_jobs(1, accept_offer=selection.accept, skip_urls=selection.known_urls)
        self.assertEqual([str(offer.url) for offer in offers], [urls[-1]])
        self.assertNotIn(urls[0], requests)
        self.assertEqual(selection.counts["outsidePeriod"], 2)
        self.assertEqual(scraper.stats["knownUrls"], 1)

    def test_json_history_append_preserves_old_evaluation_date_and_survives_write_failure(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / "results.json"
            store = JsonEvaluationStore(file, merge_existing=True)
            first, second = sample_offers()
            store.save([first], {first.id: demo_evaluate_job(first)})
            old = json.loads(file.read_text(encoding="utf8"))["results"][0]
            store.save([second], {second.id: demo_evaluate_job(second)})
            data = json.loads(file.read_text(encoding="utf8"))
            self.assertEqual(len(data["results"]), 2)
            self.assertEqual(data["results"][0], old)
            before = file.read_bytes()
            with patch("backend.app.storage.json.dump", side_effect=OSError("write failed")):
                with self.assertRaises(OSError):
                    store.save([first], {first.id: demo_evaluate_job(first)})
            self.assertEqual(file.read_bytes(), before)

    def test_turso_identity_snapshot_covers_all_saved_source_urls(self):
        store = TursoEvaluationStore("libsql://example.turso.io", "test-only")
        engine = SQLiteHrana()
        self.addCleanup(engine.db.close)
        with patch.object(store, "_request", side_effect=engine):
            self.assertEqual(store.known_offer_identities(), (set(), set()))
            offer = self.offer.model_copy(update={"sources": [{"portal": "Prace.cz", "url": "https://www.prace.cz/nabidka/other/"}]})
            store.save_evaluated_job(offer, demo_evaluate_job(self.offer))
            urls, identities = store.known_offer_identities()
        self.assertIn(str(offer.url), urls)
        self.assertIn("https://www.prace.cz/nabidka/other/", urls)
        self.assertIn(offer.canonical_id, identities)
