/** Clerk bearer token bridge — kept out of api.ts so _layout does not import the full API module at boot. */

export type AuthTokenGetter = () => Promise<string | null>;

let authTokenGetter: AuthTokenGetter | null = null;

export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  authTokenGetter = getter;
}

export function getAuthTokenGetter(): AuthTokenGetter | null {
  return authTokenGetter;
}
