import { NextResponse, type NextRequest } from "next/server";

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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await sendReports("daily");
  return NextResponse.json(result);
}
