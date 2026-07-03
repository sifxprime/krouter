// 0.5.84 — Live health snapshot API.
// Exposes the Zenith connection-health tracker (EWMA latency + success rate
// per connection) so the dashboard can render live colored-dot indicators
// on each connection card.

import { NextResponse } from "next/server";
import { getHealthSnapshot } from "@/shared/services/connectionHealth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = getHealthSnapshot();
    return NextResponse.json(
      { success: true, snapshot },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || "failed to read health snapshot" },
      { status: 500 },
    );
  }
}
