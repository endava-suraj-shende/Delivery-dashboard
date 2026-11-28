# `intelligence/` — ML / AI layer

Root-level package (alongside `backend/` and `frontend/`) that adds machine learning and assistant features on top of
the backend's `AnalyticsEngine`. It is imported by the backend (`backend/app/__init__.py` puts the repository root on
`sys.path`) and copied into the Docker image.

```
features.py         point-in-time feature engineering (FEATURE_NAMES, build_features, build_training_set)
models.py           LogisticRiskModel (numpy, L2, class-weighted), auc_score, heuristic_risk
risk.py             RiskService: train per data version, score open tickets, explain, group by employee
anomalies.py        robust z-score (median/MAD) detection on weekly series
recommendations.py  focus / unblock / rebalance / due-soon / hygiene actions
assistant.py        question -> filter spec (rules or LLM) -> engine answer
llm.py              optional provider (azure_openai | openai_compatible); off by default
hub.py              IntelligenceHub wiring + narrative polish
tests/              unit tests (synthetic frames, no data files)
```

## Design rules

* **Grounded** — every number comes from the analytics engine the dashboards use; a language model may only
  *interpret* a question or *rephrase* a narrative, never compute a figure.
* **No leakage** — training examples are snapshots of completed tickets 3/7/14/21 days after first seen, built from
  activity rows reported on or before that cutoff; the label is the eventual outcome. Scoring uses today as the cutoff.
* **Explainable** — each score lists the standardised feature contributions; model metrics (AUC, Brier, accuracy) and
  weights are exposed on `/intelligence/status` and the Model tab.
* **Graceful** — fewer than 30 examples / 5 positives → transparent heuristic; LLM unavailable → rule parser.
* **Private** — only aggregate figures and dimension names are sent to an LLM unless `EDD_LLM_SEND_DETAILS=1`.

## Run

```bash
python -m pytest intelligence/tests -q          # from the repository root
cd backend && python -m pytest tests/test_api.py -q -k intelligence
```
