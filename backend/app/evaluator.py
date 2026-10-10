"""Structured semantic matching with explicit, bounded provider fallback."""

import json
import logging
import time
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar

from google import genai
from google.genai import types
import httpx
from openai import APIConnectionError, APITimeoutError, OpenAI

from .config import PROJECT_ROOT, Settings, get_settings
from .profile import CandidateProfile, MASTER_PROFILE, REFERENCES_PATH, load_application_history
from .schemas import JobFitEvaluation, JobOffer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (PROJECT_ROOT / "agent_instructions.md").read_text(encoding="utf-8")


class EvaluationError(RuntimeError):
    """A safe diagnostic that never embeds provider responses or credentials."""
    def __init__(self, message, *, kind="evaluation", stop_batch=False, retryable=False):
        super().__init__(message)
        self.kind = kind
        self.stop_batch = stop_batch
        self.retryable = retryable


def provider_failure(exc, name):
    """Use only status codes and quota metadata; never expose SDK response messages."""
    if isinstance(exc, (APITimeoutError, APIConnectionError, httpx.TransportError,
                        TimeoutError, ConnectionError)):
        return EvaluationError(f"{name}: spojení s API selhalo nebo překročilo časový limit.",
                               kind="transport", stop_batch=True, retryable=True)
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    details = getattr(exc, "details", None)
    payload = details.get("error", details) if isinstance(details, dict) else {}
    quota_ids = [v.get("quotaId", "") for d in payload.get("details", []) if isinstance(d, dict)
                 for v in d.get("violations", []) if isinstance(v, dict)]
    if code == 429:
        daily = any("PerDay" in value for value in quota_ids if isinstance(value, str))
        if daily:
            return EvaluationError(f"{name}: vyčerpán denní limit API. Počkej na obnovení kvóty nebo uprav tarif API projektu.",
                                   kind="daily_quota", stop_batch=True)
        return EvaluationError(f"{name}: dosažen limit požadavků nebo tokenů API (429). Zkus hodnocení později a ověř kvótu projektu.",
                               kind="rate_limit", stop_batch=True)
    if code in {401, 403}:
        return EvaluationError(f"{name}: API klíč nemá přístup (HTTP {code}). Ověř klíč a oprávnění projektu.",
                               kind="credentials", stop_batch=True)
    if code == 402:
        return EvaluationError(f"{name}: chybí API kredit nebo aktivní fakturace (402).",
                               kind="billing", stop_batch=True)
    if isinstance(code, int) and 500 <= code < 600:
        return EvaluationError(f"{name}: služba je dočasně nedostupná (HTTP {code}). Zkus hodnocení později.",
                               kind="service_unavailable", stop_batch=True, retryable=True)
    if code in {400, 404}:
        return EvaluationError(f"{name}: model nebo požadavek není dostupný v této konfiguraci (HTTP {code}).",
                               kind="configuration", stop_batch=True)
    if isinstance(exc, EvaluationError):
        return exc
    return EvaluationError(f"{name}: {type(exc).__name__}.")


_profile_context: ContextVar[tuple[CandidateProfile, bool] | None] = ContextVar("profile_context", default=None)


def active_profile() -> CandidateProfile:
    context = _profile_context.get()
    return context[0] if context is not None else MASTER_PROFILE


@contextmanager
def evaluation_context(profile: CandidateProfile, *, personal_history: bool = False):
    token = _profile_context.set((profile, personal_history))
    try:
        yield
    finally:
        _profile_context.reset(token)


def build_prompt(offer: JobOffer) -> str:
    return json.dumps(
        {
            "candidate_profile": active_profile().model_dump(
                mode="json", exclude={"profile_markdown"},
            ),
            "untrusted_job_offer": offer.model_dump(mode="json"),
        },
        ensure_ascii=False,
    )


def validate_evaluation(evaluation: JobFitEvaluation) -> JobFitEvaluation:
    """Reject CV claims outside the candidate's approved facts."""
    validated = JobFitEvaluation.model_validate(evaluation.model_dump())
    allowed = set(active_profile().approved_cv_highlights)
    if any(highlight not in allowed for highlight in validated.tailored_cv_highlights):
        raise EvaluationError("LLM vrátil CV tvrzení mimo master profil.")
    return validated


def _evaluate_gemini(offer: JobOffer, settings: Settings) -> JobFitEvaluation:
    if settings.gemini_api_key is None:
        raise EvaluationError("Chybí GEMINI_API_KEY.", kind="credentials", stop_batch=True)
    with genai.Client(
        api_key=settings.gemini_api_key.get_secret_value(),
        http_options=types.HttpOptions(
            timeout=int(settings.llm_timeout_seconds * 1000),
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    ) as client:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=build_prompt(offer),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_json_schema=JobFitEvaluation.model_json_schema(),
                max_output_tokens=settings.evaluation_max_output_tokens,
            ),
        )
    if not response.text:
        raise EvaluationError("Gemini nevrátil JSON (odmítnutí nebo prázdná odpověď).")
    return JobFitEvaluation.model_validate_json(response.text)


def _evaluate_openai(offer: JobOffer, settings: Settings) -> JobFitEvaluation:
    if settings.openai_api_key is None:
        raise EvaluationError("Chybí OPENAI_API_KEY.", kind="credentials", stop_batch=True)
    with OpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        timeout=settings.llm_timeout_seconds,
        max_retries=0,
    ) as client:
        response = client.responses.parse(
            model=settings.openai_model,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_prompt(offer)},
            ],
            text_format=JobFitEvaluation,
            max_output_tokens=settings.evaluation_max_output_tokens,
            store=False,
        )
    if response.status != "completed" or response.output_parsed is None:
        raise EvaluationError("OpenAI nevrátil úplný strukturovaný výstup.")
    return response.output_parsed


def evaluate_job(offer: JobOffer) -> JobFitEvaluation:
    """Gemini first in auto mode; OpenAI fallback requires explicit opt-in."""
    settings = get_settings()
    providers: list[tuple[str, Callable[[JobOffer, Settings], JobFitEvaluation]]] = []
    if settings.llm_provider == "openai":
        if settings.openai_api_key:
            providers.append(("OpenAI", _evaluate_openai))
    elif settings.llm_provider == "gemini":
        if settings.gemini_api_key:
            providers.append(("Gemini", _evaluate_gemini))
    else:
        if settings.gemini_api_key:
            providers.append(("Gemini", _evaluate_gemini))
        if settings.openai_api_key and (
            not settings.gemini_api_key or settings.allow_openai_fallback
        ):
            providers.append(("OpenAI", _evaluate_openai))
    if not providers:
        raise EvaluationError(
            "Chybí API klíč pro zvoleného poskytovatele. Vyplň .env nebo použij --demo.",
            kind="credentials", stop_batch=True,
        )
    failures: list[EvaluationError] = []
    for name, provider in providers:
        failure = None
        for attempt in range(3):
            try:
                return validate_evaluation(provider(offer, settings))
            except Exception as exc:  # SDK response bodies must stay private.
                failure = provider_failure(exc, name)
                logger.warning("Evaluace selhala (%s; %s).", name, failure.kind)
                # Retryable describes a future run, not permission to keep a
                # timed-out or quota-blocked batch alive (including fallback).
                if failure.kind == "transport" or (failure.stop_batch and not failure.retryable):
                    raise failure from None
                if not failure.retryable or attempt == 2:
                    break
                time.sleep(2 ** attempt)
        failures.append(failure)
    raise EvaluationError(" ".join(str(failure) for failure in failures),
                          kind=failures[-1].kind,
                          stop_batch=all(failure.stop_batch for failure in failures))
