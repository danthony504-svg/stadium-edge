import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import ParlayBuilder from "./ParlayBuilder";

// Login temporarily disabled. Flip to `true` to bring back the sign-in/sign-up
// pages (also flip AUTH_ENABLED in ParlayBuilder.tsx to show the entry buttons).
const AUTH_ENABLED = false;

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod. Do NOT gate on PROD.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#22d3ee",
    colorForeground: "#f1f5f9",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#fb7185",
    colorBackground: "#1e293b",
    colorInput: "#0f172a",
    colorInputForeground: "#f1f5f9",
    colorNeutral: "#334155",
    fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.85rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-slate-800 border border-slate-700 rounded-2xl w-[400px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-100",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-200",
    formFieldLabel: "text-slate-300",
    footerActionLink: "text-cyan-400 hover:text-cyan-300",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-cyan-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-slate-200",
    logoBox: "justify-center",
    logoImage: "h-8",
    socialButtonsBlockButton:
      "border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200",
    formButtonPrimary:
      "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold",
    formFieldInput: "bg-slate-900 border border-slate-700 text-slate-100",
    dividerLine: "bg-slate-700",
    alert: "bg-slate-900 border border-slate-700",
    otpCodeFieldInput: "bg-slate-900 border border-slate-700 text-slate-100",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={basePath || "/"}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={basePath || "/"}
      />
    </div>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to your Stadium Edge account",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Join Stadium Edge to track your slips",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Switch>
        <Route path="/" component={ParlayBuilder} />
        <Route
          path="/sign-in/*?"
          component={AUTH_ENABLED ? SignInPage : () => <Redirect to="/" />}
        />
        <Route
          path="/sign-up/*?"
          component={AUTH_ENABLED ? SignUpPage : () => <Redirect to="/" />}
        />
        <Route component={ParlayBuilder} />
      </Switch>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
