-- PHASE 3 — Postgres policy plus an idempotent usage ledger.
--
-- Redis owns the hot decision. Postgres owns settled truth. For a hard
-- contractual quota that may never overshoot during total Redis loss, append a
-- durable reservation/event before acknowledging the protected operation.

CREATE TABLE plans (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  burst_capacity   INTEGER NOT NULL CHECK (burst_capacity > 0),
  refill_per_sec   NUMERIC NOT NULL CHECK (refill_per_sec > 0),
  monthly_quota    BIGINT CHECK (monthly_quota IS NULL OR monthly_quota > 0),
  overage_allowed  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE customers (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES plans(id),
  limit_override JSONB,
  suspended      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE usage_periods (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  period      TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  units       BIGINT NOT NULL DEFAULT 0 CHECK (units >= 0),
  requests    BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  rejected    BIGINT NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, period)
);

-- Every Redis processing batch has a UUID. This table makes replay after an
-- ambiguous commit harmless: the UUID can be inserted only once.
CREATE TABLE usage_flushes (
  flush_id     UUID PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  period      TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  units       BIGINT NOT NULL CHECK (units >= 0),
  requests    BIGINT NOT NULL CHECK (requests >= 0),
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- applyUsageBatch(flushId, customerId, period, delta) performs the following
-- transaction. Only a newly inserted flush ID may change the aggregate.
--
-- BEGIN;
--
-- WITH accepted AS (
--   INSERT INTO usage_flushes
--     (flush_id, customer_id, period, units, requests)
--   VALUES ($1, $2, $3, $4, $5)
--   ON CONFLICT (flush_id) DO NOTHING
--   RETURNING 1
-- )
-- INSERT INTO usage_periods (customer_id, period, units, requests)
-- SELECT $2, $3, $4, $5 FROM accepted
-- ON CONFLICT (customer_id, period) DO UPDATE
-- SET units      = usage_periods.units    + EXCLUDED.units,
--     requests   = usage_periods.requests + EXCLUDED.requests,
--     updated_at = now();
--
-- COMMIT;

-- Keep only sampled or policy-relevant decisions here. One row for every API
-- request is valid for an append-only billing event ledger, but not as a
-- synchronous aggregate update on the request path.
CREATE TABLE rate_limit_events (
  id          BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('allow','throttle','quota','shed')),
  cost        INTEGER NOT NULL CHECK (cost > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX usage_periods_by_period ON usage_periods (period);
CREATE INDEX rate_limit_events_by_customer_time
  ON rate_limit_events (customer_id, occurred_at DESC);
