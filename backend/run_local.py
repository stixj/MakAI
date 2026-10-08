"""Run from the repository root: python backend/run_local.py [--demo]."""

import argparse
import logging
from typing import cast

from app.config import PROJECT_ROOT, get_settings
from app.demo import demo_evaluate_job, sample_offers
from app.graph import build_graph
from app.schemas import MakAIState
from app.storage import JsonEvaluationStore, create_store
from app.turso import StorageConfigurationError, TursoEvaluationStore
from pydantic import ValidationError
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text


def main() -> int:
    parser = argparse.ArgumentParser(description="MakAI: sémantické hodnocení pracovních nabídek")
    parser.add_argument("--demo", action="store_true", help="Offline fixture, žádná API ani DB volání")
    args = parser.parse_args()
    console = Console()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    try:
        if args.demo:
            graph = build_graph(
                evaluator=demo_evaluate_job,
                store=JsonEvaluationStore(PROJECT_ROOT / "data" / "demo_results.json"),
            )
            destination = str(PROJECT_ROOT / "data" / "demo_results.json")
            console.print("[bold yellow]OFFLINE DEMO – výsledky jsou pevné ukázkové hodnoty.[/]")
        else:
            settings = get_settings()
            store = create_store(settings)
            graph = build_graph(settings=settings, store=store)
            destination = (
                ("Turso" if isinstance(store, TursoEvaluationStore) else "PostgreSQL")
                + ": makai_job_evaluations" if settings.database_url
                else str(settings.local_results_path)
            )
            console.print("[bold cyan]MakAI – živá LLM evaluace[/]")
        initial: MakAIState = {"offers": sample_offers(), "evaluations": {}, "errors": []}
        result = cast(MakAIState, graph.invoke(initial))
    except StorageConfigurationError as exc:
        console.print(Text(str(exc), style="red"))
        return 1
    except ValidationError:
        console.print("[red]Neplatná konfigurace .env. Zkontroluj poskytovatele a číselné limity.[/]")
        return 1
    except Exception as exc:  # noqa: BLE001 — CLI must redact unexpected SDK/DB errors.
        console.print(Text(f"Spuštění selhalo: {type(exc).__name__}", style="red"))
        return 1

    table = Table(title="Vyhodnocení nabídek")
    for heading in ("Role", "Firma", "Skóre", "Verdikt"):
        table.add_column(heading)
    styles = {"STRONG_FIT": "green", "POTENTIAL_FIT": "yellow", "NO_GO": "red"}
    for offer in result["offers"]:
        evaluation = result["evaluations"].get(offer.id)
        if evaluation is None:
            table.add_row(Text(offer.title), Text(offer.company), "—", Text("CHYBA", style="red"))
            continue
        table.add_row(
            Text(offer.title), Text(offer.company), str(evaluation.score),
            Text(evaluation.verdict, style=styles[evaluation.verdict]),
        )
    console.print(table)
    for offer in result["offers"]:
        evaluation = result["evaluations"].get(offer.id)
        if evaluation is None:
            continue
        details = Text()
        for label, items in (
            ("Důvody", evaluation.fit_reasons),
            ("Mezery / rizika", evaluation.gap_analysis),
            ("Zvýraznit v CV", evaluation.tailored_cv_highlights),
        ):
            details.append(f"{label}\n", style="bold")
            for item in items:
                details.append(f"• {item}\n")
            if not items:
                details.append("• Žádné položky.\n")
        console.print(Panel(details, title=Text(offer.title), border_style=styles[evaluation.verdict]))
    if result["errors"]:
        for error in result["errors"]:
            console.print(Text(error, style="red"))
        return 1
    console.print(Text(f"Výsledky uloženy: {destination}", style="dim"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
