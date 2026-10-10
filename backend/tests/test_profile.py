"""Offline ověření zdrojů profilu, CV a historie bez přístupu k API."""

import json
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pydantic import ValidationError

from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.evaluator import EvaluationError, build_prompt, validate_evaluation
from backend.app.profile import (
    PROFILE_PATH,
    ApplicationRecord,
    load_application_history,
    load_candidate_profile,
)


class ProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.profile_path = self.directory / "candidate_profile.md"
        self.cv_path = self.directory / "cv_facts.json"
        source = PROFILE_PATH.read_text(encoding="utf-8")
        self.data = json.loads(
            re.search(
                r"^```json\s*\n(.*?)^```", source, re.MULTILINE | re.DOTALL
            ).group(1)
        )
        self.write_profile()

    def write_profile(self) -> None:
        self.profile_path.write_text(
            "# Kandidát\n\n```json\n"
            + json.dumps(self.data, ensure_ascii=False)
            + "\n```\n\nPřibližná praxe a prototypy nejsou produkční výsledky.\n",
            encoding="utf-8",
        )

    def load(self):
        return load_candidate_profile(self.profile_path, self.cv_path)

    def test_preferences_change_in_markdown_without_python_changes(self) -> None:
        self.data["salary"]["monthly_gross_target_czk"] = [80000, 90000]
        self.data["salary"]["standard_minimum_czk"] = 65000
        self.data["language_preferences"] = [
            "Čeština a občasné písemné použití angličtiny."
        ]
        self.write_profile()
        profile = self.load()
        self.assertEqual(profile.salary.monthly_gross_target_czk, (80000, 90000))
        self.assertEqual(profile.salary.standard_minimum_czk, 65000)
        self.assertEqual(
            profile.language_preferences, tuple(self.data["language_preferences"])
        )
        self.assertIn("Přibližná praxe", profile.profile_markdown)
        self.assertNotIn("```json", profile.profile_markdown)

    def test_missing_cv_has_no_approved_highlights(self) -> None:
        profile = self.load()
        self.assertEqual(profile.approved_cv_highlights, ())
        self.assertIsNone(profile.cv_source)

    def test_cv_facts_are_separate_and_need_a_source(self) -> None:
        self.cv_path.write_text(
            json.dumps(
                {
                    "cv_source": "data/cv.pdf",
                    "approved_cv_highlights": ["Analýza zákaznických procesů."],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        profile = self.load()
        self.assertEqual(profile.cv_source, "data/cv.pdf")
        self.assertEqual(
            profile.approved_cv_highlights, ("Analýza zákaznických procesů.",)
        )
        self.cv_path.write_text(
            json.dumps(
                {
                    "cv_source": None,
                    "approved_cv_highlights": ["Vymyšlená zkušenost"],
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(ValidationError):
            self.load()

    def test_cv_allowlist_cannot_be_injected_through_profile_preferences(self) -> None:
        self.data["approved_cv_highlights"] = ["Neověřené produkční výsledky"]
        self.write_profile()
        with self.assertRaisesRegex(ValueError, "CV podklady"):
            self.load()

    def test_missing_ambiguous_or_invalid_profile_is_not_silently_replaced(
        self,
    ) -> None:
        self.profile_path.write_text("Profil bez JSON", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.load()
        self.write_profile()
        with self.profile_path.open("a", encoding="utf-8") as file:
            file.write("\n```json\n{}\n```\n")
        with self.assertRaises(ValueError):
            self.load()
        self.data["salary"]["monthly_gross_target_czk"] = [90000, 70000]
        self.write_profile()
        with self.assertRaises(ValidationError):
            self.load()

    def test_history_keeps_unknown_status_and_missing_dates(self) -> None:
        path = self.directory / "history.json"
        self.assertEqual(load_application_history(path), ())
        path.write_text(
            json.dumps(
                [
                    {
                        "employer": "Firma A",
                        "position": "Analytik",
                        "reported_status": "applied",
                    },
                    {
                        "employer": "Firma B",
                        "position": "Specialista",
                        "reported_status": "unknown",
                    },
                ]
            ),
            encoding="utf-8",
        )
        history = load_application_history(path)
        self.assertEqual(history[1].reported_status, "unknown")
        self.assertIsNone(history[0].applied_at)
        self.assertIsNone(history[1].applied_at)
        path.write_text(
            json.dumps(
                [
                    {
                        "employer": "Firma",
                        "position": "Role",
                        "reported_status": "probably_applied",
                    }
                ]
            ),
            encoding="utf-8",
        )
        with self.assertRaises(ValidationError):
            load_application_history(path)

    def test_prompt_omits_bulk_history_and_duplicate_markdown(self) -> None:
        record = ApplicationRecord(
            employer="Dřívější firma",
            position="Analytik",
            reported_status="applied",
        )
        reference = self.directory / "reference.md"
        reference.write_text(
            "Historická reference, bez ověření aktuálnosti.", encoding="utf-8"
        )
        with (
            patch("backend.app.evaluator.MASTER_PROFILE", self.load()),
            patch(
                "backend.app.evaluator.load_application_history", return_value=(record,)
            ),
            patch("backend.app.evaluator.REFERENCES_PATH", reference),
        ):
            prompt = json.loads(build_prompt(sample_offers()[0]))
        self.assertNotIn("application_history", prompt)
        self.assertNotIn("historical_career_references", prompt)
        self.assertNotIn("profile_markdown", prompt["candidate_profile"])
        self.assertEqual(prompt["untrusted_job_offer"]["id"], sample_offers()[0].id)

    def test_cv_output_is_limited_to_the_separate_approved_source(self) -> None:
        self.cv_path.write_text(
            json.dumps(
                {
                    "cv_source": "data/cv.pdf",
                    "approved_cv_highlights": ["Ověřený CV podklad"],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        evaluation = demo_evaluate_job(sample_offers()[0])
        with patch("backend.app.evaluator.MASTER_PROFILE", self.load()):
            accepted = evaluation.model_copy(
                update={"tailored_cv_highlights": ["Ověřený CV podklad"]}
            )
            self.assertEqual(validate_evaluation(accepted), accepted)
            invented = evaluation.model_copy(
                update={"tailored_cv_highlights": ["Profesionální Python"]}
            )
            with self.assertRaises(EvaluationError):
                validate_evaluation(invented)


if __name__ == "__main__":
    unittest.main()
