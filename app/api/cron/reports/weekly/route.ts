import { NextResponse, type NextRequest } from "next/server";

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
  const result = await sendReports("weekly");
  return NextResponse.json(result);
}
