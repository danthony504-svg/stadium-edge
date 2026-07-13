/** Baked at publish time — bootstrap OTAs skip heavy startup and OTA gates. */
export const OTA_BOOTSTRAP = process.env.EXPO_PUBLIC_OTA_BOOTSTRAP === "true";
