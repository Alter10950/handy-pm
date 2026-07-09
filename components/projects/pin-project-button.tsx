"use client";

import { StarIcon } from "lucide-react";

import {
  isPinned,
  togglePinnedProject,
  usePinnedProjects,
} from "@/lib/projects/pinned";
import { cn } from "@/lib/utils";

/** Star toggle (design pass v3 F2) — pins the project to the sidebar. */
export function PinProjectButton({ id, name }: { id: string; name: string }) {
  const pinned = usePinnedProjects();
  const on = isPinned(pinned, id);
  return (
    <button
      type="button"
      data-testid="pin-project"
      aria-pressed={on}
      aria-label={on ? "Unpin project" : "Pin project to sidebar"}
      title={on ? "Unpin from sidebar" : "Pin to sidebar"}
      onClick={() => togglePinnedProject({ id, name })}
      className={cn(
        "grid size-9 place-items-center rounded-lg border border-border bg-surface shadow-e1 transition-colors",
        on ? "text-brand" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <StarIcon
        aria-hidden
        className="size-4"
        fill={on ? "currentColor" : "none"}
      />
    </button>
  );
}
