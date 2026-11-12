"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";

// The mark, at the two sizes the system defines. Full = chevron + echo, for
// anywhere with room. The echo and the chevron share a slope (88/100) on
// purpose: before 0.5.181 they did not, which is why the pair read as two
// unrelated shapes instead of one trailing the other.
function Mark({ size = 38 }) {
  return (
    <svg viewBox="0 0 400 400" width={size} height={size} role="img" aria-label="kRouter">
      <g fill="none" stroke="var(--color-brand-500)" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="97.8,118 170,200 97.8,282" strokeWidth="24" strokeOpacity="0.32" />
        <polyline points="174,100 262,200 174,300" strokeWidth="54" />
      </g>
    </svg>
  );
}

// Six paths collapsing into one point: what the product does, drawn rather
// than described. Structural lines, not a gradient wash — it has to stay quiet
// behind the headline at every width.
function ConvergeMotif() {
  return (
    <svg
      viewBox="0 0 700 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <g fill="none" stroke="var(--color-brand-500)" strokeWidth="1.25" strokeOpacity="0.26">
        <path d="M-40 120 C 240 120, 300 450, 620 450" />
        <path d="M-40 238 C 240 238, 310 450, 620 450" />
        <path d="M-40 356 C 250 356, 330 450, 620 450" />
        <path d="M-40 544 C 250 544, 330 450, 620 450" />
        <path d="M-40 662 C 240 662, 310 450, 620 450" />
        <path d="M-40 780 C 240 780, 300 450, 620 450" />
      </g>
      <g fill="var(--color-brand-500)" fillOpacity="0.5">
        <circle cx="-40" cy="120" r="2.5" /><circle cx="-40" cy="238" r="2.5" />
        <circle cx="-40" cy="356" r="2.5" /><circle cx="-40" cy="544" r="2.5" />
        <circle cx="-40" cy="662" r="2.5" /><circle cx="-40" cy="780" r="2.5" />
      </g>
      <circle cx="620" cy="450" r="5" fill="var(--color-brand-500)" fillOpacity="0.85" />
      <circle cx="620" cy="450" r="16" fill="none" stroke="var(--color-brand-500)" strokeOpacity="0.3" />
    </svg>
  );
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  // Shown on the brand panel. Only facts we can actually read: the origin we
  // were served from and the version the server reports. Nothing invented —
  // a login screen that states numbers it cannot verify is worse than one
  // that states none.
  const [version, setVersion] = useState("");
  const router = useRouter();

  // The host we were served from. useSyncExternalStore rather than an effect:
  // it reads a browser-only value with an explicit server snapshot, so there is
  // no hydration mismatch and no setState during an effect (which the
  // react-hooks/set-state-in-effect rule rejects, and which would cost a second
  // render pass on every load).
  const origin = useSyncExternalStore(
    () => () => {},                              // location.host never changes here
    () => window.location.host,                  // client
    () => ""                                     // server
  );

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    // /api/version is unauthenticated by design (the CLI's port-identity probe
    // relies on that), so it is safe to read before login.
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);
    fetch("/api/version", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.currentVersion) setVersion(d.currentVersion); })
      .catch(() => { /* the panel simply omits the line */ })
      .finally(() => clearTimeout(id));
    return () => { clearTimeout(id); controller.abort(); };
  }, []);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // No mustChangePassword branch here: the API only sets that flag alongside a
        // 403, so it can never arrive on the ok path. See the note above the warning
        // text below for what actually happens on a default-password remote login.
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-wrap bg-bg">

      {/* Brand panel. flex-wrap + a 560px basis rather than a breakpoint, so it
          stacks on a phone without a media query and never becomes a 100vh
          column that pushes the form off-screen. */}
      <div className="relative flex min-w-0 flex-[1_1_560px] flex-col justify-between overflow-hidden border-b border-border bg-bg-alt px-8 py-10 sm:px-16 sm:py-14 lg:border-b-0 lg:border-r">
        <ConvergeMotif />

        <div className="relative flex items-center gap-3.5">
          <Mark size={38} />
          <div
            className="text-[27px] font-bold tracking-[-0.025em]"
            style={{ fontFamily: "var(--font-space-grotesk), var(--font-display)" }}
          >
            <span className="text-brand-500">k</span>
            <span className="text-text-main">Router</span>
          </div>
        </div>

        <div className="relative my-10 max-w-[500px] lg:my-0">
          <h1
            className="m-0 text-[clamp(2.2rem,1.4rem+2.6vw,3.25rem)] font-bold leading-[1.08] tracking-[-0.035em] text-text-main"
            style={{ fontFamily: "var(--font-space-grotesk), var(--font-display)" }}
          >
            One endpoint.
            <br />
            <span className="text-brand-600 dark:text-brand-500">Every provider.</span>
          </h1>
          <p className="mt-5 max-w-[430px] text-base leading-[1.65] text-text-muted">
            Your router is already running on this machine. Unlock the dashboard to
            route models, watch spend and capture your IDEs.
          </p>
        </div>

        <div className="relative flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="size-[7px] shrink-0 rounded-full bg-green-600 shadow-[0_0_0_3px_rgba(22,163,74,0.16)] dark:bg-green-400 dark:shadow-[0_0_0_3px_rgba(74,222,128,0.16)]"
              aria-hidden="true"
            />
            <span className="text-[13px] font-medium text-text-main">Server running</span>
            {origin && <span className="font-mono text-[13px] text-text-muted">{origin}</span>}
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-1.5 text-xs text-text-subtle">
            {version && (
              <div>
                <span className="font-semibold text-text-main">v{version}</span>&nbsp; current
              </div>
            )}
            <div>
              <span className="font-semibold text-text-main">95+</span>&nbsp; providers
            </div>
            <div>
              <span className="font-semibold text-text-main">Local</span>&nbsp; only
            </div>
          </div>
        </div>
      </div>

      {/* The actual job. Both panels grow equally so the brand side keeps the
          weight it was designed with; a 999 grow here would pin it to its
          560px basis and leave the statement cramped on a wide screen. */}
      <div className="flex min-w-0 flex-[1_1_420px] items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <h2
            className="m-0 text-[25px] font-semibold tracking-[-0.02em] text-text-main"
            style={{ fontFamily: "var(--font-space-grotesk), var(--font-display)" }}
          >
            Unlock dashboard
          </h2>
          <p className="mb-8 mt-2 text-sm leading-relaxed text-text-muted">
            {authMode === "oidc" && oidcConfigured
              ? "Sign in with your OIDC provider to continue."
              : "This stays on your machine. Nothing is sent anywhere."}
          </p>

          <div className="flex flex-col gap-4">
            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {oidcAvailable && passwordAvailable && (
              <div className="my-1 flex items-center gap-3.5" aria-hidden="true">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] tracking-[0.08em] text-text-subtle">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {((authMode === "oidc" && !oidcConfigured) || (authMode === "both" && !oidcConfigured)) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    OIDC login is enabled, but the issuer/client fields are not configured yet. Password login is still available for recovery.
                  </p>
                )}

                {authMode === "both" && oidcConfigured && (
                  <p className="text-xs text-text-muted">
                    Password and OIDC login are both enabled.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <label htmlFor="krouter-password" className="text-[13px] font-medium text-text-main">
                    Password
                  </label>
                  <Input
                    id="krouter-password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    autoFocus={!oidcAvailable}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && (
                    <p className="text-xs text-text-muted">
                      Forgot password? Open <code className="rounded bg-sidebar px-1">krouter</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Unlock"}
                </Button>

                {hasPassword === false && (
                  <>
                    <p className="mt-1 text-xs text-text-muted">
                      No password set yet: use the <code className="rounded bg-sidebar px-1">INITIAL_PASSWORD</code> kRouter
                      was started with, or the default <code className="rounded bg-sidebar px-1">123456</code> on the
                      machine kRouter runs on.
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Security risk: no password set. Remote logins are refused until you set one — sign in, then set
                      it under Settings → Security.
                    </p>
                  </>
                )}
              </form>
            ) : (
              error && <p className="text-xs text-red-500">{error}</p>
            )}
          </div>

          <div className="mt-8 border-t border-border pt-5">
            <p className="m-0 text-[12.5px] leading-[1.7] text-text-subtle">
              Forgot it? Run <code className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-main">krouter</code> on
              this machine and choose <span className="text-text-muted">Terminal UI › Settings › Reset password</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
