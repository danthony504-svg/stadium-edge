#!/usr/bin/env bash
# OTA scope policy — what may ship via OTA vs what requires a new native build.
set -euo pipefail

cat <<'EOF'
════════════════════════════════════════════════════════════
 STADIUM EDGE — OTA RELEASE POLICY
════════════════════════════════════════════════════════════

OTA is allowed ONLY for:
  • UI layout and styling changes
  • Copy / text updates
  • Small JavaScript bug fixes with no boot-path changes

OTA is NOT allowed for (requires new TestFlight → App Store build):
  • Startup, _layout, RootLayout, splash, or boot sequence
  • Authentication (Clerk), sign-in, session, or token bootstrap
  • Navigation structure, routing, or deep links
  • runtimeVersion or appVersion policy changes
  • Expo Updates configuration (channels, ON_LOAD, checkAutomatically)
  • Native dependencies (package.json native modules)
  • Expo plugins or app.json native configuration
  • React Native architecture (newArch, Hermes flags)
  • Native APIs (notifications, biometrics, permissions)
  • Environment variable changes baked at build time

Release order (mandatory):
  1. EAS development build → verify on physical iPhone
  2. Fix crashes; confirm Home, Coach, Props, Steals, auth, navigation
  3. EAS TestFlight build (preview / preview-ota) with new runtime + OTA config
  4. Verify TestFlight on device BEFORE enabling OTA publishes
  5. Only then: preview OTA test → staged production OTA promotion

While .ota-production-freeze exists: NO production OTA operations.
EOF
