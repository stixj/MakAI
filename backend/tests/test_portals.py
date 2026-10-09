"""Mocked HTTP contract tests for all portal adapters and CLI selection."""

import io
import json
import unittest
from unittest.mock import Mock, patch

import httpx
from rich.console import Console

from backend import run_hunt
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.graph import build_graph
from backend.app.schemas import RawJobOffer
from backend.app.scrapers import SCRAPERS
from backend.app.scrapers.base import BaseScraper, ScraperError
from backend.app.scrapers.portals import AtmoskopScraper, JenPraceCzScraper, JobsCzScraper, PraceCzScraper
from backend.app.turso import TursoEvaluationStore
from backend.tests.test_turso import SQLiteHrana


def posting_html(url, **updates):
    posting = {"@type": "JobPosting", "title": "AI Automation Specialist (m/ž)",
               "hiringOrganization": {"name": "Česká firma s.r.o."},
               "url": url, "description": "<p>Automatizace procesů</p><script>bad()</script>",
               "datePosted": "2026-10-01", "validThrough": "2099-01-01T00:00:00Z",
               "jobLocation": {"address": {"addressLocality": "Brno"}},
               "baseSalary": {"currency": "CZK", "value": {"minValue": 70000,
                                                           "maxValue": 90000, "unitText": "MONTH"}}}
    posting.update(updates)
    return '<script type="application/ld+json">' + json.dumps({"@graph": [posting]}).replace("</", "<\\/") + '</script>'


