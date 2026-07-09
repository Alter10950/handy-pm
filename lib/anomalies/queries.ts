import { createClient } from "@/lib/supabase/server";

// Guarded read of open anomaly flags (Batch 5 Sub-phase D). `available:
// false` when the table isn't applied yet — the dashboard renders nothing
// rather than crashing.

export interface OpenAnomaly {
  id: string;
  kind: string;
  severity: string;
  projectId: string | null;
  crewId: string | null;
  summary: string;
  createdAt: string;
}

export async function listOpenAnomalies(): Promise<{
  available: boolean;
  anomalies: OpenAnomaly[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anomaly_flags")
    .select("id, kind, severity, project_id, crew_id, payload, created_at")
    .is("acknowledged_at", null)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { available: false, anomalies: [] };
  return {
    available: true,
    anomalies: data.map((a) => {
      const payload =
        a.payload && typeof a.payload === "object"
          ? (a.payload as Record<string, unknown>)
          : {};
      return {
        id: a.id,
        kind: a.kind,
        severity: a.severity,
        projectId: a.project_id,
        crewId: a.crew_id,
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : `${a.kind} anomaly`,
        createdAt: a.created_at,
      };
    }),
  };
}
