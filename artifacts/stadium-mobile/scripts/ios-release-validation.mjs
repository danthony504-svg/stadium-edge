/** Pure release checks; never include credential values in diagnostics. */
export function isIosRevenueCatKey(value) {
  return /^appl_[A-Za-z0-9]+$/.test(String(value || "")) && value.length >= 8;
}

export function hasNativeWebCredentials(aasa, bundleId) {
  const apps = aasa?.webcredentials?.apps;
  return Array.isArray(apps) && apps.some(app =>
    typeof app === "string" && /^[A-Z0-9]{10}$/.test(app.split(".")[0]) &&
    app.slice(11) === bundleId);
}
