"""Intelligence layer: machine-learned risk scoring, statistical anomaly detection, recommendations and a
natural-language assistant - all grounded in the same AnalyticsEngine facts the dashboards show.

Design rules
* Deterministic by default: no network, no randomness, trained on the installation's own history on every data load.
* Explainable: every score comes with the factors that produced it; every answer cites the filter it used.
* Optional LLM: a provider can be configured for language tasks only (parsing questions, polishing text);
  numbers are always computed by the engine, never by the model.
"""
