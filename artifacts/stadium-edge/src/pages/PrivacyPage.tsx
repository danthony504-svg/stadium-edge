const SUPPORT_EMAIL = "support@stadiumedge.app";

export default function PrivacyPage() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-cyan-400">
          Stadium Edge
        </p>
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mb-8 text-slate-400">Last updated: October 7, 2026</p>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Overview</h2>
          <p className="text-slate-400">
            Stadium Edge (“we”, “us”) provides sports analytics and related tools. This policy
            explains what information we collect and how we use it.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>
              <span className="font-semibold text-slate-200">Account data:</span> email and
              authentication identifiers via our sign-in provider (Clerk).
            </li>
            <li>
              <span className="font-semibold text-slate-200">App usage:</span> feature usage needed
              to operate sync, notifications, and subscriptions.
            </li>
            <li>
              <span className="font-semibold text-slate-200">Purchases:</span> subscription status
              via Apple / RevenueCat. We do not receive your full payment card number.
            </li>
            <li>
              <span className="font-semibold text-slate-200">Device:</span> push notification tokens
              when you enable alerts.
            </li>
          </ul>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">How we use information</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>Provide and improve the app</li>
            <li>Authenticate you and sync your data across devices</li>
            <li>Process subscription entitlements</li>
            <li>Respond to support requests</li>
          </ul>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Sharing</h2>
          <p className="text-slate-400">
            We use service providers (authentication, hosting, analytics/subscription tooling)
            solely to operate the product. We do not sell personal information.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Retention &amp; deletion</h2>
          <p className="text-slate-400">
            You can delete your account from inside the app (Account → Delete account). Related
            server data is removed as part of that flow.
          </p>
        </section>

        <section className="mb-8 border-t border-slate-800 pt-6">
          <h2 className="mb-2 text-lg font-semibold">Contact</h2>
          <p className="text-slate-400">
            Privacy questions:{" "}
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
