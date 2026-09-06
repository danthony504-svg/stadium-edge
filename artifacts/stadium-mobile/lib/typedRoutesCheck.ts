import type { Href } from "expo-router";

// Compile-time guard: generated Expo Router declarations must provide these
// public routes. This file has no runtime behavior.
const typedRoutes = [
  "/",
  "/coach",
  "/props",
  "/sign-in",
  { pathname: "/game/[id]", params: { id: "game-id" } },
  "/fantasy-team",
] satisfies Href[];

void typedRoutes;
