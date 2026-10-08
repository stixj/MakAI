"""Domain contracts shared by providers, graph and persistence."""

from typing import Annotated, Literal, Self

from typing_extensions import TypedDict

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl,
    StringConstraints, model_validator,
)

NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class JobOffer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: NonEmptyText
    title: NonEmptyText
    company: NonEmptyText
    url: HttpUrl
    raw_description: NonEmptyText = Field(max_length=30_000)
    published_at: AwareDatetime


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
