"""Profile-scoped Turso tables: no personal files or other candidates' history."""
import re
from .turso import TursoEvaluationStore


class ProfileTursoStore(TursoEvaluationStore):
    def __init__(self, database_url, auth_token, profile_id):
        if not isinstance(profile_id, str) or not re.fullmatch(r"[a-f0-9]{64}", profile_id):
            raise ValueError("Neplatný identifikátor profilu.")
        super().__init__(database_url, auth_token)
        self.table = "makai_profile_" + profile_id

    def _request(self, command):
        # Existing canonicalization and transaction code is reused unchanged.
        # Identifiers are derived only from a validated SHA-256, never user SQL.
        def scoped(value):
            if isinstance(value, dict):
                return {key: (rewrite(item) if key == "sql" else scoped(item)) for key, item in value.items()}
            if isinstance(value, list):
                return [scoped(item) for item in value]
            if value == "makai_job_evaluations":
                return self.table
            if value in ("makai_job_canonical_idx", "makai_job_url_idx"):
                return str(value).replace("makai_job", self.table)
            return value

        def rewrite(sql):
            return (sql.replace("makai_job_evaluations", self.table)
                    .replace("makai_job_canonical_idx", self.table + "_canonical_idx")
                    .replace("makai_job_url_idx", self.table + "_url_idx"))

        return super()._request(scoped(command))
