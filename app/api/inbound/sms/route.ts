import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

// Batch 5 Sub-phase C(3): Twilio SMS/WhatsApp webhook. Inbound texts land
// as DRAFT rows in inbound_messages for office triage — NEVER applied to
// installs/materials automatically. Gated on Twilio: with no
// TWILIO_AUTH_TOKEN the signature can't be verified, so the route rejects
// (it's not wired to a live number until Alter connects Twilio — see
// NEEDS-YOU). Uses the service-role client because a webhook has no user
// session; org is resolved from the destination number's mapping, or the
// sole org as a fallback for a single-tenant install.

export const dynamic = "force-dynamic";

// Twilio signs each request; verifying it is what proves the POST really
// came from Twilio and not a spoofer hitting a public URL.
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

function twiml(message?: string): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Not connected yet — acknowledge without storing (nothing is wired to
    // a real number until Twilio is configured).
    return twiml();
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }

  const signature = request.headers.get("x-twilio-signature");
  // Twilio signs the exact public URL it POSTed to.
  const url = process.env.TWILIO_WEBHOOK_URL ?? request.url;
  if (!verifyTwilioSignature(url, params, signature, authToken)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 403 });
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const isWhatsApp = from.startsWith("whatsapp:");
  const numMedia = Number(params.NumMedia ?? "0");
  const media: { url: string; contentType?: string }[] = [];
  for (let i = 0; i < numMedia; i += 1) {
    const mediaUrl = params[`MediaUrl${i}`];
    if (mediaUrl)
      media.push({ url: mediaUrl, contentType: params[`MediaContentType${i}`] });
  }

  const admin = createAdminClient();
  // Single-tenant resolution: the sole org. (A multi-tenant install would
  // map the Twilio 'To' number → org in integration settings.)
  const { data: orgs } = await admin.from("organizations").select("id").limit(2);
  if (!orgs || orgs.length !== 1) {
    // Can't safely attribute the message — acknowledge, don't guess.
    return twiml();
  }
  const orgId = orgs[0].id;

  // Best-effort project match: a project name mentioned in the body.
  let matchedProjectId: string | null = null;
  if (body.trim()) {
    const { data: projects } = await admin
      .from("projects")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("status", "active");
    const lower = body.toLowerCase();
    const hit = (projects ?? []).find((p) =>
      lower.includes(p.name.toLowerCase())
    );
    matchedProjectId = hit?.id ?? null;
  }

  const { error } = await admin.from("inbound_messages").insert({
    org_id: orgId,
    channel: isWhatsApp ? "whatsapp" : "sms",
    from_number: from,
    body: body || null,
    media,
    matched_project_id: matchedProjectId,
    status: matchedProjectId ? "received" : "unmatched",
  });
  // Even if storage fails (e.g. pre-migration), acknowledge to Twilio so it
  // doesn't retry-storm; the message is simply not captured.
  if (error) return twiml();

  return twiml(
    "Got it — your message is with the office for review. Thanks!"
  );
}
