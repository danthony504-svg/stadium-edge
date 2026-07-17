/** Shared API base URL — isolated so feed helpers avoid importing ./api.ts (circular). */
import { publicDomain } from "./publicEnv";

const DOMAIN = publicDomain();
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";
