"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/supabase/database.types";

export function ProjectTabs({
  projectId,
  status,
  canViewOfficeTabs,
}: {
  projectId: string;
  status: ProjectStatus;
  // Handoff and Change orders are hidden per-role, not just per-status —
  // their tables' RLS (handoff_surveys, change_orders) is owner/pm-only
  // both ways, so any other role would only ever see an empty shell.
  canViewOfficeTabs: boolean;
}) {
  const pathname = usePathname();
  const base = `/app/project/${projectId}`;

  // A pre-sale draft (status='estimate') has no drawing/rows to mark and
  // no install progress to track — Layout/Progress would be dead tabs for
  // it, so they're hidden rather than shown-but-empty. Estimate is always
  // present: useful for a draft's whole reason for existing, but just as
  // useful on a real active project (forecast-to-finish feeding the
  // scheduler, see ADR-030).
  const tabs = [
    { href: base, label: "Overview" },
    // Handoff formalizes a sale becoming an ops job — doesn't exist
    // pre-sale.
    ...(status !== "estimate" && canViewOfficeTabs
      ? [{ href: `${base}/handoff`, label: "Handoff" }]
      : []),
    ...(status !== "estimate"
      ? [{ href: `${base}/mark`, label: "Layout" }]
      : []),
    { href: `${base}/materials`, label: "Materials" },
    // Visible even pre-sale (unlike Layout/Progress/Portal, which are
    // execution-only) — the whole point of capturing non-install work
    // here is so a draft estimate's hours account for it from the
    // start (Batch 4 Sub-phase C), not just after conversion to active.
    { href: `${base}/scope`, label: "Scope" },
    ...(status !== "estimate"
      ? [
          { href: `${base}/receiving`, label: "Receiving" },
          { href: `${base}/progress`, label: "Progress" },
          { href: `${base}/portal`, label: "Portal" },
        ]
      : []),
    // Change orders only exist once there's a sold scope to change.
    ...(status !== "estimate" && canViewOfficeTabs
      ? [
          { href: `${base}/change-orders`, label: "COs" },
          // The push channel's audit log (project_comms RLS is
          // owner/pm-only, same as change_orders/handoff_surveys).
          { href: `${base}/comms`, label: "Comms" },
        ]
      : []),
    { href: `${base}/estimate`, label: "Estimate" },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const isActive =
          tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex h-11 shrink-0 items-center border-b-2 px-4 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
