"""Manual offers reuse the evaluator, with no scraper or application mutation."""
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_api
from app.schemas import JobFitEvaluation
from app.cloud_storage import ProfileTursoStore
from app.scrapers.structured import clean_url
from app.hunt_filters import HuntSelection
from app.schemas import JobOffer

ROOT = Path(__file__).resolve().parents[2]


class ManualEvaluationTests(unittest.TestCase):
    def test_worker_evaluates_snapshot_without_scraping_or_saving_over_existing_history(self):
        content = (ROOT / "frontend/public/templates/candidate-profile-template.json").read_text(encoding="utf-8")
        profile_id = hashlib.sha256(content.encode("utf-8")).hexdigest()
        offer = {"id": "manual-one", "title": "Analyst", "company": "Example", "url": "https://example.com/job", "raw_description": "Real offer"}
        payload = {"profile": {"id": profile_id, "content": content}, "options": {"evaluationOffer": offer}}
        result = JobFitEvaluation(score=85, verdict="STRONG_FIT", fit_reasons=["Relevant", "Suitable"], gap_analysis=[], tailored_cv_highlights=[])
        from app.config import get_settings
        settings = get_settings().model_copy(update={"database_url": "libsql://example.turso.io", "turso_auth_token": "secret"})
        from pydantic import SecretStr
        settings = settings.model_copy(update={"database_url": SecretStr("libsql://example.turso.io"), "turso_auth_token": SecretStr("secret")})
        output = io.StringIO()
        with patch.object(sys, "argv", ["local_api.py", "cloud-hunt"]), patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), patch.object(sys, "stdout", output), patch.object(local_api, "get_settings", return_value=settings), patch.object(local_api, "evaluate_job", return_value=result) as evaluate, patch.object(local_api, "hunt") as hunt:
            self.assertEqual(local_api.main(), 0)
        evaluate.assert_called_once()
        self.assertEqual(evaluate.call_args.args[0].id, "manual-one")
        hunt.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["evaluation"], result.model_dump())

    def test_edited_identities_are_scoped_without_network_or_paid_evaluation(self):
        store = ProfileTursoStore("libsql://example.turso.io", "secret", "a" * 64)
        edited = {"url": "https://example.com/revised", "canonical_id": "revised-key"}
        with patch.object(store, "_request", side_effect=[{"rows": [[{"type": "text", "value": "makai_offer_edits"}]]}, {"rows": [[{"type": "text", "value": json.dumps(edited)}]]}]) as request:
            urls, identities = store.edited_offer_identities()
        self.assertEqual(urls, {edited["url"]})
        self.assertEqual(identities, {"revised-key"})
        self.assertEqual(request.call_args.args[0]["stmt"]["args"][0]["value"], "a" * 64)

    def test_manual_identities_are_scoped_and_filter_paid_duplicates(self):
        store = ProfileTursoStore("libsql://example.turso.io", "secret", "a" * 64)
        offer = JobOffer(id="one",title="Analyst",company="Example",url="https://example.com/job",raw_description="Text")
        saved = offer.model_dump(mode="json")
        with patch.object(store, "_request", side_effect=[{"rows": [[{"type": "text", "value": "makai_manual_offers"}]]}, {"rows": [[{"type": "text", "value": json.dumps(saved)}]]}]) as request:
            urls, identities = store.manual_offer_identities()
        self.assertEqual(request.call_args.args[0]["stmt"]["args"][0]["value"], "a" * 64)
        selection = HuntSelection(known_urls=urls, known_ids=identities)
        self.assertFalse(selection.accept(offer))
        self.assertEqual(selection.counts["duplicates"], 1)
        with patch.object(store, "_request", return_value={"rows": []}):
            self.assertEqual(store.manual_offer_identities(), (set(),set()))


if __name__ == "__main__":
    unittest.main()
