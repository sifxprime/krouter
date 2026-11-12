/**
 * Run the app's background bootstrap when the SERVER starts.
 *
 * It used to run only as a side effect of `app/layout.js`, which is evaluated
 * when a page is rendered. `/login` is prerendered (`○ /login` in the build,
 * `server/app/login.html` in the output), so it is served as static HTML without
 * evaluating the layout, and `/dashboard` is redirected by middleware before it
 * renders. On a boot where nobody is signed in, nothing ever rendered a dynamic
 * page — so initializeApp never ran, and with it none of:
 *
 *   - MITM auto-start (the reported symptom: capture never came back after a
 *     reboot, and the watchdog then stripped the DNS redirects it could not
 *     serve)
 *   - the connection watchdog and network monitor
 *   - tunnel / Tailscale auto-resume
 *   - the token warmer and background quota refresh
 *
 * All of it was waiting for someone to open the dashboard and log in. Measured
 * on the published 0.5.186: service up, `/login` 200, `/api/health` 200,
 * `/dashboard` 307 — and not one `[InitApp]` line in four minutes.
 *
 * `register()` is Next's own "the server is starting" hook, which is what this
 * work always needed. The layout keeps its import: bootstrap.js is guarded by
 * `global.__appBootstrapped`, so whichever path arrives first wins and the other
 * is a no-op, and dev HMR keeps behaving as before.
 */
export async function register() {
  // Also invoked for the edge runtime, which has no filesystem, no child
  // processes and no business starting a MITM server.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // bootstrap.js fires initializeApp without awaiting it and catches its own
  // errors, so this neither blocks the server from accepting requests nor can
  // take startup down.
  await import("@/shared/services/bootstrap");
}
