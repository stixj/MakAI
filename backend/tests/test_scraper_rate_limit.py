import unittest
from unittest.mock import patch

import httpx

from backend.app.scrapers.base import ScraperError, request_with_backoff


class RateLimitTests(unittest.TestCase):
    def test_retry_after_is_respected_and_request_retried(self):
        responses = iter([httpx.Response(429, headers={"Retry-After": "2"}),
                          httpx.Response(200)])
        client = type("Client", (), {"get": lambda self, url, **kwargs: next(responses)})()
        with patch("backend.app.scrapers.base.time.sleep") as sleep:
            response = request_with_backoff(client, "https://example.com/job", detail=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sleep.call_args_list[1].args, (2.0,))

    def test_exhausted_429_becomes_actionable_scraper_error(self):
        client = type("Client", (), {"get": lambda self, url, **kwargs:
                                      httpx.Response(429, headers={"Retry-After": "0"})})()
        with patch("backend.app.scrapers.base.time.sleep"):
            with self.assertRaises(ScraperError):
                request_with_backoff(client, "https://example.com/job", max_retries=1)


if __name__ == "__main__":
    unittest.main()
