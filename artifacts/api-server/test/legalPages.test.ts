import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPPORT_CONTACT_EMAIL,
  privacyPageHtml,
  supportPageHtml,
  termsPageHtml,
} from "../src/lib/legalPages";

describe("legalPages", () => {
  it("support page includes required App Review content", () => {
    const html = supportPageHtml();
    assert.match(html, /Stadium Edge Support/);
    assert.match(html, new RegExp(SUPPORT_CONTACT_EMAIL.replace(".", "\\.")));
    assert.match(html, /Restore purchases/i);
    assert.match(html, /Manage or cancel an Apple subscription/i);
    assert.match(html, /Subscription and billing help/i);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /mailto:/);
  });

  it("privacy and terms pages render and link back to support", () => {
    assert.match(privacyPageHtml(), /Privacy Policy/);
    assert.match(termsPageHtml(), /Terms of Use/);
    assert.match(privacyPageHtml(), /href="\/support"/);
    assert.match(termsPageHtml(), /href="\/support"/);
  });
});
