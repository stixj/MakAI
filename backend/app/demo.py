"""Explicit mock fixtures for a free offline smoke test, never used by evaluate_job."""

from datetime import datetime, timezone

from .profile import MASTER_PROFILE
from .schemas import JobFitEvaluation, JobOffer


def sample_offers() -> list[JobOffer]:
    published_at = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
    return [
        JobOffer(
            id="demo-ai-agent",
            title="AI Automation Specialist",
            company="Example AI Studio",
            url="https://example.com/jobs/ai-agent",
            raw_description=(
                "Hledáme AI Automation Specialist do českého týmu v Brně. "
                "Náplní je analýza provozních problémů, návrh AI řešení, promptování, "
                "prototypování s pomocí AI nástrojů a testování výstupů. "
                "Produkční implementaci zajišťují zkušení vývojáři. "
                "Mzda 70 000–80 000 Kč hrubého fixně, hybridní režim a odborné konzultace. "
                "Profesionální programování ani anglické prezentace nejsou podmínkou."
            ),
            published_at=published_at,
        ),
        JobOffer(
            id="demo-sales",
            title="Obchodní zástupce – telefonní akvizice",
            company="Example Sales",
            url="https://example.com/jobs/sales",
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
            score=95,
            verdict="STRONG_FIT",
            fit_reasons=[
                "Analýza procesů, promptování a testování navazují na uvedené zkušenosti.",
                "AI automatizace a konkrétní prototypy odpovídají preferované náplni práce.",
                "Brno, český tým a uvedená fixní mzda odpovídají preferencím kandidáta.",
            ],
            gap_analysis=[
                "Přesná kariérní data a CV podklady je třeba doložit samostatným životopisem."
            ],
            tailored_cv_highlights=list(MASTER_PROFILE.approved_cv_highlights[:4]),
        )
    return JobFitEvaluation(
        score=5,
        verdict="NO_GO",
        fit_reasons=[
            "Čistá telefonní akvizice patří mezi výrazně méně preferované pracovní směry.",
            "Role nevyužívá business analýzu, návrh řešení ani AI automatizaci.",
        ],
        gap_analysis=["Náplň práce je čistě prodejní a bez AI automatizace."],
        tailored_cv_highlights=[],
    )
