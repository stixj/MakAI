"""Typovaný profil z Markdownu; CV a přihlášky mají samostatný zdroj."""

import json
import re
from datetime import date
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import PROJECT_ROOT

PROFILE_PATH = PROJECT_ROOT / "candidate_profile.md"
CV_FACTS_PATH = PROJECT_ROOT / "data" / "cv_facts.json"
APPLICATION_HISTORY_PATH = PROJECT_ROOT / "data" / "application_history.json"
REFERENCES_PATH = PROJECT_ROOT / "data" / "career_references.md"


class SalaryPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    monthly_gross_target_czk: tuple[int, int]
    standard_minimum_czk: int = Field(ge=0)
    interesting_minimum_czk: int = Field(ge=0)
    exceptional_minimum_czk: int = Field(ge=0)
    long_term_target_czk: int | None = Field(default=None, ge=0)
    long_term_horizon_years: int | None = Field(default=None, ge=1)
    historical_fixed_monthly_czk: int | None = Field(default=None, ge=0)
    notes: str

    @model_validator(mode="after")
    def ordered_salary_limits(self) -> Self:
        lower, upper = self.monthly_gross_target_czk
        if (
            not 0
            <= self.exceptional_minimum_czk
            <= self.standard_minimum_czk
            <= self.interesting_minimum_czk
            <= lower
            <= upper
        ):
            raise ValueError("Mzdové hranice musí být nezáporné a správně uspořádané.")
        return self


class CandidateProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    target_roles: tuple[str, ...]
    skills: tuple[str, ...]
    working_style: tuple[str, ...]
    preferences: tuple[str, ...]
    no_go_criteria: tuple[str, ...]
    no_go_keywords: tuple[str, ...] = ()
    location_preferences: tuple[str, ...]
    language_preferences: tuple[str, ...]
    salary: SalaryPreferences
    approved_cv_highlights: tuple[str, ...] = ()
    cv_source: str | None = None
    evidence_limitations: tuple[str, ...]
    profile_markdown: str


class CVFacts(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cv_source: str | None = None
    approved_cv_highlights: tuple[str, ...] = ()

    @model_validator(mode="after")
    def highlights_need_cv_source(self) -> Self:
        if self.approved_cv_highlights and not (
            self.cv_source and self.cv_source.strip()
        ):
            raise ValueError("Schválené CV podklady musí mít uvedený zdroj CV.")
        if any(not item.strip() for item in self.approved_cv_highlights):
            raise ValueError("CV podklad nesmí být prázdný.")
        return self


class ApplicationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    employer: str = Field(min_length=1)
    position: str = Field(min_length=1)
    reported_status: Literal["applied", "not_applied", "unknown"]
    applied_at: date | None = None
    notes: str = ""


def load_candidate_profile(
    path: Path = PROFILE_PATH,
    cv_facts_path: Path = CV_FACTS_PATH,
) -> CandidateProfile:
    """Preference načteme z jediného JSON bloku; kariérní kontext zůstává Markdown."""
    text = path.read_text(encoding="utf-8")
    facts = (
        CVFacts.model_validate_json(cv_facts_path.read_text(encoding="utf-8"))
        if cv_facts_path.exists() else CVFacts()
    )
    return parse_candidate_profile(text, facts)


def parse_candidate_profile(text: str, facts: CVFacts | None = None) -> CandidateProfile:
    """Validate uploaded Markdown or structured JSON without borrowing another CV."""
    facts = facts or CVFacts()
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    if text.lstrip().startswith("{"):
        text = "```json\n" + text.strip() + "\n```\n"
    blocks = list(
        re.finditer(r"^```json\s*\n(.*?)^```\s*$", text, flags=re.MULTILINE | re.DOTALL)
    )
    if len(blocks) != 1:
        raise ValueError("Profil musí obsahovat právě jeden strukturovaný JSON blok.")
    data = json.loads(blocks[0].group(1))
    if not isinstance(data, dict):
        raise TypeError("Strukturovaný profil musí být JSON objekt.")
    if {"approved_cv_highlights", "cv_source", "profile_markdown"} & data.keys():
        raise ValueError(
            "CV podklady a načtený kontext nepatří do strukturovaných preferencí."
        )
    data["approved_cv_highlights"] = facts.approved_cv_highlights
    data["cv_source"] = facts.cv_source
    data["profile_markdown"] = (
        text[: blocks[0].start()] + text[blocks[0].end() :]
    ).strip()
    return CandidateProfile.model_validate(data)


def load_application_history(
    path: Path = APPLICATION_HISTORY_PATH,
) -> tuple[ApplicationRecord, ...]:
    if not path.exists():
        return ()
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise TypeError("Historie přihlášek musí být JSON seznam.")
    return tuple(ApplicationRecord.model_validate(record) for record in records)


# Profil se načte při startu procesu; další spuštění CLI použije upravené preference.
MASTER_PROFILE = load_candidate_profile()