class PortalTests(unittest.TestCase):
    def fetch(self, scraper, handler, limit=1):
        real_client = httpx.Client
        with patch("backend.app.scrapers.portals.httpx.Client",
                   side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
            return scraper.fetch_jobs(limit)

    def test_all_scrapers_implement_base_and_invalid_limits_never_connect(self):
        with self.assertRaises(TypeError):
            BaseScraper()
        with patch("httpx.Client") as client:
            for cls in SCRAPERS.values():
                scraper = cls()
                self.assertIsInstance(scraper, BaseScraper)
                self.assertEqual(scraper.fetch_jobs(0), [])
                for value in (-1, 101, True, 1.5):
                    with self.assertRaises(ValueError):
                        scraper.fetch_jobs(value)
        client.assert_not_called()

    def test_portals_map_common_fields_and_canonical_identity(self):
        results = []
        cases = [(JobsCzScraper(), "https://www.jobs.cz/rpd/123/"),
                 (PraceCzScraper(), "https://www.prace.cz/nabidka/456/"),
                 (JenPraceCzScraper(), "https://www.jenprace.cz/nabidka/abc/pozice"),
                 (AtmoskopScraper(), "https://www.atmoskop.cz/nabidka-prace/def")]
        for scraper, url in cases:
            def handler(request):
                if str(request.url).split("?")[0] == url:
                    return httpx.Response(200, text=posting_html(url))
                return httpx.Response(200, text=f'<a href="{url}?rps=1">Pozice</a><a href="{url}">Pozice</a>')
            with self.subTest(portal=scraper.portal):
                offers = self.fetch(scraper, handler)
                self.assertEqual(len(offers), 1)
                offer = offers[0]
                self.assertIsInstance(offer, RawJobOffer)
                self.assertEqual(offer.location, "Brno")
                self.assertEqual(offer.salary_raw, "70000 – 90000 CZK MONTH")
                self.assertEqual(offer.sources, [{"portal": scraper.portal, "url": url}])
                self.assertNotIn("bad()", offer.raw_description)
                self.assertEqual(offer.published_at.isoformat(), "2026-10-01T00:00:00+02:00")
                results.append(offer)
        self.assertEqual(len({offer.canonical_id for offer in results}), 1)

    def test_jobs_native_html_retains_unknown_publication_date(self):
        url = "https://www.jobs.cz/rpd/123/"
        detail = '''<h1>AI Automation Specialist</h1>
            <div data-test="jd-body-richtext"><p>Automatizace</p></div>
            <div data-test="jd-info-item">Společnost Česká firma s.r.o.</div>
            <div data-test="jd-info-item">Mzda 70 000 Kč</div>
            <a data-test="jd-info-location">Brno</a>'''
        offer = self.fetch(JobsCzScraper(), lambda request: httpx.Response(
            200, text=detail if str(request.url) == url else f'<a href="{url}">Pozice</a>'))[0]
        self.assertIsNone(offer.published_at)
        self.assertEqual((offer.company, offer.location, offer.salary_raw),
                         ("Česká firma s.r.o.", "Brno", "Mzda 70 000 Kč"))

    def test_atmoskop_native_next_data(self):
        url = "https://www.atmoskop.cz/nabidka-prace/123"
        detail = {"advertId": "123", "title": "AI Automation Specialist", "content": "<p>Automatizace</p>",
                  "companyName": "Česká firma", "publishedAt": 1791477828, "workLocations": ["Brno"],
                  "salary": {"min": 70000, "max": 90000, "currency": "CZK", "period": "MONTH"},
                  "jobTypes": ["FULL_TIME"]}
        data = {"props": {"pageProps": {"initialApolloState": {"ROOT_QUERY": {
            'advertComposerJobDetail({"advertId":"123"})': detail}}}}}
        html = '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(data) + '</script>'
        offer = self.fetch(AtmoskopScraper(), lambda request: httpx.Response(
            200, text=html if str(request.url) == url else f'<a href="{url}">Pozice</a>'))[0]
        self.assertEqual((offer.company, offer.location, offer.salary_raw),
                         ("Česká firma", "Brno", "70000 – 90000 CZK MONTH"))

    def test_expired_gone_and_invalid_details_are_not_invented(self):
        def handler(request):
            if "/nabidka/" in request.url.path:
                return httpx.Response(200, text=posting_html(str(request.url), validThrough="2000-01-01"))
            return httpx.Response(200, text='<a href="/nabidka/123/">Pozice</a>')
        self.assertEqual(self.fetch(PraceCzScraper(), handler), [])
        for status, html in ((410, ""), (200, "invalid detail")):
            def gone(request):
                return httpx.Response(status, text=html) if "/nabidka/" in request.url.path else httpx.Response(
                    200, text='<a href="/nabidka/123/">Pozice</a>')
            if status == 410:
                self.assertEqual(self.fetch(PraceCzScraper(), gone), [])
            else:
                with self.assertRaises(ScraperError):
                    self.fetch(PraceCzScraper(), gone)

    def test_changed_listing_and_http_failures_are_redacted(self):
        for response in (httpx.Response(429, text="private body"), httpx.Response(200, text="changed")):
            with self.assertRaises(ScraperError) as caught:
                self.fetch(PraceCzScraper(), lambda request: response)
            self.assertNotIn("private body", str(caught.exception))

    def test_external_detail_links_and_redirects_are_never_requested(self):
        requests = []
        def handler(request):
            requests.append(str(request.url))
            if "/nabidka/" in request.url.path:
                return httpx.Response(302, headers={"location": "https://example.org/nabidka/secret"})
            return httpx.Response(200, text='<a href="https://example.org/nabidka/other">External</a>'
                                  '<a href="/nabidka/123/">Pozice</a>')
        with self.assertRaises(ScraperError):
            self.fetch(PraceCzScraper(), handler)
        self.assertFalse(any("example.org" in url for url in requests))

    def test_next_page_backfills_overlaps_and_stops_at_limit(self):
        requests = []
        def handler(request):
            requests.append(str(request.url))
            if "/nabidka/" in request.url.path:
                return httpx.Response(200, text=posting_html(str(request.url)))
            if request.url.params.get("page") == "2":
                return httpx.Response(200, text='<a href="/nabidka/1/">One</a><a href="/nabidka/2/">Two</a>')
            return httpx.Response(200, text='<a href="/nabidka/1/">One</a><a rel="next" href="?page=2">Next</a>')
        offers = self.fetch(PraceCzScraper(), handler, limit=2)
        self.assertEqual(len(offers), 2)
        self.assertEqual(len(requests), 4)

    def test_observed_portal_dates_are_parsed(self):
        for scraper, date in ((PraceCzScraper(), "2099-01-01T23:59:59+01:00T23:59"),
                               (JenPraceCzScraper(), "2099-01-01T23:59:59")):
            url = f"https://www.{scraper.domain}/nabidka/123/"
            offers = self.fetch(scraper, lambda request: httpx.Response(
                200, text=posting_html(url, validThrough=date) if str(request.url) == url
                else f'<a href="{url}">Pozice</a>'))
            self.assertEqual(len(offers), 1)


class MultiPortalCliTests(unittest.TestCase):
    def test_cli_continues_after_source_failure_and_reports_it(self):
        store = TursoEvaluationStore("libsql://example.turso.io", "test-only")
        engine = SQLiteHrana()
        self.addCleanup(engine.db.close)
        output = io.StringIO()
        jobs = Mock()
        jobs.return_value.fetch_jobs.return_value = sample_offers()
        prace = Mock()
        prace.return_value.fetch_jobs.side_effect = ScraperError("Prace.cz: změněný výpis")
        with patch.object(store, "_request", side_effect=engine), patch.object(store, "check_connection"), \
             patch("backend.run_hunt.get_settings"), patch("backend.run_hunt.create_store", return_value=store), \
             patch("backend.run_hunt.build_graph", return_value=build_graph(store=store, evaluator=demo_evaluate_job)), \
             patch.dict(run_hunt.SCRAPERS, {"jobs": jobs, "prace": prace}), \
             patch("backend.run_hunt.Console", return_value=Console(file=output, width=180)):
            self.assertEqual(run_hunt.main(["--portals", "jobs", "prace", "jobs", "--limit", "2"]), 1)
        jobs.return_value.fetch_jobs.assert_called_once_with(2)
        prace.return_value.fetch_jobs.assert_called_once_with(2)
        self.assertIn("Prace.cz: změněný výpis", output.getvalue())
        self.assertEqual(engine.db.execute("SELECT COUNT(*) FROM makai_job_evaluations").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
