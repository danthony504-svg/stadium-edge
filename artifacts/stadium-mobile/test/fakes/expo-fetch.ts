// Minimal fetch shim for node pipeline proofs (replaces expo/fetch).
export function fetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

export default fetch;
