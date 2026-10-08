"""Structured semantic matching with explicit, bounded provider fallback."""

import json
import logging
from collections.abc import Callable

from google import genai
from google.genai import types
from openai import OpenAI

from .config import PROJECT_ROOT, Settings, get_settings
from .profile import MASTER_PROFILE, REFERENCES_PATH, load_application_history
from .schemas import JobFitEvaluation, JobOffer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (PROJECT_ROOT / "agent_instructions.md").read_text(encoding="utf-8")


class EvaluationError(RuntimeError):
    """A safe diagnostic that never embeds provider responses or credentials."""


def build_prompt(offer: JobOffer) -> str:
    return json.dumps(
        {
            "candidate_profile": MASTER_PROFILE.model_dump(mode="json"),
            "application_history": [
                item.model_dump(mode="json") for item in load_application_history()
            ],
            "historical_career_references": (
                REFERENCES_PATH.read_text(encoding="utf-8")
                if REFERENCES_PATH.exists()
                else ""
            ),
            "untrusted_job_offer": offer.model_dump(mode="json"),
        },
        ensure_ascii=False,
    )


def validate_evaluation(evaluation: JobFitEvaluation) -> JobFitEvaluation:
    """Reject CV claims outside the candidate's approved facts."""
    validated = JobFitEvaluation.model_validate(evaluation.model_dump())
    allowed = set(MASTER_PROFILE.approved_cv_highlights)
    if any(highlight not in allowed for highlight in validated.tailored_cv_highlights):
        raise EvaluationError("LLM vrátil CV tvrzení mimo master profil.")
    return validated


def _evaluate_gemini(offer: JobOffer, settings: Settings) -> JobFitEvaluation:
    if settings.gemini_api_key is None:
        raise EvaluationError("Chybí GEMINI_API_KEY.")
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
                max_output_tokens=settings.llm_max_output_tokens,
            ),
        )
    if not response.text:
        raise EvaluationError("Gemini nevrátil JSON (odmítnutí nebo prázdná odpověď).")
    return JobFitEvaluation.model_validate_json(response.text)


def _evaluate_openai(offer: JobOffer, settings: Settings) -> JobFitEvaluation:
    if settings.openai_api_key is None:
        raise EvaluationError("Chybí OPENAI_API_KEY.")
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
            max_output_tokens=settings.llm_max_output_tokens,
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
            "Chybí API klíč pro zvoleného poskytovatele. Vyplň .env nebo použij --demo."
        )
    failures: list[str] = []
    for name, provider in providers:
        try:
            return validate_evaluation(provider(offer, settings))
        except Exception as exc:  # noqa: BLE001 - chyby SDK izolujeme a redigujeme.
            # Provider messages can contain keys, URLs and personal data.
            diagnostic = f"{name}: {type(exc).__name__}"
            failures.append(diagnostic)
            logger.warning("Evaluace selhala (%s).", diagnostic)
    raise EvaluationError("Evaluace selhala; " + "; ".join(failures)) from None
