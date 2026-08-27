import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { enableTunnel } from "@/lib/tunnel";

const DNS_WARMUP_DELAY_MS = 8000;

/**
 * The dashboard blocks tunnel activation in React when login is off or the password is
 * still the default ("Change the default dashboard password before activating the
 * tunnel"), but that interlock lived only in the component. A user sitting in the
 * `krouter` CLI picking Settings -> Enable Tunnel, or anything issuing a plain POST,
 * got a public Cloudflare URL with none of it applied. Same condition, enforced where
 * it actually binds. Returns a reason string when the tunnel must not be started.
 */
async function tunnelSecurityBlock() {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    // Cannot prove the dashboard is safe, so do not expose it publicly.
    return "Could not read settings to verify dashboard security — refusing to expose the tunnel.";
  }
  if (settings?.requireLogin === false) {
    return 'Enable "Require login" and set a custom password before activating the tunnel.';
  }
  if (!settings?.password) {
    return "Change the default dashboard password before activating the tunnel.";
  }
  return null;
}

export async function POST() {
  try {
    const blocked = await tunnelSecurityBlock();
    if (blocked) {
      return NextResponse.json({ error: `Security required: ${blocked}` }, { status: 403 });
    }

    const result = await enableTunnel();
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
