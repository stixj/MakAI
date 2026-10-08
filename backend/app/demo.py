"""Explicit mock fixtures for a free offline smoke test, never used by evaluate_job."""

from datetime import datetime, timezone

from .profile import MASTER_PROFILE
from .schemas import JobFitEvaluation, JobOffer


def sample_offers() -> list[JobOffer]:
    published_at = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
    return [
        JobOffer(
            id="demo-ai-agent", title="AI Agent Engineer",
            company="Example AI Studio", url="https://example.com/jobs/ai-agent",
            raw_description=(
                "Hledáme vývojáře AI agentů pro automatizaci enterprise procesů. "
                "Používáme Python, FastAPI a LangGraph, integrujeme LLM přes API. "
                "Součástí role je analýza workflow v BPMN a návrh AI řešení. "
                "Moderní stack, spolupráce s procesními analytiky a prostor pro experimenty. "
                "Konkrétní délka praxe ani certifikace nejsou podmínkou."
            ),
            published_at=published_at,
        ),
        JobOffer(
            id="demo-sales", title="Obchodní zástupce – telefonní akvizice",
            company="Example Sales", url="https://example.com/jobs/sales",
            raw_description=(
                "Náplň práce tvoří výhradně cold-calling: 100 telefonátů denně, "
                "akvizice nových zákazníků a prodej tarifů za provizi. "
                "Nejde o vývoj, procesní analýzu ani AI automatizaci. "
                "Požadujeme přesvědčivé prodejní vystupování a plnění obchodních kvót."
            ),
            published_at=published_at,
        ),
    ]


def demo_evaluate_job(offer: JobOffer) -> JobFitEvaluation:
    """Return known fixture results only for the two exact sample offers."""
    known = {sample.id: sample for sample in sample_offers()}
    if known.get(offer.id) != offer:
        raise ValueError("Offline demo podporuje pouze dodané ukázkové inzeráty.")
    if offer.id == "demo-ai-agent":
        return JobFitEvaluation(
            score=95, verdict="STRONG_FIT",
            fit_reasons=[
                "Role výslovně vyžaduje Python, FastAPI a LangGraph uvedené v profilu.",
                "LLM integrace a AI automatizace odpovídají preferované náplni práce.",
                "BPMN a enterprise procesy přímo navazují na dovednosti uchazeče.",
            ],
            gap_analysis=["Konkrétní projektové reference a rozsah praxe nejsou doloženy."],
            tailored_cv_highlights=list(MASTER_PROFILE.approved_cv_highlights[:4]),
        )
    return JobFitEvaluation(
        score=5, verdict="NO_GO",
        fit_reasons=[
            "Čistá telefonní akvizice porušuje explicitní no-go kritérium profilu.",
            "Role nevyužívá Python, agentní workflow ani LLM integrace.",
        ],
        gap_analysis=["Náplň práce je čistě prodejní a bez AI automatizace."],
        tailored_cv_highlights=[],
    )
