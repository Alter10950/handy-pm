import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { getProviderConfig, redirectUri } from "@/lib/integrations/oauth";
import type { Provider } from "@/lib/integrations/queries";

// Batch 5 F/G: start the OAuth authorization-code flow. Owner-only. Gated:
// with no app credentials it returns a clear message instead of a broken
// redirect (the Settings UI checks this first, but the route defends too).

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
  try {
    await requireRole(["owner"]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Owner only." },
      { status: 403 }
    );
  }

  const config = getProviderConfig(provider);
  if (!config) {
    return NextResponse.json(
      {
        error: `${provider} isn't configured on the server yet — set its OAuth app credentials first.`,
      },
      { status: 503 }
    );
  }

  const origin = new URL(request.url).origin;
  // `state` would carry a CSRF nonce in a full impl; the callback verifies
  // owner + org again regardless, and stores tokens server-side only.
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("redirect_uri", redirectUri(origin, provider));
  authUrl.searchParams.set("access_type", "offline");
  return NextResponse.redirect(authUrl.toString());
}
