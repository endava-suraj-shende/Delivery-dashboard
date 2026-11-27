"""Configurable normalization of free-text Excel statuses into reporting categories.

Four independent dimensions are normalized separately (never merged):
  * work_status      – Jira / work status (Completed, In Progress, Blocked ...)
  * work_type        – activity type (Development, Analysis, Testing ...)
  * dev_deployment   – development deployment status
  * prod_deployment  – production deployment status
  * prod_required    – "Production Deployment Required?" / In-Production flag

Unknown values are never silently classified; they map to ``other`` and are
collected so they can be reviewed and mapped from the UI.
"""
from __future__ import annotations

import json
import threading
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from app.utils.text import clean_text, normalize_key

UNMAPPED = "other"

# category -> (label, color token, order)
CATEGORY_META: Dict[str, Dict[str, Dict[str, Any]]] = {
    "work_status": {
        "completed": {"label": "Completed", "color": "green", "order": 1, "terminal": True},
        "deployed": {"label": "Deployed", "color": "green", "order": 2, "terminal": True},
        "in_progress": {"label": "In Progress", "color": "blue", "order": 3},
        "development": {"label": "Development", "color": "blue", "order": 4},
        "code_review": {"label": "Code Review", "color": "blue", "order": 5},
        "testing": {"label": "Testing", "color": "blue", "order": 6},
        "ready_for_qa": {"label": "Ready for QA", "color": "blue", "order": 7},
        "ready_for_deployment": {"label": "Ready for Deployment", "color": "blue", "order": 8},
        "analysis": {"label": "Analysis", "color": "purple", "order": 9},
        "pending": {"label": "Pending", "color": "orange", "order": 10},
        "on_hold": {"label": "On Hold", "color": "amber", "order": 11},
        "reopened": {"label": "Reopened", "color": "pink", "order": 12},
        "blocked": {"label": "Blocked", "color": "red", "order": 13},
        "cancelled": {"label": "Cancelled / Rejected", "color": "grey", "order": 14, "terminal": True},
        "other": {"label": "Other / Unmapped", "color": "grey", "order": 99},
    },
    "work_type": {
        "development": {"label": "Development", "color": "blue", "order": 1},
        "analysis": {"label": "Analysis", "color": "orange", "order": 2},
        "testing": {"label": "Testing", "color": "purple", "order": 3},
        "deployment": {"label": "Deployment", "color": "green", "order": 4},
        "bug_fix": {"label": "Bug Fix", "color": "red", "order": 5},
        "documentation": {"label": "Documentation", "color": "teal", "order": 6},
        "support": {"label": "Support", "color": "cyan", "order": 7},
        "review": {"label": "Review", "color": "indigo", "order": 8},
        "other": {"label": "Other / Unmapped", "color": "grey", "order": 99},
    },
    "dev_deployment": {
        "deployed": {"label": "Deployed", "color": "green", "order": 1},
        "in_progress": {"label": "In Progress", "color": "blue", "order": 2},
        "pending": {"label": "Pending", "color": "orange", "order": 3},
        "blocked": {"label": "Blocked", "color": "red", "order": 4},
        "failed": {"label": "Failed", "color": "red", "order": 5},
        "not_required": {"label": "Not Required", "color": "grey", "order": 6},
        "other": {"label": "Unknown / Unmapped", "color": "grey", "order": 99},
    },
    "prod_deployment": {
        "released": {"label": "Released", "color": "green", "order": 1},
        "in_progress": {"label": "In Progress", "color": "blue", "order": 2},
        "pending": {"label": "Pending", "color": "orange", "order": 3},
        "blocked": {"label": "Blocked", "color": "red", "order": 4},
        "failed": {"label": "Failed", "color": "red", "order": 5},
        "not_released": {"label": "Not Yet Released", "color": "orange", "order": 6},
        "not_required": {"label": "Not Required", "color": "grey", "order": 7},
        "other": {"label": "Unknown / Unmapped", "color": "grey", "order": 99},
    },
    "prod_required": {
        "yes": {"label": "Yes", "color": "blue", "order": 1},
        "no": {"label": "No", "color": "grey", "order": 2},
        "not_required": {"label": "Not Applicable", "color": "grey", "order": 3},
        "other": {"label": "Unknown", "color": "grey", "order": 99},
    },
}
# Jira-status driven deployment dimensions share the deployment categories.
CATEGORY_META["jira_dev_deployment"] = CATEGORY_META["dev_deployment"]
CATEGORY_META["jira_prod_deployment"] = CATEGORY_META["prod_deployment"]

