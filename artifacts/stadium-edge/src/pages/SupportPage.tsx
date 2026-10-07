const SUPPORT_EMAIL = "support@stadiumedge.app";

export default function SupportPage() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-cyan-400">
          Stadium Edge
        </p>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">Stadium Edge Support</h1>
        <p className="mb-8 text-slate-400">
          Questions, billing help, or account issues — we’re here to help.
        </p>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Contact support</h2>
          <p className="mb-3 text-slate-400">
            Email us anytime. Include your Apple ID email (if different), device model, and a short
            description of the issue.
          </p>
          <a
            className="inline-block rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 font-semibold text-slate-100"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            {SUPPORT_EMAIL}
          </a>
          <p className="mt-3 text-sm text-slate-500">We typically respond within 1–2 business days.</p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">How to contact support</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>
              Send an email to{" "}
              <a className="text-cyan-400" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li>Describe what you were trying to do and what you saw instead</li>
            <li>Attach a screenshot if it helps</li>
          </ul>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Subscription and billing help</h2>
          <p className="mb-3 text-slate-400">
            Stadium Edge Go ($9.99/week) and Stadium Edge Pro ($29.99/month) are billed as Apple
            In-App Purchases. Apple handles payment, receipts, and renewals.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>Subscribe from the in-app Plans screen</li>
            <li>Prices and any free trial (when offered) come from the App Store</li>
            <li>For billing disputes or refunds, use Apple’s Report a Problem tools</li>
          </ul>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Restore purchases</h2>
          <ol className="list-decimal space-y-2 pl-5 text-slate-400">
            <li>Open Stadium Edge</li>
            <li>
              Go to <span className="font-semibold text-slate-200">Plans</span>
            </li>
            <li>
              Tap <span className="font-semibold text-slate-200">Restore purchases</span>
            </li>
            <li>Sign in with the same Apple ID used for the original purchase</li>
          </ol>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Manage or cancel an Apple subscription</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>
              In the app: Plans →{" "}
              <span className="font-semibold text-slate-200">Manage in Apple</span>
            </li>
            <li>Or on iPhone: Settings → [your name] → Subscriptions → Stadium Edge</li>
            <li>
              Or visit{" "}
              <a
                className="text-cyan-400"
                href="https://apps.apple.com/account/subscriptions"
                rel="noopener noreferrer"
              >
                apps.apple.com/account/subscriptions
              </a>
            </li>
          </ul>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Basic troubleshooting</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>
              <span className="font-semibold text-slate-200">Can’t sign in:</span> Confirm
              email/password, check connectivity, then try again.
            </li>
            <li>
              <span className="font-semibold text-slate-200">Purchases not unlocking:</span> Use
              Restore purchases while signed into the correct Apple ID.
            </li>
            <li>
              <span className="font-semibold text-slate-200">App looks stuck:</span> Force-quit and
              reopen; install the latest App Store update.
            </li>
            <li>
              <span className="font-semibold text-slate-200">Still stuck:</span> Email {SUPPORT_EMAIL}
              .
            </li>
          </ul>
        </section>

        <nav className="flex flex-wrap gap-4 border-t border-slate-800 pt-5 text-sm">
          <a className="text-cyan-400" href="/support">
            Support
          </a>
          <a className="text-cyan-400" href="/privacy">
            Privacy Policy
          </a>
          <a className="text-cyan-400" href="/terms">
            Terms of Use
          </a>
        </nav>
      </div>
    </div>
  );
}
