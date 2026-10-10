"""Run real ingestion: python backend/run_hunt.py [--limit 15]."""

import argparse
import logging

from pydantic import ValidationError
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

if __package__:
    from .app.config import get_settings
    from .app.graph import build_graph
    from .app.profile import load_candidate_profile
    from .app.search_plan import startup_searches, jobs_listing_urls
    from .app.scrapers import SCRAPERS, DEFAULT_PORTALS
    from .app.scrapers.startupjobs import ScraperError, fetch_startupjobs
    from .app.storage import create_store
    from .app.turso import StorageConfigurationError, TursoEvaluationStore
else:
    from app.config import get_settings
    from app.graph import build_graph
    from app.profile import load_candidate_profile
    from app.search_plan import startup_searches, jobs_listing_urls
    from app.scrapers import SCRAPERS, DEFAULT_PORTALS
    from app.scrapers.startupjobs import ScraperError, fetch_startupjobs
    from app.storage import create_store
    from app.turso import StorageConfigurationError, TursoEvaluationStore


def _limit(value: str) -> int:
    number = int(value)
    if not 1 <= number <= 100:
        raise argparse.ArgumentTypeError("Limit musí být v rozsahu 1–100.")
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MakAI: české portály, deduplikace, obohacení a LLM evaluace")
    parser.add_argument("--limit", type=_limit, default=15, help="Maximální počet nabídek na portál (1–100)")
    parser.add_argument("--portals", nargs="+", choices=[*SCRAPERS, "all"], default=list(DEFAULT_PORTALS),
                        help="Zdroje nabídek; výchozí je šest českých portálů, all přidá i StartupJobs")
    args = parser.parse_args(argv)
    console = Console()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    try:
        profile = load_candidate_profile()
        settings = get_settings()
        store = create_store(settings)
        if not isinstance(store, TursoEvaluationStore):
            raise StorageConfigurationError("Lov vyžaduje Turso: nastav DATABASE_URL a TURSO_AUTH_TOKEN.")
        store.check_connection()
        portals = list(SCRAPERS) if "all" in args.portals else list(dict.fromkeys(args.portals))
        console.print(Text("MakAI – lov: " + ", ".join(portals), style="bold cyan"))
        offers = []
        source_errors = []
        for portal in portals:
            try:
                found = (fetch_startupjobs(args.limit, searches=startup_searches(profile)) if portal == "startupjobs"
                         else SCRAPERS[portal](listing_urls=jobs_listing_urls(profile)).fetch_jobs(args.limit) if portal == "jobs"
                         else SCRAPERS[portal]().fetch_jobs(args.limit))
                offers.extend(found)
                console.print(Text(f"{portal}: {len(found)} nabídek."))
            except ScraperError as exc:
                source_errors.append(str(exc))
        console.print(f"Nalezeno: {len(offers)} nabídek.")
        result = build_graph(settings=settings, store=store, profile=profile).invoke(
            {"offers": offers, "evaluations": {}, "errors": source_errors}
        )
    except (StorageConfigurationError, ScraperError) as exc:
        console.print(Text(str(exc), style="red"))
        return 1
    except ValidationError:
        console.print("[red]Neplatná konfigurace .env.[/]")
        return 1
    except Exception as exc:
        console.print(Text(f"Lov selhal: {type(exc).__name__}.", style="red"))
        return 1

    console.print(f"Přeskočeno duplicit: {len(result['skipped_duplicates'])}.")
    console.print(f"Obohaceno uložených nabídek: {len(result.get('enriched_ids', []))}.")
    table = Table(title="Vyhodnocení nových nabídek")
    for heading in ("Pozice", "Firma", "Skóre", "Verdikt"):
        table.add_column(heading)
    styles = {"STRONG_FIT": "green", "POTENTIAL_FIT": "yellow", "NO_GO": "red"}
    for offer in result["offers"]:
        evaluation = result["evaluations"].get(offer.id)
        if evaluation is None:
            table.add_row(Text(offer.title), Text(offer.company), "—", "CHYBA")
            continue
        table.add_row(
            Text(offer.title), Text(offer.company), f"{evaluation.score}/100",
            Text(evaluation.verdict, style=styles[evaluation.verdict]),
        )
    if result["offers"]:
        console.print(table)
    for offer in result["offers"]:
        evaluation = result["evaluations"].get(offer.id)
        if evaluation is not None:
            reasons = Text("Klíčové důvody\n", style="bold")
            for reason in evaluation.fit_reasons:
                reasons.append(f"• {reason}\n", style="default")
            console.print(Panel(reasons, title=Text(offer.title),
                                border_style=styles[evaluation.verdict]))
    console.print(f"Vyhodnoceno: {len(result['evaluations'])}; uloženo do Turso: {len(result['saved_ids'])}.")
    for error in result["errors"]:
        console.print(Text(error, style="red"))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
