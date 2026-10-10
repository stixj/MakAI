"""Serial ingestion followed by one-offer evaluation/persistence steps."""

from collections.abc import Callable
import logging

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from .hunt_filters import filter_promising_offers
from .profile import CandidateProfile, MASTER_PROFILE
from .config import Settings, get_settings
from .evaluator import EvaluationError, evaluate_job, validate_evaluation
from .schemas import JobFitEvaluation, JobOffer, MakAIState, MakAIStateUpdate
from .storage import EvaluationStore, JsonEvaluationStore, create_store
from .turso import TursoEvaluationStore
from .utils.sources import enrich_offer

JobEvaluator = Callable[[JobOffer], JobFitEvaluation]
logger = logging.getLogger(__name__)


def ingest(state: MakAIState) -> MakAIStateUpdate:
    offers: list[JobOffer] = []
    errors = list(state.get("errors", []))
    for index, value in enumerate(state.get("offers", [])):
        try:
            offers.append(JobOffer.model_validate(value))
        except ValidationError:
            errors.append(f"Ingest: neplatný inzerát na pozici {index}.")
    # Every invocation is a fresh batch; stale evaluations must not survive.
    return {"offers": offers, "evaluations": {}, "errors": errors,
            "skipped_duplicates": [], "saved_ids": [], "enriched_ids": [], "evaluation_blocked": None,
            "skipped_by_prefilter": [], "evaluation_index": 0, "evaluation_limit_reached": False}


def filter_offers(state: MakAIState, profile: CandidateProfile = MASTER_PROFILE,
                  store: EvaluationStore | None = None) -> MakAIStateUpdate:
    seen: set[str] = set()
    offers: list[JobOffer] = []
    errors = list(state["errors"])
    for offer in state["offers"]:
        if offer.id in seen:
            errors.append(f"Filter: duplicitní id {offer.id!r}; ponechán první inzerát.")
            continue
        seen.add(offer.id)
        offers.append(offer)
    promising, rejected = filter_promising_offers(offers, profile)
    if rejected:
        logger.info("Předfiltr vyřadil %d nabídek podle lokality nebo názvu pozice.", len(rejected))
        mark_filtered = getattr(store, "mark_filtered_jobs", None)
        if mark_filtered is not None:
            try:
                mark_filtered([item["offer"] for item in rejected])
            except Exception as exc:
                errors.append(f"Prefilter checkpoint: {type(exc).__name__}.")
    return {"offers": promising, "errors": errors, "skipped_by_prefilter": rejected}


def build_graph(
    *, evaluator: JobEvaluator = evaluate_job,
    store: EvaluationStore | None = None,
    settings: Settings | None = None,
    duplicate_checker: Callable[[str], bool] | None = None,
    max_evaluations: int | None = None,
    profile: CandidateProfile | None = None,
) -> CompiledStateGraph[MakAIState, None, MakAIState, MakAIState]:
    """Inject adapters for offline tests without changing the production graph."""
    active_store = store if store is not None else create_store(settings or get_settings())
    active_profile = profile or MASTER_PROFILE
    check_duplicate = duplicate_checker
    if max_evaluations is not None and (type(max_evaluations) is not int or not 1 <= max_evaluations <= 100):
        raise ValueError("Limit AI hodnocení musí být 1–100.")

    def deduplicate(state: MakAIState) -> MakAIStateUpdate:
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
                discover = getattr(active_store, "discover_job", None)
                if discover is not None:
                    discover(offer)
            except Exception as exc:
                # A failed DB check must never trigger a speculative paid evaluation.
                errors.append(f"Deduplikace {offer.id!r}: {type(exc).__name__}; evaluace přeskočena.")
                continue
            identities[offer.canonical_id] = len(offers)
            urls[url] = len(offers)
            offers.append(offer)
        return {"offers": offers, "skipped_duplicates": skipped,
                "enriched_ids": enriched, "errors": errors}

    def evaluate(state: MakAIState) -> MakAIStateUpdate:
        index = state["evaluation_index"]
        offer = state["offers"][index]
        evaluations = dict(state["evaluations"])
        errors = list(state["errors"])
        blocked = None
        try:
            evaluations[offer.id] = validate_evaluation(evaluator(offer))
        except EvaluationError as exc:
            if exc.stop_batch:
                blocked = {"kind": exc.kind, "message": str(exc),
                           "notEvaluated": len(state["offers"]) - len(evaluations)}
                errors.append(str(exc))
            else:
                errors.append(f"Evaluate {offer.id!r}: {exc}")
        except Exception as exc:
            errors.append(f"Evaluate {offer.id!r}: {type(exc).__name__}.")
        return {"evaluations": evaluations, "errors": errors, "evaluation_blocked": blocked,
                "evaluation_index": index + 1,
                "evaluation_limit_reached": max_evaluations is not None and len(state["offers"]) > max_evaluations}

    def save(state: MakAIState) -> MakAIStateUpdate:
        offer = state["offers"][state["evaluation_index"] - 1]
        evaluation = state["evaluations"].get(offer.id)
        if evaluation is None:
            return {}
        errors = list(state["errors"])
        saved_ids = list(state["saved_ids"])
        try:
            if isinstance(active_store, JsonEvaluationStore):
                # Atomic replacement alone would discard preceding microbatches.
                active_store.save([offer], {offer.id: evaluation}, merge_existing=True)
            elif isinstance(active_store, TursoEvaluationStore):
                active_store.save_evaluated_job(offer, evaluation)
            else:
                active_store.save([offer], {offer.id: evaluation})
            saved_ids.append(offer.id)
        except Exception as exc:
            errors.append(f"Save: {type(exc).__name__}; výsledky zůstaly ve stavu.")
        return {"errors": errors, "saved_ids": saved_ids}

    def next_offer(state: MakAIState) -> str:
        index = state["evaluation_index"]
        if (state.get("evaluation_blocked") is not None
                or index >= len(state["offers"])
                or (max_evaluations is not None and index >= max_evaluations)):
            return END
        return "evaluate"

    builder = StateGraph(MakAIState)
    builder.add_node("ingest", ingest)
    builder.add_node("filter", lambda state: filter_offers(state, active_profile, active_store))
    builder.add_node("deduplicate", deduplicate)
    builder.add_node("evaluate", evaluate)
    builder.add_node("save", save)
    builder.add_edge(START, "ingest")
    builder.add_edge("ingest", "filter")
    builder.add_edge("filter", "deduplicate")
    builder.add_conditional_edges("deduplicate", next_offer, ["evaluate", END])
    builder.add_edge("evaluate", "save")
    builder.add_conditional_edges("save", next_offer, ["evaluate", END])
    # Each offer now consumes two supersteps; the default 25 is too small
    # even for a normal portal batch. Callers may override this safety limit.
    return builder.compile().with_config({"recursion_limit": 10_000})
