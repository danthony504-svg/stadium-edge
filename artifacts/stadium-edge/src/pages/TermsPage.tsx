const SUPPORT_EMAIL = "support@stadiumedge.app";

export default function TermsPage() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-cyan-400">
          Stadium Edge
        </p>
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Terms of Use</h1>
        <p className="mb-8 text-slate-400">Last updated: October 7, 2026</p>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Acceptance</h2>
          <p className="text-slate-400">
            By using Stadium Edge you agree to these Terms. If you do not agree, do not use the app.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Eligibility</h2>
          <p className="text-slate-400">
            You must be 21+ (or the legal age for sports betting–related content where you live) to
            use Stadium Edge. Content is for informational / entertainment purposes only.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Subscriptions</h2>
          <p className="text-slate-400">
            Paid plans are auto-renewable Apple In-App Purchases. Payment is charged to your Apple
            ID. Manage or cancel in Apple Subscriptions settings. Prices shown in the app come from
            the App Store.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">No gambling services</h2>
          <p className="text-slate-400">
            Stadium Edge does not accept wagers or process betting funds. Analysis is hypothetical
            and not a guarantee of outcomes.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Accounts</h2>
          <p className="text-slate-400">
            You are responsible for keeping your credentials secure and for activity under your
            account.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Contact</h2>
          <p className="text-slate-400">
            Questions:{" "}
            <a className="text-cyan-400" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
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
