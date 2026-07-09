import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phases F/G: integration connection status. Guarded read;
// tokens are NEVER selected here (server-only, and RLS keeps them
// owner-scoped). `credentialsPresent` reflects whether the app-level OAuth
// client is configured in env at all — the Connect button explains what's
// missing when it isn't.

export type Provider = "quickbooks" | "zoho";

export interface IntegrationStatus {
  provider: Provider;
  connected: boolean;
  credentialsPresent: boolean;
  connectedAt: string | null;
}

const CLIENT_ENV: Record<Provider, string> = {
  quickbooks: "QBO_CLIENT_ID",
  zoho: "ZOHO_CLIENT_ID",
};

export async function listIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integrations")
    .select("provider, status, connected_at");
  const byProvider = new Map(
    (data ?? []).map((r) => [r.provider, r])
  );

  return (["quickbooks", "zoho"] as Provider[]).map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      connected: row?.status === "connected",
      credentialsPresent: Boolean(process.env[CLIENT_ENV[provider]]),
      connectedAt: row?.connected_at ?? null,
    };
  });
}

export async function isConnected(provider: Provider): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integrations")
    .select("status")
    .eq("provider", provider)
    .maybeSingle();
  return data?.status === "connected";
}
