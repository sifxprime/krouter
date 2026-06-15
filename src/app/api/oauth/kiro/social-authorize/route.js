import { NextResponse } from "next/server";
import { KIRO_CONFIG } from "@/lib/oauth/constants/oauth";

/**
 * GET /api/oauth/kiro/social-authorize
 * Initiate Google/GitHub social login via AWS Cognito device-code flow.
 * Returns a verification URL the user opens in a browser, plus a deviceCode
 * the frontend polls with social-exchange until authorization completes.
 *
 * Replaces the older PKCE manual-callback flow — no more "copy the kiro://
 * URL out of the browser address bar" UX.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const loginProvider = provider === "google" ? "Google" : "Github";

    const response = await fetch(KIRO_CONFIG.socialDeviceAuthorizeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: KIRO_CONFIG.socialClientId,
        loginProvider,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Device authorization failed: ${errText || response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      authUrl: data.verificationUriComplete,
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      expiresIn: Math.floor((data.expiresInMilliseconds || 300_000) / 1000),
      interval: Math.floor((data.intervalInMilliseconds || 5000) / 1000),
      provider,
    });
  } catch (error) {
    console.log("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
