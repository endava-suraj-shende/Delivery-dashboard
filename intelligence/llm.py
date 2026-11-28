"""Optional language-model provider. Off unless EDD_LLM_PROVIDER is set.

Used only for language tasks (turning a question into a filter spec, polishing a narrative). Numbers never come
from the model. Supports Azure OpenAI and any OpenAI-compatible chat endpoint; adding a provider = one method.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("intelligence.llm")


class LLMProvider:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    @property
    def enabled(self) -> bool:
        p = (self.s.llm_provider or "").lower()
        if p == "azure_openai":
            return bool(self.s.llm_endpoint and self.s.llm_api_key and self.s.llm_model)
        if p == "openai_compatible":
            return bool(self.s.llm_endpoint and self.s.llm_model)
        return False

    def info(self) -> Dict[str, Any]:
        return {"enabled": self.enabled, "provider": self.s.llm_provider or None, "model": self.s.llm_model or None,
                "sends_ticket_text": bool(self.s.llm_send_details)}

    def chat(self, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 600, temperature: float = 0.0) -> Optional[str]:
        """Single-turn completion. Returns None when disabled or on any failure (callers must have a fallback)."""
        if not self.enabled:
            return None
        p = (self.s.llm_provider or "").lower()
        body: Dict[str, Any] = {"messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                                "temperature": temperature, "max_tokens": max_tokens}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            if p == "azure_openai":
                url = f"{self.s.llm_endpoint.rstrip('/')}/openai/deployments/{self.s.llm_model}/chat/completions?api-version={self.s.llm_api_version}"
                headers = {"api-key": self.s.llm_api_key, "Content-Type": "application/json"}
            else:
                url = f"{self.s.llm_endpoint.rstrip('/')}/chat/completions"
                headers = {"Content-Type": "application/json"}
                if self.s.llm_api_key:
                    headers["Authorization"] = f"Bearer {self.s.llm_api_key}"
                body["model"] = self.s.llm_model
            r = httpx.post(url, json=body, headers=headers, timeout=self.s.llm_timeout_seconds)
            if r.status_code >= 400:
                log.warning("LLM call failed: %s %s", r.status_code, r.text[:200])
                return None
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:  # noqa: BLE001
            log.warning("LLM call error: %s", e)
            return None

    def chat_json(self, system: str, user: str, **kw: Any) -> Optional[Dict[str, Any]]:
        out = self.chat(system, user, json_mode=True, **kw)
        if not out:
            return None
        try:
            start, end = out.find("{"), out.rfind("}")
            return json.loads(out[start:end + 1]) if start >= 0 else None
        except json.JSONDecodeError:
            return None
