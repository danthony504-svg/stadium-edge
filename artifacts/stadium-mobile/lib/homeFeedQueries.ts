/**
 * Stale OTA bundles imported this path before oddsQuerySelectors existed.
 * Re-export the compat shim so mixed bundles never see undefined.getOddsSelector.
 */
export { default, getOddsSelector, oddsQuerySelectors } from "./oddsQuerySelectors";
