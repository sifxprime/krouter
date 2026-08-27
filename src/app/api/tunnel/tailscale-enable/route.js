import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { enableTailscale } from "@/lib/tunnel";

/**
 * Same interlock as /api/tunnel/enable — see the note there. Exposing the dashboard on
 * a Tailscale funnel while it still answers to the default password is the same
 * problem, and the React gate covered neither path.
 */
async function tunnelSecurityBlock() {
  let settings;
  try {
    settings = await getSettings();
  } catch {
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

    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
