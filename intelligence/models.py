"""Interpretable classifier: L2-regularised logistic regression on standardised features, fitted with full-batch
gradient descent in numpy. Deterministic, trains in milliseconds on thousands of rows, and each prediction can be
decomposed into per-feature contributions (coefficient x standardised value).

Swap-in point: anything exposing fit / predict_proba / explain with the same signatures (e.g. a gradient-boosted
model) can replace it without touching the API.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class ModelReport:
    samples: int
    positives: int
    auc: Optional[float]
    accuracy: Optional[float]
    brier: Optional[float]
    trained: bool
    reason: Optional[str] = None
    top_features: List[Dict[str, float]] = field(default_factory=list)


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def auc_score(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    """Rank-based AUC (Mann-Whitney) with average ranks for ties, vectorised (no sklearn needed)."""
    pos, neg = p[y == 1], p[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    vals = np.concatenate([pos, neg])
    order = np.argsort(vals, kind="mergesort")
    sorted_vals = vals[order]
    # group boundaries of equal values -> mean rank of each group
    boundaries = np.concatenate([[True], sorted_vals[1:] != sorted_vals[:-1]])
    group_id = np.cumsum(boundaries) - 1
    starts = np.flatnonzero(boundaries)
    ends = np.append(starts[1:], len(vals))
    mean_rank = (starts + 1 + ends) / 2.0  # ranks are 1-based: (first + last) / 2
    ranks = np.empty(len(vals), dtype=float)
    ranks[order] = mean_rank[group_id]
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


class LogisticRiskModel:
    MIN_SAMPLES = 30
    MIN_POSITIVES = 5

    def __init__(self, feature_names: List[str], l2: float = 1.0, epochs: int = 400, lr: float = 0.1) -> None:
        self.feature_names = feature_names
        self.l2, self.epochs, self.lr = l2, epochs, lr
        self.mu: Optional[np.ndarray] = None
        self.sigma: Optional[np.ndarray] = None
        self.w: Optional[np.ndarray] = None
        self.b: float = 0.0
        self.report = ModelReport(0, 0, None, None, None, False, "not trained")

    # ------------------------------------------------------------------ training
    def fit(self, X: np.ndarray, y: np.ndarray) -> ModelReport:
        n = int(len(y))
        pos = int(y.sum()) if n else 0
        if n < self.MIN_SAMPLES or pos < self.MIN_POSITIVES or pos > n - self.MIN_POSITIVES:
            self.w = None
            self.report = ModelReport(n, pos, None, None, None, False,
                                      f"need at least {self.MIN_SAMPLES} completed tickets with {self.MIN_POSITIVES}+ of each outcome (have {n} / {pos} slipped)")
            return self.report
        self.mu = X.mean(axis=0)
        self.sigma = X.std(axis=0)
        self.sigma[self.sigma == 0] = 1.0
        Z = (X - self.mu) / self.sigma
        w = np.zeros(Z.shape[1])
        b = float(np.log((pos + 1) / (n - pos + 1)))  # start at the base rate
        # class weights so a rare "slipped" class is not ignored
        wpos, wneg = n / (2.0 * pos), n / (2.0 * (n - pos))
        sw = np.where(y == 1, wpos, wneg)
        for _ in range(self.epochs):
            p = _sigmoid(Z @ w + b)
            g = (sw * (p - y))
            grad_w = Z.T @ g / n + self.l2 * w / n
            grad_b = g.mean()
            w -= self.lr * grad_w
            b -= self.lr * grad_b
        self.w, self.b = w, b
        p = _sigmoid(Z @ w + b)
        auc = auc_score(y, p)
        acc = float(((p >= 0.5).astype(int) == y).mean())
        brier = float(np.mean((p - y) ** 2))
        top = sorted(({"feature": f, "weight": float(c)} for f, c in zip(self.feature_names, w)), key=lambda d: -abs(d["weight"]))[:8]
        self.report = ModelReport(n, pos, auc, acc, brier, True, None, top)
        return self.report

    # ------------------------------------------------------------------ inference
    @property
    def trained(self) -> bool:
        return self.w is not None

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if not self.trained or len(X) == 0:
            return np.zeros(len(X))
        Z = (X - self.mu) / self.sigma
        return _sigmoid(Z @ self.w + self.b)

    def explain(self, X: np.ndarray, top: int = 3) -> List[List[Tuple[str, float]]]:
        """Per row: the `top` features pushing the probability up (positive contribution), as (name, contribution)."""
        if not self.trained or len(X) == 0:
            return [[] for _ in range(len(X))]
        Z = (X - self.mu) / self.sigma
        contrib = Z * self.w  # shape (n, f)
        out: List[List[Tuple[str, float]]] = []
        for row in contrib:
            idx = np.argsort(-row)[:top]
            out.append([(self.feature_names[i], float(row[i])) for i in idx if row[i] > 0.05])
        return out


def heuristic_risk(X: np.ndarray, feature_names: List[str]) -> np.ndarray:
    """Fallback when there is not enough history to train: a transparent weighted score in [0, 1]."""
    if len(X) == 0:
        return np.zeros(0)
    ix = {n: i for i, n in enumerate(feature_names)}
    age = np.clip(X[:, ix["age_days"]] / 45.0, 0, 1)
    blocked = np.clip(X[:, ix["days_blocked"]] / 10.0, 0, 1)
    carry = np.clip(X[:, ix["sprint_count"]] / 3.0, 0, 1)
    overdue = np.clip(-X[:, ix["days_to_due"]] / 14.0, 0, 1) * X[:, ix["has_due"]]
    load = np.clip(X[:, ix["assignee_open_load"]] / 12.0, 0, 1)
    churn = np.clip((X[:, ix["status_changes"]] - 2) / 4.0, 0, 1) + 0.3 * X[:, ix["reopened"]]
    score = 0.25 * age + 0.25 * blocked + 0.15 * carry + 0.2 * overdue + 0.1 * load + 0.05 * np.clip(churn, 0, 1)
    return np.clip(score, 0, 1)
