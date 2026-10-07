/**
 * Public legal / support HTML served by the API host (no sign-in).
 * Stadium Edge production currently serves Express at stadium-edge.onrender.com;
 * these pages are the Support URL Apple reviews.
 */

const SUPPORT_EMAIL = "support@stadiumedge.app";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(opts: { title: string; heading: string; bodyHtml: string }): string {
  const title = esc(opts.title);
  const heading = esc(opts.heading);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${title} — Stadium Edge" />
  <style>
    :root {
      --bg: #070b16;
      --card: #111827;
      --text: #e5eefb;
      --muted: #94a3b8;
      --accent: #22d3ee;
      --border: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(34, 211, 238, 0.12), transparent 55%),
        radial-gradient(900px 500px at 100% 0%, rgba(59, 130, 246, 0.10), transparent 50%),
        var(--bg);
      color: var(--text);
      line-height: 1.55;
      min-height: 100dvh;
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 20px 64px;
    }
    header {
      margin-bottom: 28px;
    }
    .brand {
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      margin: 0 0 10px;
    }
    h1 {
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      margin: 0 0 8px;
      line-height: 1.2;
    }
    .lede {
      color: var(--muted);
      margin: 0;
      font-size: 1rem;
    }
    section {
      margin-top: 28px;
      padding-top: 22px;
      border-top: 1px solid var(--border);
    }
    h2 {
      font-size: 1.1rem;
      margin: 0 0 10px;
    }
    p, li { color: var(--muted); font-size: 0.98rem; }
    ul { padding-left: 1.2rem; margin: 8px 0 0; }
    li { margin: 6px 0; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .email {
      display: inline-block;
      margin-top: 6px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
      color: var(--text);
      font-weight: 600;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 36px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
      font-size: 0.92rem;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="brand">Stadium Edge</p>
      <h1>${heading}</h1>
    </header>
    ${opts.bodyHtml}
    <nav>
      <a href="/support">Support</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Use</a>
    </nav>
  </main>
</body>
</html>`;
}

export function supportPageHtml(): string {
  const email = esc(SUPPORT_EMAIL);
  return layout({
    title: "Stadium Edge Support",
    heading: "Stadium Edge Support",
    bodyHtml: `
      <p class="lede">Questions, billing help, or account issues — we’re here to help.</p>
      <section>
        <h2>Contact support</h2>
        <p>Email us anytime. Include your Apple ID email (if different), device model, and a short description of the issue.</p>
        <a class="email" href="mailto:${email}">${email}</a>
        <p style="margin-top:12px">We typically respond within 1–2 business days.</p>
      </section>
      <section>
        <h2>How to contact support</h2>
        <ul>
          <li>Send an email to <a href="mailto:${email}">${email}</a></li>
          <li>Describe what you were trying to do and what you saw instead</li>
          <li>Attach a screenshot if it helps</li>
        </ul>
      </section>
      <section>
        <h2>Subscription and billing help</h2>
        <p>Stadium Edge Go ($9.99/week) and Stadium Edge Pro ($29.99/month) are billed as Apple In-App Purchases. Apple handles payment, receipts, and renewals.</p>
        <ul>
          <li>Subscribe from the in-app Plans screen</li>
          <li>Prices and any free trial (when offered) come from the App Store</li>
          <li>For billing disputes or refunds, use Apple’s Report a Problem tools</li>
        </ul>
      </section>
      <section>
        <h2>Restore purchases</h2>
        <ol>
          <li>Open Stadium Edge</li>
          <li>Go to <strong style="color:var(--text)">Plans</strong></li>
          <li>Tap <strong style="color:var(--text)">Restore purchases</strong></li>
          <li>Sign in with the same Apple ID used for the original purchase</li>
        </ol>
      </section>
      <section>
        <h2>Manage or cancel an Apple subscription</h2>
        <ul>
          <li>In the app: Plans → <strong style="color:var(--text)">Manage in Apple</strong></li>
          <li>Or on iPhone: Settings → [your name] → Subscriptions → Stadium Edge</li>
          <li>Or visit <a href="https://apps.apple.com/account/subscriptions" rel="noopener noreferrer">apps.apple.com/account/subscriptions</a></li>
        </ul>
        <p>Cancel anytime before the renewal date to avoid the next charge. Access continues through the end of the paid period.</p>
      </section>
      <section>
        <h2>Basic troubleshooting</h2>
        <ul>
          <li><strong style="color:var(--text)">Can’t sign in:</strong> Confirm email/password, check connectivity, then try again. Use Forgot password if needed.</li>
          <li><strong style="color:var(--text)">Purchases not unlocking:</strong> Use Restore purchases while signed into the correct Apple ID.</li>
          <li><strong style="color:var(--text)">App looks stuck:</strong> Force-quit and reopen; install the latest App Store update.</li>
          <li><strong style="color:var(--text)">Still stuck:</strong> Email ${email} with steps to reproduce.</li>
        </ul>
      </section>
      <section>
        <h2>Legal</h2>
        <p>
          <a href="/privacy">Privacy Policy</a>
          &nbsp;·&nbsp;
          <a href="/terms">Terms of Use</a>
        </p>
      </section>
    `,
  });
}

export function privacyPageHtml(): string {
  return layout({
    title: "Privacy Policy — Stadium Edge",
    heading: "Privacy Policy",
    bodyHtml: `
      <p class="lede">Last updated: October 7, 2026</p>
      <section>
        <h2>Overview</h2>
        <p>Stadium Edge (“we”, “us”) provides sports analytics and related tools. This policy explains what information we collect and how we use it.</p>
      </section>
      <section>
        <h2>Information we collect</h2>
        <ul>
          <li><strong style="color:var(--text)">Account data:</strong> email and authentication identifiers via our sign-in provider (Clerk).</li>
          <li><strong style="color:var(--text)">App usage:</strong> feature usage needed to operate sync, notifications, and subscriptions.</li>
          <li><strong style="color:var(--text)">Purchases:</strong> subscription status via Apple / RevenueCat. We do not receive your full payment card number.</li>
          <li><strong style="color:var(--text)">Device:</strong> push notification tokens when you enable alerts.</li>
        </ul>
      </section>
      <section>
        <h2>How we use information</h2>
        <ul>
          <li>Provide and improve the app</li>
          <li>Authenticate you and sync your data across devices</li>
          <li>Process subscription entitlements</li>
          <li>Respond to support requests</li>
        </ul>
      </section>
      <section>
        <h2>Sharing</h2>
        <p>We use service providers (authentication, hosting, analytics/subscription tooling) solely to operate the product. We do not sell personal information.</p>
      </section>
      <section>
        <h2>Retention &amp; deletion</h2>
        <p>You can delete your account from inside the app (Account → Delete account). Related server data is removed as part of that flow.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Privacy questions: <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>
      </section>
    `,
  });
}

export function termsPageHtml(): string {
  return layout({
    title: "Terms of Use — Stadium Edge",
    heading: "Terms of Use",
    bodyHtml: `
      <p class="lede">Last updated: October 7, 2026</p>
      <section>
        <h2>Acceptance</h2>
        <p>By using Stadium Edge you agree to these Terms. If you do not agree, do not use the app.</p>
      </section>
      <section>
        <h2>Eligibility</h2>
        <p>You must be 21+ (or the legal age for sports betting–related content where you live) to use Stadium Edge. Content is for informational / entertainment purposes only.</p>
      </section>
      <section>
        <h2>Subscriptions</h2>
        <p>Paid plans are auto-renewable Apple In-App Purchases. Payment is charged to your Apple ID. Manage or cancel in Apple Subscriptions settings. Prices shown in the app come from the App Store.</p>
      </section>
      <section>
        <h2>No gambling services</h2>
        <p>Stadium Edge does not accept wagers or process betting funds. Analysis is hypothetical and not a guarantee of outcomes.</p>
      </section>
      <section>
        <h2>Accounts</h2>
        <p>You are responsible for keeping your credentials secure and for activity under your account.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions: <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>
      </section>
    `,
  });
}

export const SUPPORT_CONTACT_EMAIL = SUPPORT_EMAIL;
