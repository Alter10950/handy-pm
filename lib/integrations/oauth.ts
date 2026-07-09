// Batch 5 Sub-phases F/G: OAuth2 config for the two integrations. The
// handshake is standard authorization-code flow; only the endpoints,
// scopes, and env var names differ per provider. Everything here is
// server-only. Nothing runs until the org's app credentials are set —
// getProviderConfig returns null when they're absent, and the routes turn
// that into a clear "needs credentials" response.

import type { Provider } from "@/lib/integrations/queries";

export interface ProviderConfig {
  provider: Provider;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
}

export function getProviderConfig(provider: Provider): ProviderConfig | null {
  if (provider === "quickbooks") {
    const clientId = process.env.QBO_CLIENT_ID;
    const clientSecret = process.env.QBO_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      authUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl:
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scope: "com.intuit.quickbooks.accounting",
    };
  }
  // zoho
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    provider,
    clientId,
    clientSecret,
    authUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scope: "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL",
  };
}

export function redirectUri(origin: string, provider: Provider): string {
  return `${origin}/api/integrations/${provider}/callback`;
}
