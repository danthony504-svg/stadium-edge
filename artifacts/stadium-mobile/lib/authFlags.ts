/**
 * App Review ships in guest-access mode. Keep the authentication implementation
 * intact; flip this flag (or EXPO_PUBLIC_REQUIRE_AUTH_FOR_APP) to restore the
 * normal account-required flow after review.
 */
export const REQUIRE_AUTH_FOR_APP =
  process.env.EXPO_PUBLIC_REQUIRE_AUTH_FOR_APP === "true";

/** Keep OTA recovery active, but do not expose update/debug UI to reviewers. */
export const SHOW_OTA_UI_FOR_APP_REVIEW =
  process.env.EXPO_PUBLIC_SHOW_OTA_UI_FOR_APP_REVIEW === "true";
