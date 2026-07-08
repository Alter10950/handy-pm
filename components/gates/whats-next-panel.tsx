import { STAGE_LABEL } from "@/lib/gates/queries";
import type { NextAction } from "@/lib/gates/queries";
import type { GateStageKey } from "@/lib/supabase/database.types";

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function WhatsNextPanel({ actions }: { actions: NextAction[] }) {
  return (
    <div data-testid="whats-next-panel" className="rounded-lg border border-border bg-card shadow-e1 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        What&apos;s next
      </h2>
      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing urgent — the active stage has no open items yet, or everything&apos;s on track.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {actions.map((action) => (
            <li key={action.itemId} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="text-foreground">{action.label}</p>
                <p className="text-xs text-muted-foreground">
                  {STAGE_LABEL[action.stageKey as GateStageKey]}
                </p>
              </div>
              {action.dueDate ? (
                <span
                  className={
                    action.isOverdue
                      ? "shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
                      : "shrink-0 text-xs text-muted-foreground"
                  }
                >
                  {action.isOverdue ? "Overdue " : "Due "}
                  {formatDueDate(action.dueDate)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