DEFAULT_MAPPINGS: Dict[str, Dict[str, List[str]]] = {
    "work_status": {
        "completed": ["completed", "complete", "done", "closed", "finished", "resolved", "delivered", "qa verified",
                      "stage verified", "accepted"],
        "deployed": ["deployed", "released", "live", "in production", "in prod"],
        "in_progress": ["in progress", "inprogress", "wip", "ongoing", "started", "working", "in development"],
        "development": ["development", "dev", "in dev", "development qa testing"],
        "code_review": ["code review", "in review", "review", "pr raised", "peer review", "design review"],
        "testing": ["testing", "in testing", "qa", "in qa", "uat", "in stage", "stage"],
        "ready_for_qa": ["ready for qa", "ready for testing", "ready for test", "qa design review ready"],
        "ready_for_deployment": ["ready for deployment", "ready for release", "ready to deploy", "ready for prod",
                                 "release launch"],
        "analysis": ["analysis", "in analysis", "analysing", "analyzing", "investigation", "requirements design"],
        "pending": ["pending", "to do", "todo", "not started", "open", "new", "backlog", "yet to start",
                    "ready for development", "selected for development"],
        "on_hold": ["on hold", "onhold", "hold", "paused", "parked", "deferred"],
        "reopened": ["reopened", "re opened", "reopen"],
        "blocked": ["blocked", "blocker", "impediment", "stuck", "waiting", "dependency"],
        "cancelled": ["rejected", "cancelled", "canceled", "duplicate", "invalid", "won t do", "wont do", "obsolete",
                      "withdrawn", "declined"],
    },
    "work_type": {
        "development": ["development", "dev", "coding", "implementation", "feature", "enhancement", "report development",
                        "onboarding development", "configuration", "migration", "story", "improvement", "sub task",
                        "subtask", "task", "ux ui story", "product features", "new feature"],
        "analysis": ["analysis", "investigation", "bug investigation", "research", "spike", "design", "poc", "requirement",
                     "area"],
        "testing": ["testing", "qa", "test", "validation", "uat", "verification", "qa story", "qa task", "test case"],
        "deployment": ["deployment", "release", "deploy", "devops", "infra", "infrastructure"],
        "bug_fix": ["bug fix", "bugfix", "bug", "defect", "fix", "hotfix", "data fix", "incident"],
        "documentation": ["documentation", "docs", "document", "kt", "knowledge transfer"],
        "support": ["support", "maintenance", "operations", "ops", "monitoring", "access", "service request"],
        "review": ["review", "code review"],
        "other": ["other", "others", "misc", "miscellaneous", "general", "epic", "initiative"],
    },
    "dev_deployment": {
        "deployed": ["deployed", "done", "completed", "complete", "deployed to dev", "deployed to qa", "yes", "success", "successful"],
        "in_progress": ["in progress", "inprogress", "deploying", "ongoing"],
        "pending": ["pending", "not deployed", "to be deployed", "scheduled", "planned", "waiting", "not yet"],
        "blocked": ["blocked", "on hold", "hold"],
        "failed": ["failed", "failure", "error", "rolled back", "rollback"],
        "not_required": ["not applicable", "na", "n a", "not required", "no", "none", "nil"],
    },
    "prod_deployment": {
        "released": ["deployed", "released", "done", "completed", "complete", "live", "success", "successful", "yes"],
        "in_progress": ["in progress", "inprogress", "deploying", "releasing", "ongoing"],
        "pending": ["pending", "scheduled", "planned", "waiting", "awaiting approval", "approval pending"],
        "blocked": ["blocked", "on hold", "hold"],
        "failed": ["failed", "failure", "error", "rolled back", "rollback"],
        "not_released": ["not released", "not yet released", "not deployed", "not yet", "to be released"],
        "not_required": ["not applicable", "na", "n a", "not required", "no", "none", "nil"],
    },
    "prod_required": {
        "yes": ["yes", "y", "true", "required"],
        "no": ["no", "n", "false", "not required"],
        "not_required": ["not applicable", "na", "n a", "none", "nil"],
    },
    # Jira status -> has the work reached a development/test environment?
    "jira_dev_deployment": {
        "deployed": ["in dev", "in qa", "in stage", "qa verified", "stage verified", "in prod", "done", "accepted",
                     "ready for qa", "ready for deployment", "alpha beta pilot", "release launch"],
        "in_progress": ["in progress", "code review", "in review", "development qa testing", "design review"],
        "pending": ["backlog", "open", "to do", "new", "ready for development", "selected for development",
                    "requirements design", "reopened"],
        "blocked": ["blocked", "on hold"],
        "not_required": ["rejected", "cancelled", "canceled", "duplicate", "invalid", "won t do", "wont do"],
    },
    # Jira status -> production release position (fixVersion release flag is applied first when present)
    "jira_prod_deployment": {
        "released": ["in prod", "in production", "released", "live", "deployed to prod"],
        "in_progress": ["in stage", "stage verified", "release launch", "ready for deployment", "alpha beta pilot"],
        "not_released": ["in dev", "in qa", "in progress", "code review", "in review", "backlog", "open", "to do",
                         "ready for development", "ready for qa", "qa verified", "development qa testing", "reopened"],
        "blocked": ["blocked", "on hold"],
        "not_required": ["rejected", "cancelled", "canceled", "duplicate", "invalid", "won t do", "wont do"],
    },
}

