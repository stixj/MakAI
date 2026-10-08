"""Validated configuration; importing this module never calls external services."""

from functools import lru_cache
import os
from pathlib import Path
from typing import Literal

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    gemini_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    database_url: SecretStr | None = None
    llm_provider: Literal["auto", "gemini", "openai"] = "auto"
    gemini_model: str = Field(default="gemini-3.5-flash", min_length=1)
    openai_model: str = Field(default="gpt-4o-mini", min_length=1)
    allow_openai_fallback: bool = False
    llm_timeout_seconds: float = Field(default=30, ge=1, le=120)
    llm_max_output_tokens: int = Field(default=4096, ge=512, le=8192)
    local_results_path: Path = PROJECT_ROOT / "data" / "results.json"

    @field_validator("gemini_api_key", "openai_api_key", "database_url", mode="before")
    @classmethod
    def empty_secret_is_none(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("local_results_path")
    @classmethod
    def resolve_results_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else PROJECT_ROOT / value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Read root .env independently of cwd; environment variables take precedence."""
    values = {**dotenv_values(PROJECT_ROOT / ".env"), **os.environ}
    fields = {
        field: values[field.upper()]
        for field in Settings.model_fields
        if values.get(field.upper()) is not None
    }
    return Settings.model_validate(fields)
