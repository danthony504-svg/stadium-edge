/** Shared API base URL — isolated so feed helpers avoid importing ./api.ts (circular). */
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";
