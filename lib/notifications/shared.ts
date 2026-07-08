// Pure types/formatting — zero server-only imports, safe for a Client
// Component (the notification bell) to import directly. See
// lib/gates/shared.ts for why this split exists in this codebase.
import type { Tables } from "@/lib/supabase/database.types";

// notifications.kind is a free-form `text` column (no CHECK constraint —
// see the migration), but the application only ever writes one of these,
// so this union is a self-imposed, non-enforced convention: new kinds
// can be added here without a migration.
export type NotificationKind =
  | "gate_item_overdue"
  | "project_stalled"
  | "pm_reassigned"
  | "material_flagged";

// One notification per project per nag run (not one per overdue item) —
// itemLabel names the first/only one for a quick peek, overdueCount
// disambiguates when there's more than one.
export interface GateItemOverduePayload {
  projectId: string;
  projectName: string;
  itemLabel: string;
  overdueCount: number;
}

export interface ProjectStalledPayload {
  projectId: string;
  projectName: string;
  daysSinceActivity: number;
}

// isNewPm flips the phrasing — the incoming PM and the outgoing PM (if
// any) get two independently-sent notifications with this same kind,
// never a single shared one, since the message reads differently.
export interface PmReassignedPayload {
  projectId: string;
  projectName: string;
  isNewPm: boolean;
}

// One notification per flag event (not batched) — a short/damaged/wrong
// discovery at the dock is exactly the thing the PM needs to hear about
// the same day, not in a digest.
export interface MaterialFlaggedPayload {
  projectId: string;
  projectName: string;
  materialName: string;
  flagStatus: string; // short | damaged | wrong
  qty: number;
}

export type NotificationRow = Tables<"notifications">;

export function formatNotificationMessage(
  notification: NotificationRow
): string {
  const payload = notification.payload as Record<string, unknown>;
  switch (notification.kind as NotificationKind) {
    case "gate_item_overdue": {
      const p = payload as unknown as GateItemOverduePayload;
      return p.overdueCount > 1
        ? `${p.projectName}: ${p.overdueCount} checklist items overdue`
        : `${p.projectName}: "${p.itemLabel}" is overdue`;
    }
    case "project_stalled": {
      const p = payload as unknown as ProjectStalledPayload;
      return `${p.projectName} has had no activity in ${p.daysSinceActivity} days`;
    }
    case "pm_reassigned": {
      const p = payload as unknown as PmReassignedPayload;
      return p.isNewPm
        ? `You're now the PM for ${p.projectName}`
        : `You're no longer the PM for ${p.projectName}`;
    }
    case "material_flagged": {
      const p = payload as unknown as MaterialFlaggedPayload;
      return `${p.projectName}: ${p.qty} × ${p.materialName} flagged ${p.flagStatus}`;
    }
    default:
      return notification.kind;
  }
}

export function notificationHref(notification: NotificationRow): string {
  const payload = notification.payload as Record<string, unknown>;
  const projectId =
    typeof payload.projectId === "string" ? payload.projectId : null;
  if (!projectId) return "/app/dashboard";
  // A flag lands you on Receiving (where the flag and its resolution
  // live), not the Overview.
  if ((notification.kind as NotificationKind) === "material_flagged") {
    return `/app/project/${projectId}/receiving`;
  }
  return `/app/project/${projectId}`;
}
