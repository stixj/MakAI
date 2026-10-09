"""GitHub Actions worker. Profile snapshots stay in temporary files, never logs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def worker_request(payload):
    url = os.environ.get("MAKAI_URL", "").rstrip("/")
    parsed = urlsplit(url)
    secret = os.environ.get("MAKAI_WORKER_SECRET", "")
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/") or len(secret) < 32:
        raise ValueError("Worker configuration missing")
    request = Request(url + "/api/worker", data=json.dumps(payload).encode("utf-8"), method="POST",
                      headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"})
    with build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(300001)
    if len(raw) > 300000:
        raise ValueError("Response too large")
    return json.loads(raw)


def claim(path):
    if not os.environ.get("MAKAI_URL") or not os.environ.get("MAKAI_WORKER_SECRET"):
        print("Online worker is not connected yet; no search started.")
        return False
    run = worker_request({"action": "claim"})["run"]
    if run:
        path.write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
        path.chmod(0o600)
    return bool(run)


def execute(path):
    run = json.loads(path.read_text(encoding="utf-8"))
    identity = {"id": run["id"], "token": run["token"]}
    child = None
    try:
        # Temporary files avoid pipe deadlocks when a batch result is larger than a pipe buffer.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            child = subprocess.Popen([sys.executable, str(Path(__file__).with_name("local_api.py")), "cloud-hunt"],
                                     stdin=subprocess.PIPE, stdout=output, stderr=errors,
                                     env={**os.environ, "PYTHONIOENCODING": "utf-8"})
            child.stdin.write(json.dumps(run, ensure_ascii=False).encode("utf-8"))
            child.stdin.close()
            deadline = time.monotonic() + 30 * 60
            while child.poll() is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                state = worker_request({"action": "status", **identity})["status"]
                if state != "running":
                    child.terminate()
                    child.wait(timeout=10)
                    worker_request({"action": "finish", **identity, "status": "cancelled"})
                    print("Search cancelled.")
                    return 0
                time.sleep(10)
            output.seek(0)
            result = json.loads(output.read(2000001))
        if child.returncode != 0 or result.get("error"):
            raise RuntimeError()
        status = "blocked" if result.get("evaluationBlocked") and not result["evaluated"] else "partial" if result["errors"] else "done"
        worker_request({"action": "finish", **identity, "status": status, "result": result})
        print(f"Search finished: {result['found']} found, {result['evaluated']} evaluated, {result['saved']} saved.")
        return 0
    except Exception:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()
        try:
            worker_request({"action": "finish", **identity, "status": "error"})
        except Exception:
            pass
        print("Search interrupted. Check the application and worker configuration; no private diagnostics printed.")
        return 1
    finally:
        path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("claim", "run"))
    parser.add_argument("--file", required=True, type=Path)
    args = parser.parse_args()
    if args.action == "run":
        return execute(args.file)
    try:
        pending = claim(args.file)
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as handle:
                handle.write("pending=" + ("true" if pending else "false") + "\n")
        print("Search claimed." if pending else "No search due.")
        return 0
    except Exception:
        print("Worker could not connect. Check MAKAI_URL and the worker secret.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
