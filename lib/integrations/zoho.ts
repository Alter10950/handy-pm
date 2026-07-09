import { createAdminClient } from "@/lib/supabase/admin";

// Batch 5 Sub-phase G: Zoho CRM client. Reads the org's stored OAuth
// tokens (server-only, via the service-role client) and calls the Zoho
// API. Every function is a clean no-op / "not connected" when Zoho isn't
// linked, so the rest of the app never depends on it — manual project
// creation and stage transitions work unchanged. Field mapping is read
// from integrations.settings so no Zoho field name is hardcoded.

export interface ZohoDeal {
  id: string;
  dealName: string;
  accountName: string | null;
  contactName: string | null;
  amount: number | null;
  address: string | null;
}

interface ZohoConnection {
  accessToken: string;
  apiDomain: string;
  fieldMap: Record<string, string>;
}

const DEFAULT_FIELD_MAP: Record<string, string> = {
  dealName: "Deal_Name",
  accountName: "Account_Name",
  contactName: "Contact_Name",
  amount: "Amount",
  address: "Billing_Street",
  stage: "Stage",
};

async function getConnection(orgId: string): Promise<ZohoConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("status, tokens, settings")
    .eq("org_id", orgId)
    .eq("provider", "zoho")
    .maybeSingle();
  if (!data || data.status !== "connected") return null;
  const tokens = (data.tokens ?? {}) as {
    access_token?: string;
    api_domain?: string;
  };
  if (!tokens.access_token) return null;
  const settings = (data.settings ?? {}) as {
    fieldMap?: Record<string, string>;
  };
  return {
    accessToken: tokens.access_token,
    apiDomain: tokens.api_domain ?? "https://www.zohoapis.com",
    fieldMap: { ...DEFAULT_FIELD_MAP, ...(settings.fieldMap ?? {}) },
  };
}

export async function isZohoConnected(orgId: string): Promise<boolean> {
  return (await getConnection(orgId)) !== null;
}

function readField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const v = record[key];
  if (v == null) return null;
  if (typeof v === "object" && "name" in (v as object)) {
    return String((v as { name: unknown }).name ?? "");
  }
  return String(v);
}

// Won deals not yet imported as projects. Returns [] when not connected.
export async function listWonDeals(orgId: string): Promise<ZohoDeal[]> {
  const conn = await getConnection(orgId);
  if (!conn) return [];
  const map = conn.fieldMap;
  const url = `${conn.apiDomain}/crm/v5/Deals/search?criteria=(${map.stage}:equals:Closed Won)`;
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${conn.accessToken}` },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { data?: Record<string, unknown>[] };
  return (body.data ?? []).map((d) => ({
    id: String(d.id),
    dealName: readField(d, map.dealName) ?? "Untitled deal",
    accountName: readField(d, map.accountName),
    contactName: readField(d, map.contactName),
    amount: (() => {
      const raw = d[map.amount];
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : null;
    })(),
    address: readField(d, map.address),
  }));
}

// Push project status back onto the linked deal. Best-effort — a failure
// (or no connection) never blocks the local stage transition.
export async function pushProjectToDeal(
  orgId: string,
  dealId: string,
  update: { stage?: string; percentComplete?: number; expectedFinish?: string }
): Promise<void> {
  try {
    const conn = await getConnection(orgId);
    if (!conn) return;
    const record: Record<string, unknown> = {};
    if (update.stage) record[conn.fieldMap.stage] = update.stage;
    // Custom fields for progress/finish are org-specific — only sent when
    // the org mapped them, so we never write to a field that doesn't exist.
    if (
      update.percentComplete != null &&
      conn.fieldMap.percentComplete
    )
      record[conn.fieldMap.percentComplete] = update.percentComplete;
    if (update.expectedFinish && conn.fieldMap.expectedFinish)
      record[conn.fieldMap.expectedFinish] = update.expectedFinish;
    if (Object.keys(record).length === 0) return;
    await fetch(`${conn.apiDomain}/crm/v5/Deals`, {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${conn.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: [{ id: dealId, ...record }] }),
    });
  } catch {
    // Best-effort; the local state is the source of truth.
  }
}
