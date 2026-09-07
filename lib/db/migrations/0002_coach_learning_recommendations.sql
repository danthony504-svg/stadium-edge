-- Private, append-only Coach model-quality ledger. No user identifiers.
CREATE TABLE IF NOT EXISTS coach_learning_recommendations (
  id text PRIMARY KEY,
  identity text NOT NULL UNIQUE,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sport text, league text, provider_event_id text, game text NOT NULL, player text,
  market text NOT NULL, selection text NOT NULL, line text, odds text,
  confidence text, edge text, ai_grade text, simulation_probability text,
  source text NOT NULL, base_model_version text NOT NULL, inputs jsonb NOT NULL,
  correlation jsonb, status text NOT NULL DEFAULT 'pending',
  result_detail text, settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS coach_learning_pending_idx
  ON coach_learning_recommendations (status, created_at);
CREATE INDEX IF NOT EXISTS coach_learning_sport_market_idx
  ON coach_learning_recommendations (sport, market, status);
