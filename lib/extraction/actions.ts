"use server";

import { resolveExtractionRun } from "@/lib/extraction/log";

// Server-action surface for the client review dialogs — the log module is
// server-only (it uses the request-scoped Supabase client), so client
// components reach it through this boundary rather than importing it
// directly.

export async function markExtractionRunResolved(
  runId: string,
  applied: boolean
): Promise<void> {
  await resolveExtractionRun(runId, applied);
}
