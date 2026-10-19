import type { pool as databasePool } from "@workspace/db";
type Pool = typeof databasePool;
import {
  decryptOffer,
  legacyReferralCode,
  newReferralCode,
  redemptionUrl,
  REFERRAL_MILESTONES,
} from "./referralPolicy.js";

export class ReferralError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
// Pool is injected so this transaction path can be exercised against an isolated DB.
export function referralStore(pool: Pool) {
  return {
    async account(userId: string, hash: string, joinedAt: Date) {
      await pool.query(
        `INSERT INTO referral_accounts(user_id,code,identity_hash,joined_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          userId,
          legacyReferralCode(userId) ?? newReferralCode(),
          hash,
          joinedAt,
        ],
      );
      const present = await pool.query(
        `SELECT 1 FROM referral_accounts WHERE user_id=$1`,
        [userId],
      );
      if (!present.rowCount)
        await pool.query(
          `INSERT INTO referral_accounts(user_id,code,identity_hash,joined_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`,
          [userId, newReferralCode(), hash, joinedAt],
        );
      const { rows } = await pool.query(
        `SELECT * FROM referral_accounts WHERE user_id=$1`,
        [userId],
      );
      return rows[0];
    },
    async status(userId: string) {
      const count = await pool.query(
        `SELECT count(*)::int AS n FROM referral_conversions WHERE referrer_id=$1`,
        [userId],
      );
      const claims = await pool.query(
        `SELECT milestone FROM referral_rewards WHERE user_id=$1`,
        [userId],
      );
      return {
        verifiedFriends: count.rows[0].n as number,
        milestones: REFERRAL_MILESTONES.map((m) => ({
          ...m,
          claimed: claims.rows.some((r) => r.milestone === m.count),
        })),
      };
    },
    async convert(userId: string, hash: string, code: string, joinedAt: Date) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const referrer = await c.query(
          `SELECT user_id,identity_hash,joined_at FROM referral_accounts WHERE code=$1`,
          [code],
        );
        const owner = referrer.rows[0];
        if (!owner)
          throw new ReferralError(
            404,
            "Invite code not found. Ask your friend for their latest link.",
          );
        if (owner.user_id === userId || owner.identity_hash === hash)
          throw new ReferralError(400, "You cannot refer yourself.");
        if (new Date(owner.joined_at).getTime() >= joinedAt.getTime())
          throw new ReferralError(
            400,
            "The inviter must have joined before you.",
          );
        // Delete only retired anti-abuse fingerprints after their 90-day retention period.
        await c.query(
          `UPDATE referral_conversions SET identity_hash=NULL WHERE retired_at < now()-interval '90 days'`,
        );
        const inserted = await c.query(
          `INSERT INTO referral_conversions(referrer_id,referred_user_id,identity_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
          [owner.user_id, userId, hash],
        );
        if (!inserted.rowCount) {
          const existing = await c.query(
            `SELECT referrer_id FROM referral_conversions WHERE referred_user_id=$1`,
            [userId],
          );
          if (existing.rows[0]?.referrer_id !== owner.user_id)
            throw new ReferralError(
              409,
              "This account or verified email has already used an invite.",
            );
        }
        await c.query("COMMIT");
        return { accepted: true, alreadyApplied: !inserted.rowCount };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    async claim(userId: string, milestone: number) {
      if (!REFERRAL_MILESTONES.some((m) => m.count === milestone))
        throw new ReferralError(400, "Invalid reward milestone.");
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        // Serialize claims per inviter across processes, and lock inventory across all users.
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          userId,
        ]);
        const existing = await c.query(
          `SELECT o.encrypted_code,o.expires_at FROM referral_rewards r JOIN referral_offer_codes o ON o.id=r.offer_id WHERE r.user_id=$1 AND r.milestone=$2`,
          [userId, milestone],
        );
        let offer = existing.rows[0];
        if (!offer) {
          const count = await c.query(
            `SELECT count(*)::int AS n FROM referral_conversions WHERE referrer_id=$1`,
            [userId],
          );
          if (count.rows[0].n < milestone)
            throw new ReferralError(409, "Not enough verified friends yet.");
          const available = await c.query(
            `SELECT id,encrypted_code,expires_at FROM referral_offer_codes WHERE milestone=$1 AND assigned_at IS NULL AND expires_at>now()+interval '1 day' ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
            [milestone],
          );
          offer = available.rows[0];
          if (!offer)
            throw new ReferralError(
              503,
              "Your reward is earned. Redemption codes are temporarily unavailable; try again later.",
            );
          await c.query(
            `UPDATE referral_offer_codes SET assigned_user_id=$1,assigned_at=now() WHERE id=$2`,
            [userId, offer.id],
          );
          await c.query(
            `INSERT INTO referral_rewards(user_id,milestone,offer_id) VALUES($1,$2,$3)`,
            [userId, milestone, offer.id],
          );
        }
        if (new Date(offer.expires_at).getTime() <= Date.now())
          throw new ReferralError(
            410,
            "This Apple offer code expired. Contact support for a replacement.",
          );
        const url = redemptionUrl(decryptOffer(offer.encrypted_code));
        await c.query("COMMIT");
        return {
          redemptionUrl: url,
          expiresAt: new Date(offer.expires_at).toISOString(),
        };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    async removeAccount(userId: string) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          userId,
        ]);
        await c.query(
          `UPDATE referral_conversions SET retired_at=now() WHERE referred_user_id=$1`,
          [userId],
        );
        // Do not recycle an Apple code that may already have been redeemed.
        await c.query(
          `UPDATE referral_offer_codes SET assigned_user_id=NULL WHERE assigned_user_id=$1`,
          [userId],
        );
        await c.query(`DELETE FROM referral_accounts WHERE user_id=$1`, [
          userId,
        ]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
