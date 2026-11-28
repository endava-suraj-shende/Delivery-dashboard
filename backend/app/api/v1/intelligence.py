"""Intelligence endpoints: ML risk scoring, anomaly detection, recommendations, natural-language assistant."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.auth_deps import viewers
from app.api.deps import filters, loaded_container
from app.services.container import Container
from app.services.filter_service import Filters

router = APIRouter(prefix="/intelligence", tags=["Intelligence"], dependencies=[Depends(viewers)])


class Question(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)


@router.get("/status")
def status(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Model training state and metrics, LLM configuration, capabilities."""
    return c.intelligence.status()


@router.get("/risk")
def risk(f: Filters = Depends(filters), c: Container = Depends(loaded_container), limit: int = Query(50, ge=1, le=500)) -> Dict[str, Any]:
    """Open tickets ranked by predicted probability of slipping, with the factors behind each score."""
    return c.intelligence.risk.score(f, limit)


@router.get("/anomalies")
def anomalies(f: Filters = Depends(filters), c: Container = Depends(loaded_container),
              group_by: str = Query("employee", pattern="^(employee|jira_board)$")) -> Dict[str, Any]:
    """Weekly series that moved unusually versus their own recent history (robust z-scores)."""
    return c.intelligence.anomalies.detect(f, group_by)


@router.get("/recommendations")
def recommendations(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Reviewable actions derived from risk and load: focus list, escalations, rebalancing, due-date risks, hygiene."""
    return c.intelligence.recommendations.recommend(f)


@router.post("/ask")
def ask(body: Question, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Natural-language question -> filter spec -> engine-computed answer (the current page filters are the baseline)."""
    return c.intelligence.assistant.ask(body.question, f)


@router.get("/narrative")
def narrative(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Rule-based narrative plus, when a language model is configured, a polished client-ready paragraph."""
    return c.intelligence.polish_narrative(c.narrative.summary(c.analytics.resolve_filters(f)))


@router.post("/retrain")
def retrain(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.intelligence.risk._trained_version = None
    return c.intelligence.risk.ensure_trained()