# Rules for deciding the representative status of a ticket seen in several reports.
LATEST_STATUS_RULES = {
    "latest_report": "Status from the most recent report (by report date) wins",
    "most_advanced": "The most advanced status in the lifecycle wins (Completed > Testing > In Progress > Analysis > Pending > Blocked)",
}
STATUS_RANK = {
    "completed": 100, "deployed": 100, "cancelled": 95,
    "ready_for_deployment": 80, "ready_for_qa": 75, "testing": 70, "code_review": 65,
    "in_progress": 60, "development": 60, "reopened": 55,
    "analysis": 40, "pending": 30, "on_hold": 20, "blocked": 10, "other": 0,
}

REMAINING_CATEGORIES = {"in_progress", "development", "code_review", "testing", "ready_for_qa",
                        "ready_for_deployment", "analysis", "pending", "on_hold", "reopened", "blocked"}


@dataclass
class NormalizationResult:
    category: str
    label: str
    original: Optional[str]
    mapped: bool


@dataclass
class StatusConfig:
    mappings: Dict[str, Dict[str, List[str]]] = field(default_factory=lambda: deepcopy(DEFAULT_MAPPINGS))
    latest_status_rule: str = "latest_report"
    count_blank_status_as: str = "other"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mappings": self.mappings,
            "latest_status_rule": self.latest_status_rule,
            "count_blank_status_as": self.count_blank_status_as,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StatusConfig":
        cfg = cls()
        mappings = data.get("mappings") or {}
        for dim, cats in mappings.items():
            if dim in CATEGORY_META and isinstance(cats, dict):
                cfg.mappings[dim] = {
                    cat: [str(v) for v in vals] for cat, vals in cats.items() if cat in CATEGORY_META[dim]
                }
        rule = data.get("latest_status_rule")
        if rule in LATEST_STATUS_RULES:
            cfg.latest_status_rule = rule
        blank = data.get("count_blank_status_as")
        if blank in CATEGORY_META["work_status"]:
            cfg.count_blank_status_as = blank
        return cfg


