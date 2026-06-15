import { NextResponse } from "next/server";
import { KIRO_CONFIG } from "@/lib/oauth/constants/oauth";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kiro/social-exchange
 * Poll the device-code endpoint until the user finishes Google/GitHub login,
 * then persist the resulting tokens as a Kiro provider connection.
 *
 * The frontend calls this on an interval (5s by default) — while the user
 * hasn't completed login yet, the upstream returns "authorization_pending"
 * which we mirror as { pending: true } so the client keeps polling.
 *
 * Replaces the older PKCE code-exchange. Same response shape on success so
 * the wrapper component doesn't need to know which flow ran.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { deviceCode, provider } = body || {};

    if (!deviceCode) {
      return NextResponse.json({ error: "Missing deviceCode" }, { status: 400 });
    }
    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const response = await fetch(KIRO_CONFIG.socialDevicePollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceCode,
        clientId: KIRO_CONFIG.socialClientId,
      }),
    });

    const data = await response.json().catch(() => ({}));

    // User hasn't finished authenticating yet — frontend keeps polling.
    if (!response.ok || data.error === "authorization_pending" || data.error === "slow_down") {
      return NextResponse.json({ pending: true, error: data.error || "authorization_pending" });
    }

    // Edge case: 200 but no tokens — treat as still pending so we don't lose
    // the polling loop on a malformed intermediate response.
    if (!data.accessToken && !data.refreshToken) {
      return NextResponse.json({ pending: true, error: data.error || "no_tokens" });
    }

    const kiroService = new KiroService();
    const email = kiroService.extractEmailFromJWT(data.accessToken);

    const providerSpecificData = {
      authMethod: provider,
      provider: provider.charAt(0).toUpperCase() + provider.slice(1),
    };
    if (data.profileArn) providerSpecificData.profileArn = data.profileArn;

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: new Date(Date.now() + (data.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro social exchange error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
