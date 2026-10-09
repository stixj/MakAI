"""Cross-portal identity and actual SQL enrichment, without network or LLM."""

import json
import sqlite3
import unittest
from unittest.mock import Mock, patch

from pydantic import ValidationError

from backend.app.db import CREATE_TABLE, upsert_or_enrich_job
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.graph import build_graph
from backend.app.schemas import JobOffer, RawJobOffer
from backend.app.turso import TursoError, TursoEvaluationStore
from backend.app.utils.fingerprint import generate_canonical_id
from backend.tests.test_turso import SQLiteHrana


def portal_offer(portal="jobs", **updates):
    urls = {"jobs": "https://www.jobs.cz/rpd/123/",
            "pzr": "https://www.pracezarohem.cz/nabidka/456"}
    data = {**sample_offers()[0].model_dump(), "canonical_id": "", "sources": [],
            "id": portal + "-123", "url": urls[portal], "company": "Česká firma, s.r.o.",
            "title": "AI Automation Specialist (m/ž) – plný úvazek", "location": "Brno"}
    data.update(updates)
    return RawJobOffer.model_validate(data)


class FingerprintTests(unittest.TestCase):
    def test_jobs_and_prace_za_rohem_have_identical_id(self):
        jobs = portal_offer()
        pzr = portal_offer("pzr", company="CESKA FIRMA a. s.",
                           title="AI Automation Specialist f/m (Senior) - HPP", location=" BRNO ")
        self.assertEqual(jobs.canonical_id, pzr.canonical_id)
        self.assertEqual(jobs.canonical_id, generate_canonical_id(jobs.company, jobs.title, "Brno"))

    def test_decorations_and_diacritics(self):
        expected = generate_canonical_id("Žlutý kůň", "Vývojář", "Plzeň")
        for company in ("ZLUTY KUN s.r.o.", "Žlutý kůň, a. s.", "Žlutý kůň spol. s r.o."):
            for title in ("Vyvojar (m/ž)", "Vývojář f/m (Junior/Senior)",
                          "Vývojář (zkrácený úvazek)", "Vývojář – part-time", "Vývojář (Senior HPP)"):
                with self.subTest(company=company, title=title):
                    self.assertEqual(generate_canonical_id(company, title, "PLZEN"), expected)

    def test_meaningful_role_and_location_differences_are_preserved(self):
        base = generate_canonical_id("Firma", "Vývojář (Python)", "Brno")
        for company, title, location in (("Jiná firma", "Vývojář (Python)", "Brno"),
                                         ("Firma", "Vývojář (Java)", "Brno"),
                                         ("Firma", "Senior Vývojář (Python)", "Brno"),
                                         ("Firma", "Vývojář (Python)", "Praha"),
                                         ("Firma", "Vývojář (Python)", "")):
            self.assertNotEqual(generate_canonical_id(company, title, location), base)
        self.assertEqual(len({generate_canonical_id("Firma", title, "Brno")
                              for title in ("C vývojář", "C++ vývojář", "C# vývojář")}), 3)

    def test_schema_generates_identity_for_old_data_and_rejects_forged_identity(self):
        original = sample_offers()[0].model_dump()
        for key in ("canonical_id", "sources", "salary_raw", "location"):
            original.pop(key)
        offer = JobOffer.model_validate(original)
        self.assertTrue(offer.canonical_id)
        self.assertEqual(len(offer.sources), 1)
        with self.assertRaises(ValidationError):
            JobOffer.model_validate({**original, "canonical_id": "forged"})
        with self.assertRaises(ValidationError):
            JobOffer.model_validate({**original, "sources": [{"portal": "Jobs.cz", "url": "file:///bad"}]})

    def test_empty_salary_and_location_are_unknown(self):
        offer = portal_offer(salary_raw="  ", location="")
        self.assertIsNone(offer.salary_raw)
        self.assertIsNone(offer.location)


class EnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = SQLiteHrana()
        self.addCleanup(self.engine.db.close)
        self.store = TursoEvaluationStore("libsql://example.turso.io", "test-only")
        self.transport = patch.object(self.store, "_request", side_effect=self.engine)
        self.transport.start()
        self.addCleanup(self.transport.stop)
        self.jobs = portal_offer()
        self.pzr = portal_offer("pzr", company="Ceska firma a.s.",
                                title="AI Automation Specialist f/m (Senior)", salary_raw="70 000 – 90 000 Kč")
        self.evaluation = demo_evaluate_job(sample_offers()[0])

    def rows(self):
        return self.engine.db.execute(
            "SELECT offer, evaluation, evaluated_at FROM makai_job_evaluations").fetchall()

    def test_two_portals_two_runs_enrich_without_second_llm_call(self):
        evaluator = Mock(return_value=self.evaluation)
        graph = build_graph(store=self.store, evaluator=evaluator)
        first = graph.invoke({"offers": [self.jobs], "evaluations": {}, "errors": []})
        self.assertEqual(first["errors"], [])
        before = self.rows()[0]
        evaluator.reset_mock()
        second = graph.invoke({"offers": [self.pzr], "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(second["errors"], [])
        self.assertEqual(second["evaluations"], {})
        self.assertEqual(second["enriched_ids"], [self.jobs.canonical_id])
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        offer = JobOffer.model_validate_json(rows[0][0])
        self.assertEqual(offer.salary_raw, self.pzr.salary_raw)
        self.assertEqual({s["portal"] for s in offer.sources}, {"Jobs.cz", "Práce za rohem"})
        self.assertEqual(rows[0][1:], before[1:])
        self.assertEqual(offer.raw_description, self.jobs.raw_description)

    def test_same_batch_is_evaluated_once_after_sources_and_salary_are_merged(self):
        evaluator = Mock(return_value=self.evaluation)
        result = build_graph(store=self.store, evaluator=evaluator).invoke(
            {"offers": [self.jobs, self.pzr], "evaluations": {}, "errors": []})
        self.assertEqual(result["errors"], [])
        evaluator.assert_called_once()
        self.assertEqual(evaluator.call_args.args[0].salary_raw, self.pzr.salary_raw)
        self.assertEqual(len(evaluator.call_args.args[0].sources), 2)
        self.assertEqual(len(self.rows()), 1)

    def test_upsert_requires_evaluation_only_for_new_job_and_is_idempotent(self):
        with self.assertRaises(ValueError):
            upsert_or_enrich_job(self.jobs, store=self.store)
        upsert_or_enrich_job(self.jobs, self.evaluation, store=self.store)
        before = self.rows()[0]
        for _ in range(3):
            upsert_or_enrich_job(self.pzr, store=self.store)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(len(json.loads(self.rows()[0][0])["sources"]), 2)
        self.assertEqual(self.rows()[0][1:], before[1:])

    def test_existing_salary_and_evaluation_are_never_replaced(self):
        self.store.upsert_or_enrich_job(self.pzr, self.evaluation)
        before = self.rows()[0]
        changed = self.jobs.model_copy(update={"salary_raw": "jiná mzda"})
        self.store.upsert_or_enrich_job(changed, demo_evaluate_job(sample_offers()[1]))
        self.assertEqual(json.loads(self.rows()[0][0])["salary_raw"], self.pzr.salary_raw)
        self.assertEqual(self.rows()[0][1:], before[1:])

    def test_unique_index_blocks_different_source_ids_for_same_canonical_job(self):
        self.store.upsert_or_enrich_job(self.jobs, self.evaluation)
        with self.assertRaises(sqlite3.IntegrityError):
            self.engine.db.execute("INSERT INTO makai_job_evaluations (offer_id, offer, evaluation) VALUES (?, ?, ?)",
                                   (self.pzr.id, self.pzr.model_dump_json(), self.evaluation.model_dump_json()))

    def test_direct_batch_upsert_merges_different_source_ids(self):
        self.store.save([self.jobs, self.pzr], {
            self.jobs.id: self.evaluation,
            self.pzr.id: demo_evaluate_job(sample_offers()[1]),
        })
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(json.loads(rows[0][0])["sources"]), 2)
        self.assertEqual(json.loads(rows[0][0])["salary_raw"], self.pzr.salary_raw)
        self.assertEqual(json.loads(rows[0][1]), self.evaluation.model_dump(mode="json"))

    def test_different_locations_get_separate_evaluations(self):
        prague = portal_offer("pzr", location="Praha")
        evaluator = Mock(return_value=self.evaluation)
        result = build_graph(store=self.store, evaluator=evaluator).invoke(
            {"offers": [self.jobs, prague], "evaluations": {}, "errors": []})
        self.assertEqual(result["errors"], [])
        self.assertEqual(evaluator.call_count, 2)
        self.assertEqual(len(self.rows()), 2)

    def test_failed_enrichment_rolls_back_and_does_not_trigger_llm(self):
        self.store.upsert_or_enrich_job(self.jobs, self.evaluation)
        before = self.rows()
        self.engine.fail_commit = True
        evaluator = Mock()
        result = build_graph(store=self.store, evaluator=evaluator).invoke(
            {"offers": [self.pzr], "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["enriched_ids"], [])
        self.assertEqual(self.rows(), before)
        self.assertFalse(self.engine.db.in_transaction)

    def test_legacy_rows_are_backfilled_and_collisions_merge_without_llm(self):
        self.engine.db.execute(CREATE_TABLE)
        for index, offer in enumerate((self.jobs, self.pzr)):
            data = offer.model_dump(mode="json")
            data.pop("canonical_id")
            data.pop("sources")
            self.engine.db.execute("INSERT INTO makai_job_evaluations VALUES (?, ?, ?, ?)",
                                   (offer.id, json.dumps(data), self.evaluation.model_dump_json(), str(index)))
        evaluator = Mock()
        result = build_graph(store=self.store, evaluator=evaluator).invoke(
            {"offers": [self.pzr], "evaluations": {}, "errors": []})
        evaluator.assert_not_called()
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(self.rows()), 1)
        offer = JobOffer.model_validate_json(self.rows()[0][0])
        self.assertEqual(offer.canonical_id, self.jobs.canonical_id)
        self.assertEqual(offer.salary_raw, self.pzr.salary_raw)
        self.assertEqual(len(offer.sources), 2)
        self.assertEqual(self.rows()[0][2], "0")

    def test_failed_legacy_migration_preserves_original_data(self):
        self.engine.db.execute(CREATE_TABLE)
        data = self.jobs.model_dump(mode="json")
        data.pop("canonical_id")
        self.engine.db.execute("INSERT INTO makai_job_evaluations VALUES (?, ?, ?, ?)",
                               (self.jobs.id, json.dumps(data), self.evaluation.model_dump_json(), "original"))
        before = self.rows()
        self.engine.fail_commit = True
        with self.assertRaises(TursoError):
            self.store.find_existing_job(self.pzr)
        self.assertEqual(self.rows(), before)
        self.assertFalse(self.engine.db.in_transaction)


if __name__ == "__main__":
    unittest.main()