class StatusNormalizer:
    """Thread-safe normalizer backed by a JSON config file."""

    def __init__(self, config_path: Optional[Path] = None, store: Any = None) -> None:
        from app.db.repos import FileJsonStore
        self._store = store or (FileJsonStore(config_path) if config_path else None)
        self._lock = threading.RLock()
        self._config = StatusConfig()
        self._index: Dict[str, Dict[str, str]] = {}
        self._unmapped: Dict[str, Dict[str, int]] = {dim: {} for dim in CATEGORY_META}
        self._load()
        self._rebuild_index()

    # ---- persistence -----------------------------------------------------
    def _load(self) -> None:
        data = self._store.read() if self._store else None
        if data:
            try:
                self._config = StatusConfig.from_dict(data)
                self._merge_new_defaults()
            except Exception:
                self._config = StatusConfig()

    def _merge_new_defaults(self) -> None:
        """Add default synonyms introduced in newer versions unless the value is already mapped somewhere."""
        changed = False
        for dim, cats in DEFAULT_MAPPINGS.items():
            saved = self._config.mappings.setdefault(dim, {})
            present = {normalize_key(v) for vals in saved.values() for v in vals}
            for cat, values in cats.items():
                for v in values:
                    if normalize_key(v) not in present:
                        saved.setdefault(cat, []).append(v)
                        present.add(normalize_key(v))
                        changed = True
        if changed:
            self.save()

    def save(self) -> None:
        if self._store:
            self._store.write(self._config.to_dict())

    def _rebuild_index(self) -> None:
        self._index = {}
        for dim, cats in self._config.mappings.items():
            idx: Dict[str, str] = {}
            for cat, values in cats.items():
                for v in values:
                    idx[normalize_key(v)] = cat
            self._index[dim] = idx

    # ---- config access ---------------------------------------------------
    @property
    def config(self) -> StatusConfig:
        return self._config

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return {
                **self._config.to_dict(),
                "categories": CATEGORY_META,
                "latest_status_rules": LATEST_STATUS_RULES,
                "unmapped": {dim: dict(vals) for dim, vals in self._unmapped.items()},
            }

    def update_config(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            merged = self._config.to_dict()
            if "mappings" in data and isinstance(data["mappings"], dict):
                for dim, cats in data["mappings"].items():
                    if dim in merged["mappings"] and isinstance(cats, dict):
                        merged["mappings"][dim] = cats
            for key in ("latest_status_rule", "count_blank_status_as"):
                if key in data:
                    merged[key] = data[key]
            self._config = StatusConfig.from_dict(merged)
            self._rebuild_index()
            self.save()
            return self.get_config()

    def add_mapping(self, dimension: str, category: str, value: str) -> Dict[str, Any]:
        with self._lock:
            if dimension not in CATEGORY_META or category not in CATEGORY_META[dimension]:
                raise ValueError("Unknown dimension or category")
            cats = self._config.mappings.setdefault(dimension, {})
            # remove the value from any other category first
            for cat, values in cats.items():
                cats[cat] = [v for v in values if normalize_key(v) != normalize_key(value)]
            if category != UNMAPPED:
                cats.setdefault(category, []).append(value)
            key = normalize_key(value)
            bucket = self._unmapped[dimension]
            for existing in [v for v in bucket if normalize_key(v) == key]:
                bucket.pop(existing, None)
            self._rebuild_index()
            self.save()
            return self.get_config()

    def reset(self) -> Dict[str, Any]:
        with self._lock:
            self._config = StatusConfig()
            self._rebuild_index()
            self.save()
            return self.get_config()

    def reset_unmapped(self) -> None:
        with self._lock:
            self._unmapped = {dim: {} for dim in CATEGORY_META}

    # ---- normalization ---------------------------------------------------
    def normalize(self, dimension: str, value: Any, *, track: bool = True) -> NormalizationResult:
        original = clean_text(value)
        meta = CATEGORY_META[dimension]
        if original is None:
            cat = self._config.count_blank_status_as if dimension == "work_status" else UNMAPPED
            return NormalizationResult(cat, meta[cat]["label"], None, False)
        key = normalize_key(original)
        idx = self._index.get(dimension, {})
        cat = idx.get(key)
        if cat is None:
            # try token containment for compound values e.g. "Completed - deployed to QA"
            for mapped_key, mapped_cat in sorted(idx.items(), key=lambda kv: -len(kv[0])):
                if len(mapped_key) >= 4 and mapped_key in key:
                    cat = mapped_cat
                    break
        if cat is None:
            if track:
                with self._lock:
                    bucket = self._unmapped[dimension]
                    bucket[original] = bucket.get(original, 0) + 1
            return NormalizationResult(UNMAPPED, meta[UNMAPPED]["label"], original, False)
        return NormalizationResult(cat, meta[cat]["label"], original, True)

    def label(self, dimension: str, category: str) -> str:
        return CATEGORY_META[dimension].get(category, CATEGORY_META[dimension][UNMAPPED])["label"]

    def categories(self, dimension: str) -> List[str]:
        meta = CATEGORY_META[dimension]
        return sorted(meta.keys(), key=lambda c: meta[c]["order"])

    def is_remaining(self, category: str) -> bool:
        return category in REMAINING_CATEGORIES

    def unmapped_values(self) -> Dict[str, Dict[str, int]]:
        with self._lock:
            return {dim: dict(vals) for dim, vals in self._unmapped.items()}

    def all_known_values(self, dimension: str) -> Set[str]:
        return set(self._index.get(dimension, {}).keys())
