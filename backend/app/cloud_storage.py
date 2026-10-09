"""Profile-scoped Turso tables: no personal files or other candidates' history."""
import re
import json
from .turso import TursoEvaluationStore


class ProfileTursoStore(TursoEvaluationStore):
    def __init__(self, database_url, auth_token, profile_id):
        if not isinstance(profile_id, str) or not re.fullmatch(r"[a-f0-9]{64}", profile_id):
            raise ValueError("Neplatný identifikátor profilu.")
        super().__init__(database_url, auth_token)
        self.table = "makai_profile_" + profile_id
        self.profile_id = profile_id

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

    def manual_offer_identities(self):
        """Exclude manually saved positions from automatic paid evaluation."""
        exists = self._request({"type": "execute", "stmt": {
            "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name='makai_manual_offers'"}})
        if not exists.get("rows"):
            return set(), set()
        urls, identities, offset = set(), set(), 0
        while True:
            result = self._request({"type": "execute", "stmt": {
                "sql": "SELECT offer FROM makai_manual_offers WHERE profile_id=? ORDER BY offer_id LIMIT 500 OFFSET ?",
                "args": [{"type": "text", "value": self.profile_id},
                         {"type": "integer", "value": str(offset)}]}})
            for row in result["rows"]:
                offer = json.loads(row[0]["value"])
                if offer.get("url"):
                    urls.add(offer["url"])
                if offer.get("canonical_id"):
                    identities.add(offer["canonical_id"])
                urls.update(source["url"] for source in offer.get("sources", []) if source.get("url"))
            if len(result["rows"]) < 500:
                return urls, identities
            offset += 500

    def edited_offer_identities(self):
        """Keep user-corrected identities in automatic search deduplication."""
        exists = self._request({"type": "execute", "stmt": {
            "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name='makai_offer_edits'"}})
        if not exists.get("rows"):
            return set(), set()
        urls, identities, offset = set(), set(), 0
        while True:
            result = self._request({"type": "execute", "stmt": {
                "sql": "SELECT payload FROM makai_offer_edits WHERE profile_id=? ORDER BY offer_id LIMIT 500 OFFSET ?",
                "args": [{"type": "text", "value": self.profile_id},
                         {"type": "integer", "value": str(offset)}]}})
            for row in result["rows"]:
                offer = json.loads(row[0]["value"])
                if offer.get("url"):
                    urls.add(offer["url"])
                if offer.get("canonical_id"):
                    identities.add(offer["canonical_id"])
            if len(result["rows"]) < 500:
                return urls, identities
            offset += 500
