"""Serial ingest -> filter -> evaluate -> save with isolated offer failures."""

from collections.abc import Callable

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from .config import Settings, get_settings
from .evaluator import EvaluationError, evaluate_job, validate_evaluation
from .schemas import JobFitEvaluation, JobOffer, MakAIState
from .storage import EvaluationStore, create_store

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
    return {"offers": offers, "evaluations": {}, "errors": errors}


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
) -> CompiledStateGraph[MakAIState, None, MakAIState, MakAIState]:
    """Inject adapters for offline tests without changing the production graph."""
    active_store = store if store is not None else create_store(settings or get_settings())

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
        try:
            active_store.save(state["offers"], state["evaluations"])
        except Exception as exc:
            errors.append(f"Save: {type(exc).__name__}; výsledky zůstaly ve stavu.")
        return {**state, "errors": errors}

    builder = StateGraph(MakAIState)
    builder.add_node("ingest", ingest)
    builder.add_node("filter", filter_offers)
    builder.add_node("evaluate", evaluate)
    builder.add_node("save", save)
    builder.add_edge(START, "ingest")
    builder.add_edge("ingest", "filter")
    builder.add_edge("filter", "evaluate")
    builder.add_edge("evaluate", "save")
    builder.add_edge("save", END)
    return builder.compile()
