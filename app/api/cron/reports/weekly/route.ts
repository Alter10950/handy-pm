import { NextResponse, type NextRequest } from "next/server";

import { sendCustomerReports } from "@/lib/comms/customer-report";
import { sendReports } from "@/lib/reports/send";

// See app/api/cron/reports/daily/route.ts for the CRON_SECRET reasoning
// — identical here, just the weekly period.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Customer weekly updates ride the same cron slot as the internal
  // weekly reports — Vercel Hobby caps the project at 2 cron jobs and
  // both were spent back in Sub-phase A (same reasoning as gate-nags
  // riding the daily route).
  const [reports, customerReports] = await Promise.all([
    sendReports("weekly"),
    sendCustomerReports(),
  ]);
  return NextResponse.json({ reports, customerReports });
}
