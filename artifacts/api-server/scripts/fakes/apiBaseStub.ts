/** Benchmark API base — prefers BENCH_API_BASE, else production. */
const override = process.env.BENCH_API_BASE?.trim();
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE =
  override ||
  (DOMAIN ? `https://${DOMAIN}/api` : "https://stadium-edge.onrender.com/api");
