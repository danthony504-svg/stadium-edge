BEGIN;
CREATE TABLE IF NOT EXISTS referral_accounts (
  user_id text PRIMARY KEY, code text NOT NULL UNIQUE, identity_hash text NOT NULL UNIQUE,
  joined_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referral_conversions (
  id bigserial PRIMARY KEY,
  referrer_id text NOT NULL REFERENCES referral_accounts(user_id) ON DELETE CASCADE,
  referred_user_id text UNIQUE REFERENCES referral_accounts(user_id) ON DELETE SET NULL,
  identity_hash text UNIQUE, retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_referral CHECK (referrer_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS referral_conversions_referrer ON referral_conversions(referrer_id);
CREATE TABLE IF NOT EXISTS referral_offer_codes (
  id bigserial PRIMARY KEY, milestone integer NOT NULL CHECK (milestone IN (3,10)),
  encrypted_code text NOT NULL, code_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  assigned_user_id text, assigned_at timestamptz
);
CREATE TABLE IF NOT EXISTS referral_rewards (
  user_id text NOT NULL REFERENCES referral_accounts(user_id) ON DELETE CASCADE,
  milestone integer NOT NULL CHECK (milestone IN (3,10)),
  offer_id bigint NOT NULL UNIQUE REFERENCES referral_offer_codes(id),
  awarded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,milestone)
);
COMMIT;
