import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { isLocalRequest, hasRealDashboardSession } from "@/dashboardGuard";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const page = parseInt(searchParams.get("page"), 10) || 1;
    const pageSize = parseInt(searchParams.get("pageSize"), 10) || 20;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }
    
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);

    // 0.5.136 (upstream 8a527fec, adapted) — stored details include full request
    // bodies (prompts, tool calls) and provider responses. `/api/usage` is in the
    // "allow through when requireLogin is disabled" group, so with auth switched
    // off ANY caller that can reach the port could read every conversation.
    //
    // Upstream redacts unconditionally, which would also blind the dashboard's
    // own request inspector (RequestDetailsTab renders these bodies) — that
    // inspector is the point of the feature on a self-hosted router. So redact
    // only when the caller isn't provably the owner: a real dashboard session
    // (a verified JWT, not merely requireLogin=false) or a genuinely local
    // request. Metadata (model, tokens, latency, status) is never redacted.
    const trusted =
      isLocalRequest(request) || (await hasRealDashboardSession(request));

    if (trusted) return NextResponse.json(result);

    const redactedDetails = (result.details || []).map((d) => {
      const redacted = { ...d };
      for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
        if (redacted[key] !== undefined) redacted[key] = { redacted: true };
      }
      return redacted;
    });

    return NextResponse.json({ ...result, details: redactedDetails });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
