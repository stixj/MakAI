"""One-time online setup. Values are sent via stdin/encrypted APIs, never printed.

Run with the project's venv after `vercel link`; PyNaCl is needed for GitHub setup.
Generated login details stay under ignored data/, outside source and deployments.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "data" / "online-private.json"
REPOSITORY = "stixj/MakAI"


def configuration():
    values = {**dotenv_values(ROOT / ".env"), **os.environ}
    generated = json.loads(PRIVATE.read_text(encoding="utf-8")) if PRIVATE.exists() else {
        "MAKAI_LOGIN_PASSWORD": secrets.token_urlsafe(18),
        "MAKAI_SESSION_SECRET": secrets.token_urlsafe(48),
        "MAKAI_WORKER_SECRET": secrets.token_urlsafe(48),
    }
    PRIVATE.parent.mkdir(parents=True, exist_ok=True)
    PRIVATE.write_text(json.dumps(generated), encoding="utf-8")
    generated.update({key: values[key] for key in generated if values.get(key)})
    if not values.get("DATABASE_URL") or not values.get("TURSO_AUTH_TOKEN"):
        raise ValueError("Missing database configuration in root .env")
    return {**values, **generated}


def vercel_setup(values):
    for key in ("DATABASE_URL", "TURSO_AUTH_TOKEN", "MAKAI_LOGIN_PASSWORD", "MAKAI_SESSION_SECRET", "MAKAI_WORKER_SECRET", "OPENAI_API_KEY", "OPENAI_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "LLM_PROVIDER", "PROFILE_GEMINI_MODEL", "PROFILE_LLM_PROVIDER"):
        if not values.get(key):
            continue
        result = subprocess.run(["npx.cmd" if os.name == "nt" else "npx", "--yes", "vercel@latest", "env", "add", key,
                                 "production", "--sensitive", "--force", "--yes"],
                                input=values[key], text=True, encoding="utf-8", cwd=ROOT, capture_output=True)
        if result.returncode:
            raise ValueError("Vercel variable setup failed for " + key)
        print("Vercel stored " + key, flush=True)
    access = ROOT / "data" / "online-access.txt"
    access.write_text("MakAI login password\n\n" + values["MAKAI_LOGIN_PASSWORD"] + "\n", encoding="utf-8")
    print("Login password saved to ignored data/online-access.txt; value not printed.")


def github_token():
    result = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                            text=True, capture_output=True, cwd=ROOT)
    if result.returncode:
        raise ValueError("GitHub login unavailable")
    fields = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    return fields["password"]


def github_request(token, path, method="GET", payload=None):
    request = Request("https://api.github.com/repos/" + REPOSITORY + path,
                      method=method, data=json.dumps(payload).encode("utf-8") if payload is not None else None,
                      headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                               "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"})
    with urlopen(request, timeout=30) as response:
        body = response.read()
    return json.loads(body) if body else None


def github_setup(values, url):
    from nacl.public import PublicKey, SealedBox
    token = github_token()
    key = github_request(token, "/actions/secrets/public-key")
    box = SealedBox(PublicKey(base64.b64decode(key["key"])))
    for name in ("DATABASE_URL", "TURSO_AUTH_TOKEN", "GEMINI_API_KEY", "OPENAI_API_KEY", "MAKAI_WORKER_SECRET"):
        if not values.get(name):
            continue
        encrypted = base64.b64encode(box.encrypt(values[name].encode("utf-8"))).decode("ascii")
        github_request(token, "/actions/secrets/" + name, "PUT", {"encrypted_value": encrypted, "key_id": key["key_id"]})
        print("GitHub stored encrypted " + name, flush=True)
    for name, value in {"MAKAI_URL": url.rstrip("/"), "LLM_PROVIDER": values.get("LLM_PROVIDER") or "auto"}.items():
        try:
            github_request(token, "/actions/variables/" + name)
            method, path = "PATCH", "/actions/variables/" + name
        except HTTPError as error:
            if error.code != 404:
                raise
            method, path = "POST", "/actions/variables"
        github_request(token, path, method, {"name": name, "value": value})
        print("GitHub configured " + name, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=("vercel", "github"))
    parser.add_argument("--url")
    args = parser.parse_args()
    try:
        values = configuration()
        if args.target == "vercel":
            vercel_setup(values)
        elif not args.url or not args.url.startswith("https://"):
            raise ValueError("Provide deployed HTTPS URL")
        else:
            github_setup(values, args.url)
        return 0
    except Exception as error:
        # Never echo SDK bodies, provider URLs, subprocess output, or credentials.
        message = str(error) if type(error) is ValueError else type(error).__name__
        print("Online setup failed: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
