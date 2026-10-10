/**
 * Regression for production crash fp_a3422557:
 * "Rendered fewer hooks than expected. This may be caused by an accidental early return statement."
 *
 * AccountScreen used to call useState(copied) AFTER `if (!isSignedIn) return <Redirect …/>`.
 * Signing out (or any isSignedIn flip) then ran fewer hooks on the next render.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("AccountScreen declares all useState hooks before the !isSignedIn early return", () => {
  const src = readFileSync(join(process.cwd(), "app/account.tsx"), "utf8");

  const earlyReturnIdx = src.indexOf('if (!isSignedIn) return <Redirect href="/sign-in" />');
  assert.ok(earlyReturnIdx > 0, "expected signed-out Redirect early return");

  const copiedHookIdx = src.indexOf("const [copied, setCopied] = React.useState(false)");
  assert.ok(copiedHookIdx > 0, "expected copied useState");
  assert.ok(
    copiedHookIdx < earlyReturnIdx,
    "copied useState must run before !isSignedIn early return (hook-order crash)",
  );

  // No useState / useEffect / useMemo / useCallback / useRef after the Redirect.
  const after = src.slice(earlyReturnIdx);
  assert.equal(
    /\bReact\.use(State|Effect|Memo|Callback|Ref)\s*\(/.test(after),
    false,
    "no React hooks allowed after !isSignedIn early return",
  );
  assert.equal(
    /\buse(State|Effect|Memo|Callback|Ref)\s*\(/.test(after),
    false,
    "no hooks allowed after !isSignedIn early return",
  );
});

test("AccountScreen still redirects unsigned users to sign-in", () => {
  const src = readFileSync(join(process.cwd(), "app/account.tsx"), "utf8");
  assert.match(src, /if\s*\(\s*!isSignedIn\s*\)\s*return\s*<Redirect\s+href="\/sign-in"\s*\/>/);
});
