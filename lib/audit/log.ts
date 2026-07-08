import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

// Append-only audit trail (Phase 16, ADR-053). Fire-and-forget by
// design: an audit-write failure (including the table not existing until
// the migration is approved) must NEVER break the action it documents —
// the action's own success is the source of truth; the log is the paper
// trail.

export interface AuditEvent {
  action: string; // 'role.change' | 'gate.override' | 'co.approve' | …
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
}

export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.org_id) return;

    await supabase.from("audit_events").insert({
      org_id: profile.org_id,
      actor_id: user.id,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      project_id: event.projectId ?? null,
      summary: event.summary,
      // Plain data by contract (callers pass serializable objects only).
      detail: (event.detail ?? null) as Json,
    });
  } catch {
    // Swallowed on purpose — see module comment.
  }
}
