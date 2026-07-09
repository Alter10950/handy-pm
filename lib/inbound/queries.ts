import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phase C(3): office triage of inbound SMS/WhatsApp. Guarded
// read — `available: false` before the migration (or when nothing's ever
// arrived) so the dashboard shows a hint, not a crash.

export interface InboundMessageRow {
  id: string;
  channel: string;
  fromNumber: string;
  body: string | null;
  media: { url: string; contentType?: string }[];
  matchedProjectId: string | null;
  status: string;
  createdAt: string;
}

export interface InboundInbox {
  available: boolean;
  configured: boolean;
  messages: InboundMessageRow[];
}

export async function listInboundMessages(): Promise<InboundInbox> {
  const configured = Boolean(process.env.TWILIO_AUTH_TOKEN);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbound_messages")
    .select(
      "id, channel, from_number, body, media, matched_project_id, status, created_at"
    )
    .in("status", ["received", "parsed", "unmatched"])
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return { available: false, configured, messages: [] };
  return {
    available: true,
    configured,
    messages: data.map((m) => ({
      id: m.id,
      channel: m.channel,
      fromNumber: m.from_number,
      body: m.body,
      media: Array.isArray(m.media)
        ? (m.media as { url: string; contentType?: string }[])
        : [],
      matchedProjectId: m.matched_project_id,
      status: m.status,
      createdAt: m.created_at,
    })),
  };
}
