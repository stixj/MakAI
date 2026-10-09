"""Serial ingest -> filter -> deduplicate -> evaluate -> save."""

from collections.abc import Callable

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from .config import Settings, get_settings
from .evaluator import EvaluationError, evaluate_job, validate_evaluation
from .schemas import JobFitEvaluation, JobOffer, MakAIState
from .storage import EvaluationStore, create_store
from .turso import TursoEvaluationStore
from .utils.sources import enrich_offer

JobEvaluator = Callable[[JobOffer], JobFitEvaluation]


def ingest(state: MakAIState) -> MakAIState:
    offers: list[JobOffer] = []
    errors = list(state.get("errors", []))
    for index, value in enumerate(state.get("offers", [])):
        try:
            offers.append(JobOffer.model_validate(value))
        except ValidationError:
            errors.append(f"Ingest: neplatný inzerát na pozici {index}.")
    # Every invocation is a fresh batch; stale evaluations must not survive.
    return {"offers": offers, "evaluations": {}, "errors": errors,
            "skipped_duplicates": [], "saved_ids": [], "enriched_ids": [], "evaluation_blocked": None}


def filter_offers(state: MakAIState) -> MakAIState:
    seen: set[str] = set()
    offers: list[JobOffer] = []
    errors = list(state["errors"])
    for offer in state["offers"]:
        if offer.id in seen:
            errors.append(f"Filter: duplicitní id {offer.id!r}; ponechán první inzerát.")
            continue
        seen.add(offer.id)
        offers.append(offer)
    # Semantic no-go decisions belong to the evaluator, not keyword guesses.
    return {**state, "offers": offers, "errors": errors}


def build_graph(
    *, evaluator: JobEvaluator = evaluate_job,
    store: EvaluationStore | None = None,
    settings: Settings | None = None,
    duplicate_checker: Callable[[str], bool] | None = None,
) -> CompiledStateGraph[MakAIState, None, MakAIState, MakAIState]:
    """Inject adapters for offline tests without changing the production graph."""
    active_store = store if store is not None else create_store(settings or get_settings())
    check_duplicate = duplicate_checker

    def deduplicate(state: MakAIState) -> MakAIState:
        offers: list[JobOffer] = []
        identities: dict[str, int] = {}
        urls: dict[str, int] = {}
        skipped = list(state.get("skipped_duplicates", []))
        errors = list(state["errors"])
        enriched = list(state.get("enriched_ids", []))
        for offer in state["offers"]:
            url = str(offer.url)
            index = identities.get(offer.canonical_id, urls.get(url))
            if index is not None:
                offers[index] = enrich_offer(offers[index], offer)
                urls[url] = index
                skipped.append(url)
                continue
            try:
                if isinstance(active_store, TursoEvaluationStore):
                    if active_store.find_existing_job(offer) is not None:
                        active_store.upsert_or_enrich_job(offer)
                        enriched.append(offer.canonical_id)
                        skipped.append(url)
                        continue
                if check_duplicate is not None and check_duplicate(url):
                    skipped.append(url)
                    continue
            except Exception as exc:
                # A failed DB check must never trigger a speculative paid evaluation.
                errors.append(f"Deduplikace {offer.id!r}: {type(exc).__name__}; evaluace přeskočena.")
                continue
            identities[offer.canonical_id] = len(offers)
            urls[url] = len(offers)
            offers.append(offer)
        return {**state, "offers": offers, "skipped_duplicates": skipped,
                "enriched_ids": enriched, "errors": errors}

    def evaluate(state: MakAIState) -> MakAIState:
        evaluations = dict(state["evaluations"])
        errors = list(state["errors"])
        blocked = None
        for offer in state["offers"]:
            try:
                evaluations[offer.id] = validate_evaluation(evaluator(offer))
            except EvaluationError as exc:
                if exc.stop_batch:
                    blocked = {"kind": exc.kind, "message": str(exc),
                               "notEvaluated": len(state["offers"]) - len(evaluations)}
                    errors.append(str(exc))
                    break
                errors.append(f"Evaluate {offer.id!r}: {exc}")
            except Exception as exc:
                errors.append(f"Evaluate {offer.id!r}: {type(exc).__name__}.")
        return {**state, "evaluations": evaluations, "errors": errors, "evaluation_blocked": blocked}

    def save(state: MakAIState) -> MakAIState:
        if not state["evaluations"]:
            return state
        errors = list(state["errors"])
        saved_ids: list[str] = []
        if isinstance(active_store, TursoEvaluationStore):
            for offer in state["offers"]:
                evaluation = state["evaluations"].get(offer.id)
                if evaluation is None:
                    continue
                try:
                    active_store.save_evaluated_job(offer, evaluation)
                    saved_ids.append(offer.id)
                except Exception as exc:
                    errors.append(f"Save {offer.id!r}: {type(exc).__name__}; výsledky zůstaly ve stavu.")
            return {**state, "errors": errors, "saved_ids": saved_ids}
        try:
            active_store.save(state["offers"], state["evaluations"])
            saved_ids = list(state["evaluations"])
        except Exception as exc:
            errors.append(f"Save: {type(exc).__name__}; výsledky zůstaly ve stavu.")
        return {**state, "errors": errors, "saved_ids": saved_ids}

    builder = StateGraph(MakAIState)
    builder.add_node("ingest", ingest)
    builder.add_node("filter", filter_offers)
    builder.add_node("deduplicate", deduplicate)
    builder.add_node("evaluate", evaluate)
    builder.add_node("save", save)
    builder.add_edge(START, "ingest")
    builder.add_edge("ingest", "filter")
    builder.add_edge("filter", "deduplicate")
    builder.add_edge("deduplicate", "evaluate")
    builder.add_edge("evaluate", "save")
    builder.add_edge("save", END)
    return builder.compile()
