/**
 * Shared API base URL — isolated so feed helpers avoid importing ./api.ts (circular).
 * COACH_API_BASE is an absolute override for an isolated staging process
 * (`http://127.0.0.1:8099/api`). Production and preview builds leave it unset.
 */
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const STAGING_BASE = process.env.COACH_API_BASE?.trim();
export const API_BASE = STAGING_BASE
  ? STAGING_BASE.replace(/\/$/, "")
  : DOMAIN
    ? `https://${DOMAIN}/api`
    : "/api";
