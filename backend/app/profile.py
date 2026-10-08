"""Candidate facts supplied in the project brief, without invented career history."""

from pydantic import BaseModel, ConfigDict


class CandidateProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    target_roles: tuple[str, ...]
    skills: tuple[str, ...]
    working_style: tuple[str, ...]
    preferences: tuple[str, ...]
    no_go_criteria: tuple[str, ...]
    approved_cv_highlights: tuple[str, ...]
    evidence_limitations: tuple[str, ...]


MASTER_PROFILE = CandidateProfile(
    target_roles=("AI Solution Engineer", "Agentic Developer", "AI Agent Engineer"),
    skills=(
        "Python", "FastAPI", "LangGraph", "LLM integrace",
        "Návrh workflow v BPMN", "Enterprise procesy", "Analytické myšlení",
    ),
    working_style=(
        "Rozklad procesů na jasné kroky, vstupy a výstupy.",
        "Propojení technického návrhu s potřebami enterprise procesů.",
        "Zájem o typované API a transparentní agentní orchestrace.",
    ),
    preferences=(
        "Moderní Python stack a API integrace.",
        "AI automatizace a agentní workflow s měřitelným přínosem.",
        "Role kombinující procesní analýzu a implementaci AI řešení.",
    ),
    no_go_criteria=(
        "Čistý cold-calling a čistě akviziční prodej.",
        "Údržba legacy monolitů bez AI a bez prostoru pro modernizaci.",
    ),
    approved_cv_highlights=(
        "Python a FastAPI pro tvorbu API.",
        "LangGraph pro orchestrace agentních workflow.",
        "Integrace LLM do aplikací a automatizovaných workflow.",
        "BPMN a analýza enterprise procesů.",
        "Analytické myšlení při návrhu AI automatizace.",
    ),
    evidence_limitations=(
        "Dovednosti pocházejí ze zadání; konkrétní projekty nebyly doloženy.",
        "Nejsou známi zaměstnavatelé, délka praxe, vzdělání ani certifikace.",
        "Nevymýšlej dosažené výsledky, metriky, senioritu ani produkční nasazení.",
    ),
)
