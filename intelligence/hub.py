"""Facade wiring the intelligence services for one workspace (real or demo)."""
from __future__ import annotations

from typing import Any, Dict

from intelligence.anomalies import AnomalyService
from intelligence.assistant import Assistant
from intelligence.llm import LLMProvider
from intelligence.recommendations import RecommendationService
from intelligence.risk import RiskService


class IntelligenceHub:
    """One object per workspace. Everything is lazy and cached on the engine's data version."""

    def __init__(self, settings: Any, engine: Any, narrative: Any, forecast: Any) -> None:
        self.settings = settings
        self.engine = engine
        self.llm = LLMProvider(settings)
        self.risk = RiskService(engine)
        self.anomalies = AnomalyService(engine)
        self.recommendations = RecommendationService(engine, self.risk)
        self.assistant = Assistant(engine, self.llm, {"narrative": narrative, "forecast": forecast, "risk": self.risk,
                                                      "anomalies": self.anomalies, "recommendations": self.recommendations})
        self.narrative = narrative

    def status(self) -> Dict[str, Any]:
        return {"model": self.risk.ensure_trained(), "llm": self.llm.info(),
                "capabilities": ["risk", "anomalies", "recommendations", "assistant", "narrative_polish" if self.llm.enabled else "narrative_rules"]}

    def polish_narrative(self, narrative: Dict[str, Any]) -> Dict[str, Any]:
        """Optional LLM rewrite of the rule-based paragraphs into one fluent client-ready paragraph. Facts are passed
        explicitly and the model is told not to add numbers; falls back to the original text."""
        if not self.llm.enabled:
            return {**narrative, "polished": None}
        facts = narrative.get("facts", {})
        system = ("You rewrite delivery status notes for a client-facing weekly update. Use ONLY the facts and sentences given; do not add, "
                  "estimate or round numbers; keep every number exactly as given; British English; one concise paragraph of 3-5 sentences; "
                  "neutral professional tone; no bullet points; no headings.")
        user = "Facts: " + str(facts) + "\nSentences:\n" + "\n".join(p["text"] for p in narrative["paragraphs"])
        out = self.llm.chat(system, user, max_tokens=350, temperature=0.2)
        return {**narrative, "polished": out.strip() if out else None}
