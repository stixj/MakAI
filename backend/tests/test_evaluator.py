"""Offline provider contract, fallback and validation tests using real SDK adapters."""

import json
import unittest
from types import SimpleNamespace
import httpx
from google.genai.errors import ClientError, ServerError
from openai import APIConnectionError, APITimeoutError
from unittest.mock import patch

from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.demo import demo_evaluate_job, sample_offers
from backend.app.evaluator import (
    EvaluationError, _evaluate_gemini, _evaluate_openai,
    build_prompt, evaluate_job, validate_evaluation, provider_failure,
)
from backend.app.profile import MASTER_PROFILE
from backend.app.graph import build_graph
from backend.app.schemas import JobFitEvaluation, JobOffer


class EvaluatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.offer = sample_offers()[0]
        self.evaluation = demo_evaluate_job(self.offer)

    def test_prompt_contains_offer_profile_and_approved_facts(self) -> None:
        prompt = json.loads(build_prompt(self.offer))
        self.assertEqual(prompt["untrusted_job_offer"]["id"], self.offer.id)
        self.assertEqual(prompt["candidate_profile"]["skills"], list(MASTER_PROFILE.skills))
        self.assertIn("approved_cv_highlights", prompt["candidate_profile"])

    def test_gemini_adapter_enforces_schema_and_parses_response(self) -> None:
        settings = Settings(gemini_api_key="test-only")
        with patch("backend.app.evaluator.genai.Client") as client_factory:
            client = client_factory.return_value.__enter__.return_value
            client.models.generate_content.return_value = SimpleNamespace(
                text=self.evaluation.model_dump_json()
            )
            result = _evaluate_gemini(self.offer, settings)
        self.assertEqual(result, self.evaluation)
        kwargs = client.models.generate_content.call_args.kwargs
        self.assertEqual(kwargs["config"].response_json_schema, JobFitEvaluation.model_json_schema())
        self.assertEqual(kwargs["config"].response_mime_type, "application/json")
        http_options = client_factory.call_args.kwargs["http_options"]
        self.assertEqual(http_options.timeout, 30_000)
        self.assertEqual(http_options.retry_options.attempts, 1)
        client_factory.return_value.__exit__.assert_called_once()

    def test_openai_adapter_uses_requested_model_and_structured_parse(self) -> None:
        settings = Settings(openai_api_key="test-only")
        with patch("backend.app.evaluator.OpenAI") as client_factory:
            client = client_factory.return_value.__enter__.return_value
            client.responses.parse.return_value = SimpleNamespace(
                output_parsed=self.evaluation, status="completed"
            )
            result = _evaluate_openai(self.offer, settings)
        self.assertEqual(result, self.evaluation)
        kwargs = client.responses.parse.call_args.kwargs
        self.assertEqual(kwargs["model"], "gpt-4o-mini")
        self.assertIs(kwargs["text_format"], JobFitEvaluation)
        self.assertFalse(kwargs["store"])
        self.assertEqual(client_factory.call_args.kwargs["max_retries"], 0)

    def test_openai_refusal_or_incomplete_response_is_an_error(self) -> None:
        for status, parsed in (("completed", None), ("incomplete", self.evaluation)):
            with self.subTest(status=status), patch("backend.app.evaluator.OpenAI") as factory:
                client = factory.return_value.__enter__.return_value
                client.responses.parse.return_value = SimpleNamespace(status=status, output_parsed=parsed)
                with self.assertRaises(EvaluationError):
                    _evaluate_openai(self.offer, Settings(openai_api_key="test-only"))

    def test_empty_gemini_response_is_an_error(self) -> None:
        with patch("backend.app.evaluator.genai.Client") as factory:
            factory.return_value.__enter__.return_value.models.generate_content.return_value = SimpleNamespace(text=None)
            with self.assertRaises(EvaluationError):
                _evaluate_gemini(self.offer, Settings(gemini_api_key="test-only"))

    def test_enabled_fallback_after_gemini_failure(self) -> None:
        settings = Settings(
            gemini_api_key="test-only", openai_api_key="test-only", allow_openai_fallback=True
        )
        with patch("backend.app.evaluator.get_settings", return_value=settings), \
             patch("backend.app.evaluator._evaluate_gemini", side_effect=RuntimeError("private")), \
             patch("backend.app.evaluator._evaluate_openai", return_value=self.evaluation) as fallback:
            self.assertEqual(evaluate_job(self.offer), self.evaluation)
            fallback.assert_called_once_with(self.offer, settings)

    def test_disabled_fallback_does_not_call_openai(self) -> None:
        settings = Settings(gemini_api_key="test-only", openai_api_key="test-only")
        with patch("backend.app.evaluator.get_settings", return_value=settings), \
             patch("backend.app.evaluator._evaluate_gemini", side_effect=RuntimeError("secret-token")), \
             patch("backend.app.evaluator._evaluate_openai") as fallback:
            with self.assertRaises(EvaluationError) as caught:
                evaluate_job(self.offer)
            self.assertNotIn("secret-token", str(caught.exception))
            fallback.assert_not_called()

    def test_openai_only_key_works_in_auto_mode(self) -> None:
        with patch("backend.app.evaluator.get_settings", return_value=Settings(openai_api_key="test-only")), \
             patch("backend.app.evaluator._evaluate_gemini") as gemini, \
             patch("backend.app.evaluator._evaluate_openai", return_value=self.evaluation):
            self.assertEqual(evaluate_job(self.offer), self.evaluation)
            gemini.assert_not_called()

    def test_explicit_provider_never_switches_silently(self) -> None:
        settings = Settings(llm_provider="gemini", openai_api_key="test-only", allow_openai_fallback=True)
        with patch("backend.app.evaluator.get_settings", return_value=settings), \
             patch("backend.app.evaluator._evaluate_openai") as openai:
            with self.assertRaisesRegex(EvaluationError, "Chybí API klíč"):
                evaluate_job(self.offer)
            openai.assert_not_called()

    def test_missing_credentials_report_actionable_error(self) -> None:
        with patch("backend.app.evaluator.get_settings", return_value=Settings()):
            with self.assertRaisesRegex(EvaluationError, "--demo"):
                evaluate_job(self.offer)

    def test_fabricated_cv_highlight_is_rejected(self) -> None:
        invented = self.evaluation.model_copy(update={
            "tailored_cv_highlights": ["Vedl tým 20 lidí a zvýšil tržby o 80 %."]
        })
        with self.assertRaises(EvaluationError):
            validate_evaluation(invented)

    def test_invalid_output_values_are_rejected(self) -> None:
        invalid_updates = (
            {"score": -1}, {"score": 101}, {"score": True}, {"score": "95"},
            {"verdict": "MAYBE"}, {"verdict": "NO_GO"},
            {"fit_reasons": ["Jen jeden důvod"]},
            {"fit_reasons": ["a", "b", "c", "d"]},
            {"gap_analysis": [" "]}, {"unrequested": "extra field"},
        )
        for update in invalid_updates:
            with self.subTest(update=update), self.assertRaises(ValidationError):
                JobFitEvaluation.model_validate(self.evaluation.model_dump() | update)

    def test_offer_requires_http_url_nonempty_description_and_timezone(self) -> None:
        for update in (
            {"url": "javascript:alert(1)"}, {"raw_description": " "},
            {"published_at": "2026-10-08T08:00:00"},
        ):
            with self.subTest(update=update), self.assertRaises(ValidationError):
                JobOffer.model_validate(self.offer.model_dump() | update)


