import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import type { ProjectStatus } from "@/lib/supabase/database.types";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  estimate: "Estimate",
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
};

const STATUS_TONE: Record<ProjectStatus, PillTone> = {
  estimate: "info",
  active: "brand",
  on_hold: "warning",
  complete: "success",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <StatusPill tone={STATUS_TONE[status]} dot={status === "active"}>
      {STATUS_LABEL[status]}
    </StatusPill>
  );
}
