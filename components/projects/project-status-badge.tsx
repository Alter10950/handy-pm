import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/supabase/database.types";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
};

const STATUS_CLASS: Record<ProjectStatus, string> = {
  active: "bg-primary/15 text-primary",
  on_hold: "bg-warning/15 text-warning",
  complete: "bg-success/15 text-success",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_CLASS[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
