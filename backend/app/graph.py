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
            "skipped_duplicates": [], "saved_ids": []}


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
    if check_duplicate is None and isinstance(active_store, TursoEvaluationStore):
        check_duplicate = active_store.is_job_duplicate

    def deduplicate(state: MakAIState) -> MakAIState:
        offers: list[JobOffer] = []
        seen_urls: set[str] = set()
        skipped = list(state.get("skipped_duplicates", []))
        errors = list(state["errors"])
        for offer in state["offers"]:
            url = str(offer.url)
            if url in seen_urls:
                skipped.append(url)
                continue
            seen_urls.add(url)
            try:
                if check_duplicate is not None and check_duplicate(url):
                    skipped.append(url)
                    continue
            except Exception as exc:
                # A failed DB check must never trigger a speculative paid evaluation.
                errors.append(f"Deduplikace {offer.id!r}: {type(exc).__name__}; evaluace přeskočena.")
                continue
            offers.append(offer)
        return {**state, "offers": offers, "skipped_duplicates": skipped, "errors": errors}

    def evaluate(state: MakAIState) -> MakAIState:
        evaluations = dict(state["evaluations"])
        errors = list(state["errors"])
        for offer in state["offers"]:
            try:
                evaluations[offer.id] = validate_evaluation(evaluator(offer))
            except EvaluationError as exc:
                errors.append(f"Evaluate {offer.id!r}: {exc}")
            except Exception as exc:
                errors.append(f"Evaluate {offer.id!r}: {type(exc).__name__}.")
        return {**state, "evaluations": evaluations, "errors": errors}

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