if __name__ == "__main__":
    unittest.main()


class ProviderAvailabilityTests(unittest.TestCase):
    def test_transport_errors_are_retryable_batch_blockers_and_redacted(self):
        request = httpx.Request("POST", "https://example.invalid")
        errors = (
            APITimeoutError(request=request),
            APIConnectionError(message="private API key", request=request),
            httpx.ReadTimeout("private API key", request=request),
            httpx.ConnectError("private API key", request=request),
            httpx.RemoteProtocolError("private API key", request=request),
            TimeoutError("private API key"), ConnectionError("private API key"),
        )
        for error in errors:
            with self.subTest(error=type(error).__name__):
                failure = provider_failure(error, "Provider")
                self.assertEqual(failure.kind, "transport")
                self.assertTrue(failure.retryable)
                self.assertTrue(failure.stop_batch)
                self.assertNotIn("private", str(failure))

    def test_transport_or_quota_stops_batch_without_retry_or_fallback(self):
        errors = (
            httpx.ReadTimeout("private key"),
            ClientError(429, {"error": {"message": "private body"}}),
        )
        settings = Settings(gemini_api_key="test-only", openai_api_key="test-only",
                            allow_openai_fallback=True)
        offers = sample_offers()
        for error in errors:
            with self.subTest(error=type(error).__name__), \
                 patch("backend.app.evaluator.get_settings", return_value=settings), \
                 patch("backend.app.evaluator._evaluate_gemini", side_effect=error) as gemini, \
                 patch("backend.app.evaluator._evaluate_openai") as fallback, \
                 patch("backend.app.evaluator.time.sleep") as sleep:
                store = SimpleNamespace(save=lambda *args: self.fail("No result should be saved"))
                result = build_graph(store=store).invoke({"offers": offers, "evaluations": {}, "errors": []})
                gemini.assert_called_once()
                fallback.assert_not_called()
                sleep.assert_not_called()
                self.assertEqual(result["evaluation_blocked"]["notEvaluated"], len(offers))
                self.assertEqual(result["saved_ids"], [])

    def test_openai_timeout_stops_remaining_offers_after_saving_success(self):
        offers = sample_offers()
        expected = demo_evaluate_job(offers[0])
        writes = []
        request = httpx.Request("POST", "https://example.invalid")
        third = JobOffer.model_validate(offers[0].model_dump() | {
            "id": "third", "title": "Third position", "canonical_id": "",
            "url": "https://example.com/third", "sources": [],
        })
        with patch("backend.app.evaluator.get_settings", return_value=Settings(llm_provider="openai", openai_api_key="test-only")), \
             patch("backend.app.evaluator._evaluate_openai", side_effect=[expected, APITimeoutError(request=request)]) as provider, \
             patch("backend.app.evaluator.time.sleep") as sleep:
            store = SimpleNamespace(save=lambda offers, evaluations: writes.append(dict(evaluations)))
            result = build_graph(store=store).invoke({"offers": [*offers, third], "evaluations": {}, "errors": []})
        self.assertEqual(provider.call_count, 2)
        sleep.assert_not_called()
        self.assertEqual(writes, [{offers[0].id: expected}])
        self.assertEqual(result["saved_ids"], [offers[0].id])
        self.assertEqual(result["evaluation_blocked"]["kind"], "transport")
        self.assertEqual(result["evaluation_blocked"]["notEvaluated"], 2)

    def test_daily_quota_is_actionable_and_never_retried(self):
        exc = ClientError(429, {"error": {"message": "secret body and profile", "status": "RESOURCE_EXHAUSTED",
                          "details": [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}})
        settings = Settings(gemini_api_key="test-only")
        with patch("backend.app.evaluator.get_settings", return_value=settings), \
             patch("backend.app.evaluator._evaluate_gemini", side_effect=exc) as call, \
             patch("backend.app.evaluator.time.sleep") as sleep:
            with self.assertRaises(EvaluationError) as caught:
                evaluate_job(sample_offers()[0])
        self.assertEqual(caught.exception.kind, "daily_quota")
        self.assertTrue(caught.exception.stop_batch)
        self.assertIn("denní limit", str(caught.exception))
        self.assertNotIn("secret", str(caught.exception))
        call.assert_called_once()
        sleep.assert_not_called()

    def test_transient_service_failure_gets_only_two_short_retries(self):
        exc = ServerError(503, {"error": {"message": "private body", "status": "UNAVAILABLE"}})
        with patch("backend.app.evaluator.get_settings", return_value=Settings(gemini_api_key="test-only")), \
             patch("backend.app.evaluator._evaluate_gemini", side_effect=exc) as call, \
             patch("backend.app.evaluator.time.sleep") as sleep:
            with self.assertRaises(EvaluationError) as caught:
                evaluate_job(sample_offers()[0])
        self.assertEqual(call.call_count, 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2])
        self.assertTrue(caught.exception.stop_batch)
        self.assertEqual(caught.exception.kind, "service_unavailable")
        self.assertNotIn("private", str(caught.exception))

    def test_transient_retry_can_recover_and_does_not_call_openai(self):
        exc = ServerError(503, {"error": {"message": "temporary"}})
        expected = demo_evaluate_job(sample_offers()[0])
        with patch("backend.app.evaluator.get_settings", return_value=Settings(gemini_api_key="test-only", openai_api_key="test-only")), \
             patch("backend.app.evaluator._evaluate_gemini", side_effect=[exc, expected]) as call, \
             patch("backend.app.evaluator._evaluate_openai") as openai, \
             patch("backend.app.evaluator.time.sleep"):
            self.assertEqual(evaluate_job(sample_offers()[0]), expected)
        self.assertEqual(call.call_count, 2)
        openai.assert_not_called()
