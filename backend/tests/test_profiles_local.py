"""Candidate isolation and search routing without paid API or user-data writes."""
import json
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend.app import profile_registry as registry
from backend.app.demo import sample_offers, demo_evaluate_job
from backend.app.evaluator import build_prompt, evaluation_context, validate_evaluation, EvaluationError
from backend.app.profile import PROFILE_PATH, parse_candidate_profile
from backend.app.search_plan import startup_searches, jobs_listing_urls


class LocalProfilesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        for key, value in {"PROFILES_DIR": directory, "ACTIVE_PATH": directory / "active.json"}.items():
            patcher = patch.object(registry, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        source = PROFILE_PATH.read_text(encoding="utf-8")
        self.data = json.loads(re.search(r"^```json\s*\n(.*?)^```", source, re.M | re.S).group(1))
        self.data.update(target_roles=["Účetní", "Financial Analyst"], skills=["Účetnictví"],
                         location_preferences=["Praha"], language_preferences=["Angličtina C1"])
        self.content = json.dumps(self.data, ensure_ascii=False)

    def test_project_profile_is_default_and_invalid_upload_preserves_selection(self):
        self.assertEqual(registry.selected_id(), "default")
        result = registry.upload_profile("Účetní.json", self.content)
        self.assertFalse(result["isDefault"])
        selected = registry.selected_id()
        with self.assertRaises(ValueError):
            registry.upload_profile("broken.md", "Profil bez strukturovaných preferencí")
        self.assertEqual(registry.selected_id(), selected)
        self.assertEqual(registry.reset_profile()["id"], "default")
        self.assertTrue((registry.profile_directory(selected) / "profile.json").exists())

    def test_other_candidate_prompt_has_no_personal_history_cv_or_references(self):
        profile = parse_candidate_profile(self.content)
        with evaluation_context(profile), patch("backend.app.evaluator.load_application_history") as history:
            prompt = json.loads(build_prompt(sample_offers()[0]))
            self.assertEqual(prompt["candidate_profile"]["target_roles"], ["Účetní", "Financial Analyst"])
            self.assertEqual(prompt["candidate_profile"]["approved_cv_highlights"], [])
            self.assertEqual(prompt["application_history"], [])
            self.assertEqual(prompt["historical_career_references"], "")
            history.assert_not_called()
            evaluation = demo_evaluate_job(sample_offers()[0]).model_copy(update={"tailored_cv_highlights": ["Cizí CV tvrzení"]})
            with self.assertRaises(EvaluationError):
                validate_evaluation(evaluation)
        self.assertNotEqual(json.loads(build_prompt(sample_offers()[0]))["candidate_profile"]["target_roles"], ["Účetní", "Financial Analyst"])

    def test_profile_search_terms_replace_technical_defaults(self):
        profile = parse_candidate_profile(self.content)
        self.assertEqual(startup_searches(profile), ({"query": "Účetní"}, {"query": "Financial Analyst"}))
        self.assertTrue(all("Python" not in url for url in jobs_listing_urls(profile)))
        self.assertIn("Financial+Analyst", jobs_listing_urls(profile)[1])

    def test_results_and_content_are_isolated_by_profile_and_path_cannot_escape(self):
        first = registry.upload_profile("first.json", self.content)["id"]
        self.data["target_roles"] = ["Lékař"]
        second = registry.upload_profile("second.json", json.dumps(self.data))["id"]
        self.assertNotEqual(first, second)
        registry.atomic_json(registry.profile_directory(first) / "results.json", {"saved_at": "2026-10-09T10:00:00Z", "results": [{"offer": {"id": "one"}, "evaluation": {"score": 90}}]})
        self.assertEqual(len(registry.result_rows(first)), 1)
        self.assertEqual(registry.result_rows(second), [])
        with self.assertRaises(ValueError):
            registry.profile_directory("../candidate_profile.md")
