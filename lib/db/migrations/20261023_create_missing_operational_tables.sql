-- Create-only schema repair matching lib/db/src/schema. No user rows change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('stadium-edge:operational-schema:20261023'));
CREATE TABLE IF NOT EXISTS public.subscription_events (
 id serial PRIMARY KEY, event_key text NOT NULL, user_id text,
 event_type text NOT NULL, payload text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_event_key_uidx
 ON public.subscription_events(event_key);
CREATE TABLE IF NOT EXISTS public.live_steals (
 id text PRIMARY KEY, sport text NOT NULL, game text NOT NULL,
 market text NOT NULL, pick text NOT NULL, player text, price integer NOT NULL,
 edge double precision, ev double precision, fair_prob double precision,
 starts_at timestamptz, status text NOT NULL DEFAULT 'pending',
 captured_at timestamptz NOT NULL DEFAULT now(), graded_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.referral_accounts (
 user_id text PRIMARY KEY, code text NOT NULL UNIQUE, identity_hash text NOT NULL UNIQUE,
 joined_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.referral_conversions (
 id bigserial PRIMARY KEY,
 referrer_id text NOT NULL REFERENCES public.referral_accounts(user_id) ON DELETE CASCADE,
 referred_user_id text UNIQUE REFERENCES public.referral_accounts(user_id) ON DELETE SET NULL,
 identity_hash text UNIQUE, retired_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT no_self_referral CHECK (referrer_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS referral_conversions_referrer ON public.referral_conversions(referrer_id);
CREATE TABLE IF NOT EXISTS public.referral_offer_codes (
 id bigserial PRIMARY KEY, milestone integer NOT NULL,
 encrypted_code text NOT NULL, code_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, assigned_user_id text, assigned_at timestamptz,
 CONSTRAINT referral_offer_codes_milestone_check CHECK (milestone IN (3,10))
);
CREATE TABLE IF NOT EXISTS public.referral_rewards (
 user_id text NOT NULL REFERENCES public.referral_accounts(user_id) ON DELETE CASCADE,
 milestone integer NOT NULL, offer_id bigint NOT NULL UNIQUE REFERENCES public.referral_offer_codes(id),
 awarded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, milestone),
 CONSTRAINT referral_rewards_milestone_check CHECK (milestone IN (3,10))
);
COMMIT;
