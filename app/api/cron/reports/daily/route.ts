import { NextResponse, type NextRequest } from "next/server";

import { sendGateNags } from "@/lib/gates/nags";
import { sendReports } from "@/lib/reports/send";

// Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`
// when CRON_SECRET is set as a project env var — this is Vercel's own
// documented mechanism for authenticating cron requests, not a custom
// scheme. Without CRON_SECRET configured, the check is skipped (so this
// still works before that env var exists — see NEEDS-YOU); once it's
// set, an unauthenticated request is rejected.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

// Gate nags ride this same once-daily cron rather than getting their own
// — Vercel's Hobby plan caps a project at 2 cron jobs total, and both
// slots are already spent on this route plus the weekly report (see
// ADR-038). Piggybacking here still delivers a genuinely daily check.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const [reports, gateNags] = await Promise.all([
    sendReports("daily"),
    sendGateNags(),
  ]);
  return NextResponse.json({ reports, gateNags });
}
