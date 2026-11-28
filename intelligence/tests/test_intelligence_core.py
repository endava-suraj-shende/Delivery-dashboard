"""Unit tests for the intelligence package (pure functions; no app, no network).

Run from the repository root:  python -m pytest intelligence/tests -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from intelligence.anomalies import robust_z  # noqa: E402
from intelligence.features import FEATURE_NAMES  # noqa: E402
from intelligence.models import LogisticRiskModel, auc_score, heuristic_risk  # noqa: E402


def _synthetic(n: int = 400, seed: int = 7):
    """Tickets whose slip probability rises with age and days blocked - the model must recover that."""
    rng = np.random.default_rng(seed)
    X = np.zeros((n, len(FEATURE_NAMES)))
    ix = {f: i for i, f in enumerate(FEATURE_NAMES)}
    X[:, ix["age_days"]] = rng.gamma(2.0, 8.0, n)
    X[:, ix["days_blocked"]] = rng.exponential(2.0, n) * (rng.random(n) < 0.3)
    X[:, ix["activity_count"]] = rng.integers(1, 12, n)
    X[:, ix["sprint_count"]] = rng.integers(0, 3, n)
    X[:, ix["assignee_open_load"]] = rng.integers(1, 10, n)
    X[:, ix["has_due"]] = 1
    X[:, ix["days_to_due"]] = rng.normal(5, 6, n)
    X[:, ix["type_development"]] = 1
    logit = -2.0 + 0.06 * X[:, ix["age_days"]] + 0.35 * X[:, ix["days_blocked"]] - 0.08 * X[:, ix["days_to_due"]]
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    return X, y, ix


def test_logistic_model_learns_signal_and_explains():
    X, y, ix = _synthetic()
    m = LogisticRiskModel(FEATURE_NAMES)
    rep = m.fit(X, y)
    assert rep.trained and rep.samples == 400 and rep.auc is not None and rep.auc > 0.75
    top = {d["feature"] for d in rep.top_features[:4]}
    assert {"age_days", "days_blocked"} & top
    p = m.predict_proba(X)
    assert p.shape == (400,) and 0 <= p.min() and p.max() <= 1
    # a very old, long-blocked ticket must score higher than a fresh one
    old, fresh = X[:1].copy(), X[:1].copy()
    old[0, ix["age_days"]], old[0, ix["days_blocked"]] = 90, 20
    fresh[0, ix["age_days"]], fresh[0, ix["days_blocked"]] = 1, 0
    assert m.predict_proba(old)[0] > m.predict_proba(fresh)[0] + 0.3
    factors = m.explain(old)[0]
    assert factors and factors[0][0] in ("days_blocked", "age_days")


def test_model_refuses_to_train_on_too_little_data():
    m = LogisticRiskModel(FEATURE_NAMES)
    rep = m.fit(np.zeros((10, len(FEATURE_NAMES))), np.array([0] * 8 + [1] * 2))
    assert not rep.trained and "at least" in (rep.reason or "")
    assert m.predict_proba(np.zeros((3, len(FEATURE_NAMES)))).tolist() == [0.0, 0.0, 0.0]


def test_heuristic_and_auc():
    X = np.zeros((2, len(FEATURE_NAMES)))
    ix = {f: i for i, f in enumerate(FEATURE_NAMES)}
    X[1, ix["age_days"]], X[1, ix["days_blocked"]], X[1, ix["has_due"]], X[1, ix["days_to_due"]] = 60, 12, 1, -10
    h = heuristic_risk(X, FEATURE_NAMES)
    assert h[0] == 0 and h[1] > 0.6
    assert auc_score(np.array([0, 0, 1, 1]), np.array([0.1, 0.4, 0.35, 0.9])) == 0.75
    assert auc_score(np.array([1, 1]), np.array([0.2, 0.3])) is None


def test_robust_z_flags_a_collapse_but_not_noise():
    steady = np.array([10, 11, 9, 12, 10, 11, 10, 9, 11], dtype=float)
    assert robust_z(steady, 2) < -2.5          # throughput collapsed
    assert abs(robust_z(steady, 10)) < 1.0     # normal week
    assert robust_z(np.array([1, 2, 3]), 0) is None  # too little history
