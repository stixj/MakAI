"""Domain contracts shared by providers, graph and persistence."""

from typing import Annotated, Literal, Self

from typing_extensions import NotRequired, TypedDict

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl,
    StringConstraints, field_validator, model_validator,
)

from .utils.fingerprint import generate_canonical_id
from .utils.sources import merge_sources, source_for_url

NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class JobOffer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: NonEmptyText
    title: NonEmptyText
    company: NonEmptyText
    url: HttpUrl
    raw_description: NonEmptyText = Field(max_length=30_000)
    published_at: AwareDatetime | None = None
    canonical_id: str = ""
    sources: list[dict[str, str]] = Field(default_factory=list)
    salary_raw: NonEmptyText | None = None
    location: NonEmptyText | None = None

    @field_validator("salary_raw", "location", mode="before")
    @classmethod
    def blank_is_unknown(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def canonical_identity(self) -> Self:
        expected = generate_canonical_id(self.company, self.title, self.location or "")
        if self.canonical_id and self.canonical_id != expected:
            raise ValueError("canonical_id does not match company, title and location.")
        object.__setattr__(self, "canonical_id", expected)
        object.__setattr__(self, "sources", merge_sources(
            self.sources, [source_for_url(str(self.url))],
        ))
        return self


class RawJobOffer(JobOffer):
    """Validated scraper output, before any LLM evaluation."""


class JobFitEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=0, le=100, strict=True)
    verdict: Literal["STRONG_FIT", "POTENTIAL_FIT", "NO_GO"]
    fit_reasons: list[NonEmptyText] = Field(
        min_length=2, max_length=3,
        description="2–3 konkrétní shody; při NO_GO vysvětli chybějící shodu.",
    )
    gap_analysis: list[NonEmptyText]
    tailored_cv_highlights: list[NonEmptyText] = Field(
        description="Pouze doslovné položky approved_cv_highlights z profilu.",
    )

    @model_validator(mode="after")
    def consistent_verdict(self) -> Self:
        expected = (
            "STRONG_FIT" if self.score >= 80
            else "POTENTIAL_FIT" if self.score >= 50
            else "NO_GO"
        )
        if self.verdict != expected:
            raise ValueError("Verdikt neodpovídá pásmu skóre: 80–100 / 50–79 / 0–49.")
        return self


class MakAIState(TypedDict):
    offers: list[JobOffer]
    evaluations: dict[str, JobFitEvaluation]
    errors: list[str]
    skipped_duplicates: NotRequired[list[str]]
    saved_ids: NotRequired[list[str]]
    enriched_ids: NotRequired[list[str]]
    evaluation_blocked: NotRequired[dict | None]
    evaluation_limit_reached: NotRequired[bool]
