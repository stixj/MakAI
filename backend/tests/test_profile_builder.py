"""Questionnaire grounding, provider failures and review-only generation."""
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError
import httpx
from openai import RateLimitError

from backend.app.config import Settings
from backend.app.profile import parse_candidate_profile
from backend.app.profile_builder import (DraftText, Questionnaire, ProfileGenerationError,
                                         assemble_draft, builder_config, generate_profile)
from backend.app import profile_registry as registry


class ProfileBuilderTests(unittest.TestCase):
    def setUp(self):
        self.answers = {"career_goal": "Účetní ve stabilní firmě", "experience": "Tři roky fakturace.",
                        "skills": "Excel pokročile, účetnictví základy.", "location": "Praha, hybrid",
                        "languages": "Čeština, angličtina při čtení dokumentace", "working_style": "Samostatnost",
                        "no_go": "Noční směny", "salary_minimum": 40000,
                        "salary_target_lower": 50000, "salary_target_upper": 60000}
        self.text = DraftText(target_roles=["Účetní", "Financial Accountant"],
                              skills=["Excel – pokročilá znalost", "Účetnictví – základy"],
                              preferences=["Stabilní firma"], evidence_limitations=["Vzdělání neuvedeno"],
                              professional_summary="Kandidát uvádí tři roky práce s fakturací.",
                              missing_information=["Doplňte vzdělání."])
        self.settings = Settings(openai_api_key="private-test-key")

    def factory(self, response=None, error=None):
        factory = MagicMock()
        client = factory.return_value.__enter__.return_value
        client.responses.parse.return_value = response or SimpleNamespace(status="completed", output_parsed=self.text)
        client.responses.parse.side_effect = error
        return factory

    def test_sdk_uses_structured_parse_configured_model_no_storage_and_only_this_candidate(self):
        factory = self.factory()
        result = generate_profile(self.answers, settings=self.settings, client_factory=factory)
        kwargs = factory.return_value.__enter__.return_value.responses.parse.call_args.kwargs
        self.assertIs(kwargs["text_format"], DraftText)
        self.assertEqual(kwargs["model"], self.settings.openai_model)
        self.assertFalse(kwargs["store"])
        self.assertEqual(json.loads(kwargs["input"][1]["content"]), self.answers)
        self.assertNotIn("candidate_profile", kwargs["input"][1]["content"])
        self.assertEqual(factory.call_args.kwargs["max_retries"], 0)
        self.assertEqual(result["provider"], "OpenAI")

    def test_finance_and_hard_conditions_are_copied_without_llm_inference(self):
        result = assemble_draft(Questionnaire.model_validate(self.answers), self.text, "test-model")
        data = result["profile"]
        self.assertEqual(data["salary"]["monthly_gross_target_czk"], [50000, 60000])
        self.assertEqual(data["salary"]["exceptional_minimum_czk"], 40000)
        self.assertIsNone(data["salary"]["long_term_target_czk"])
        self.assertEqual(data["no_go_criteria"], ["Noční směny"])
        self.assertEqual(data["location_preferences"], [self.answers["location"]])
        self.assertEqual(data["language_preferences"], [self.answers["languages"]])
        self.assertIn(self.answers["experience"], result["context"])
        profile = parse_candidate_profile(json.dumps(data, ensure_ascii=False))
        self.assertEqual(profile.approved_cv_highlights, ())
        self.assertIsNone(profile.cv_source)

    def test_bad_inputs_fail_before_any_provider_call(self):
        for update in ({"skills": " "}, {"salary_minimum": 70000}, {"salary_target_upper": 45000},
                       {"salary_target_lower": "50000"}, {"salary_minimum": True}, {"name": "extra"}):
            factory = self.factory()
            with self.subTest(update=update), self.assertRaises(ValidationError):
                generate_profile(self.answers | update, settings=self.settings, client_factory=factory)
            factory.assert_not_called()

    def test_missing_key_is_actionable_and_config_contains_no_credentials(self):
        factory = self.factory()
        with self.assertRaisesRegex(ProfileGenerationError, "OPENAI_API_KEY"):
            generate_profile(self.answers, settings=Settings(), client_factory=factory)
        factory.assert_not_called()
        self.assertEqual(builder_config(Settings())["configured"], False)
        self.assertNotIn("private-test-key", json.dumps(builder_config(self.settings)))

    def test_refusals_incomplete_outputs_and_transport_failure_never_generate_fallback_profiles(self):
        for response in (SimpleNamespace(status="completed", output_parsed=None),
                         SimpleNamespace(status="incomplete", output_parsed=self.text)):
            with self.assertRaises(ProfileGenerationError):
                generate_profile(self.answers, settings=self.settings, client_factory=self.factory(response))
        with self.assertRaises(ProfileGenerationError) as caught:
            generate_profile(self.answers, settings=self.settings, client_factory=self.factory(error=RuntimeError("private-test-key sensitive provider response")))
        self.assertNotIn("private-test-key", str(caught.exception))
        self.assertNotIn("sensitive provider", str(caught.exception))

    def test_empty_roles_and_oversize_items_are_rejected(self):
        for update in ({"target_roles": []}, {"skills": [" "]}, {"professional_summary": ""},
                       {"preferences": ["x" * 2001]}):
            with self.subTest(update=update), self.assertRaises(ProfileGenerationError):
                assemble_draft(Questionnaire.model_validate(self.answers), self.text.model_copy(update=update), "test")

    def test_exhausted_credit_is_actionable_and_never_exposes_provider_body(self):
        response = httpx.Response(429, request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
        error = RateLimitError("private-test-key", response=response, body={"code": "credit_balance_exhausted"})
        with self.assertRaisesRegex(ProfileGenerationError, "kredit") as caught:
            generate_profile(self.answers, settings=self.settings, client_factory=self.factory(error=error))
        self.assertNotIn("private-test-key", str(caught.exception))

    def test_generation_does_not_write_profile_or_change_selection(self):
        with TemporaryDirectory() as folder, patch.object(registry, "PROFILES_DIR", Path(folder)), \
             patch.object(registry, "ACTIVE_PATH", Path(folder) / "active.json"):
            generate_profile(self.answers, settings=self.settings, client_factory=self.factory())
            self.assertEqual(registry.selected_id(), "default")
            self.assertEqual(list(Path(folder).iterdir()), [])
