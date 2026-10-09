"""Filtered pages of an uploaded candidate's stored evaluations."""
import json
import unicodedata
from datetime import UTC, datetime, timedelta
from .profile_registry import result_rows

VERDICTS = ("STRONG_FIT", "POTENTIAL_FIT", "NO_GO")


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c)).lower()


def timestamp(value):
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.replace(tzinfo=UTC) if date.tzinfo is None else date
    except (ValueError, AttributeError):
        return datetime.min.replace(tzinfo=UTC)


def history_page(payload, *, now=None):
    page, size = payload.get("page", 1), payload.get("pageSize", 12)
    verdict, sort = payload.get("verdict", "all"), payload.get("sort", "score")
    period, search = payload.get("historyPeriod", "all"), payload.get("search", "")
    if (type(page) is not int or page < 1 or type(size) is not int or size not in (6, 12, 24, 48)
        or verdict not in ("all", *VERDICTS) or sort not in ("score", "newest")
        or period not in ("all", "24h", "7d", "30d") or not isinstance(search, str) or len(search) > 200):
        raise ValueError("Neplatné filtry nebo stránka historie.")
    now = now or datetime.now(UTC)
    hours = {"24h": 24, "7d": 168, "30d": 720}.get(period)
    since = now - timedelta(hours=hours) if hours else None
    needle = normalize(search.strip())
    items = []
    for row in result_rows(payload["profileId"]):
        offer, evaluation = json.loads(row["offer"]), json.loads(row["evaluation"])
        if evaluation.get("verdict") not in VERDICTS:
            continue
        items.append((row, offer, evaluation))
    total_all = len(items)
    items = [(row, offer, evaluation) for row, offer, evaluation in items
             if needle in normalize(offer["title"] + " " + offer["company"])
             and (since is None or since <= timestamp(row["evaluated_at"]) <= now)]
    counts = {key: sum(evaluation["verdict"] == key for _, _, evaluation in items) for key in VERDICTS}
    if verdict != "all":
        items = [(row, offer, evaluation) for row, offer, evaluation in items if evaluation["verdict"] == verdict]
    if sort == "newest":
        items.sort(key=lambda item: item[0]["offer_id"])
        items.sort(key=lambda item: timestamp(item[0]["evaluated_at"]), reverse=True)
    else:
        items.sort(key=lambda item: (-item[2]["score"], normalize(item[1]["title"]), item[0]["offer_id"]))
    total = len(items)
    pages = max(1, (total + size - 1) // size)
    page = min(page, pages)
    return {"rows": [row for row, _, _ in items[(page - 1) * size:page * size]],
            "total": total, "totalAll": total_all, "counts": counts,
            "page": page, "pageSize": size, "pageCount": pages}
