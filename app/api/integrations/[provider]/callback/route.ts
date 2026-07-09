import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderConfig, redirectUri } from "@/lib/integrations/oauth";
import type { Provider } from "@/lib/integrations/queries";

// Batch 5 F/G: OAuth callback — exchange the code for tokens and store them
// server-side (owner-only, via the service-role client since tokens must
// never touch a browser-scoped query). Gated: no creds → clear message.

export const dynamic = "force-dynamic";

function isProvider(v: string): v is Provider {
  return v === "quickbooks" || v === "zoho";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  let orgId: string;
  let userId: string;
  try {
    const ctx = await requireRole(["owner"]);
    orgId = ctx.orgId;
    userId = ctx.userId;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Owner only." },
      { status: 403 }
    );
  }

  const config = getProviderConfig(provider);
  if (!config) {
    return NextResponse.json(
      { error: `${provider} isn't configured on the server.` },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${url.origin}/app/settings?integration=${provider}&error=${encodeURIComponent(oauthError)}`
    );
  }
  if (!code) {
    return NextResponse.json({ error: "No auth code." }, { status: 400 });
  }

  // Standard authorization-code → token exchange.
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(url.origin, provider),
    }),
  });
  if (!tokenResponse.ok) {
    return NextResponse.redirect(
      `${url.origin}/app/settings?integration=${provider}&error=${encodeURIComponent("token_exchange_failed")}`
    );
  }
  const tokens = await tokenResponse.json();

  // realmId (QBO company id) rides the callback query.
  const realmId = url.searchParams.get("realmId");
  const admin = createAdminClient();
  await admin.from("integrations").upsert(
    {
      org_id: orgId,
      provider,
      status: "connected",
      tokens: { ...tokens, realmId },
      connected_by: userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider" }
  );

  return NextResponse.redirect(
    `${url.origin}/app/settings?integration=${provider}&connected=1`
  );
}
