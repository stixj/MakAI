import json
import unittest
from datetime import UTC, datetime
from unittest.mock import patch
from backend.app.history import history_page

class HistoryTests(unittest.TestCase):
    def rows(self):
        return [{"offer_id": str(i), "offer": json.dumps({"title": "Procesní analytik", "company": "Český tým"}), "evaluation": json.dumps({"score": i, "verdict": "NO_GO" if i < 50 else "POTENTIAL_FIT"}), "evaluated_at": "2026-10-09 11:00:00" if i % 2 else "2026-09-01 11:00:00"} for i in range(73)]

    @patch("backend.app.history.result_rows")
    def test_filters_full_profile_history_before_paging(self, rows):
        rows.return_value = self.rows()
        query = {"profileId": "other", "verdict": "NO_GO", "search": "cesky", "pageSize": 12}
        pages = [history_page({**query, "page": page}) for page in range(1, 6)]
        self.assertEqual([len(p["rows"]) for p in pages], [12,12,12,12,2])
        ids = [r["offer_id"] for p in pages for r in p["rows"]]
        self.assertEqual(len(set(ids)), 50)
        self.assertEqual(ids[0], "49")
        self.assertEqual(pages[0]["counts"]["POTENTIAL_FIT"], 23)
        self.assertEqual(history_page({**query, "page": 999})["page"], 5)
        rows.assert_called_with("other")

    @patch("backend.app.history.result_rows")
    def test_period_combines_with_verdict_and_empty_page(self, rows):
        rows.return_value = self.rows()
        query = {"profileId": "other", "historyPeriod": "24h", "verdict": "NO_GO", "pageSize": 48}
        result = history_page(query, now=datetime(2026,10,9,12,tzinfo=UTC))
        self.assertEqual(result["total"], 25)
        self.assertEqual(result["totalAll"],73)
        empty=history_page({**query,"verdict":"STRONG_FIT"})
        self.assertEqual(empty["rows"],[])
        self.assertEqual(empty["page"],1)

    def test_invalid_filters(self):
        for change in [{"page":0},{"page":True},{"pageSize":500},{"verdict":"bad"},{"sort":"bad"},{"historyPeriod":"bad"},{"search":"x"*201}]:
            with self.assertRaises(ValueError):
                history_page({"profileId":"other",**change})
