// Run every five minutes from the isolated test backend's external scheduler.
// Server-side: works while phones are closed. Never ships an OTA or simulates tickets.
const target = process.env.COACH_TEST_API_URL;
const key = process.env.COACH_TEST_PREBUILD_KEY;
if (!target || !key) throw new Error("Set COACH_TEST_API_URL and COACH_TEST_PREBUILD_KEY for an isolated test backend.");
const url = new URL(target);
const local = ["localhost", "127.0.0.1"].includes(url.hostname);
if (url.username || url.password || (url.protocol !== "https:" && !local)) {
  throw new Error("Use an HTTPS test backend URL (HTTP is allowed only for localhost).");
}
if (["stadium-edge.onrender.com", "stadium-edge.replit.app"].includes(url.hostname.toLowerCase())) {
  throw new Error("Refusing to warm the production backend from the test runner.");
}
url.pathname = process.env.COACH_CONTEXT_ONLY === "1" ? "/api/prebuild/context" : "/api/prebuild/cron";
url.search = "";
url.hash = "";
const response = await fetch(url, {
  method: "POST",
  headers: { "x-cron-key": key },
  signal: AbortSignal.timeout(240_000),
});
if (!response.ok) throw new Error(`Test warmup failed: HTTP ${response.status}`);
console.log(JSON.stringify(await response.json()));
