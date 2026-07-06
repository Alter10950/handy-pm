"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/supabase/database.types";

export function ProjectTabs({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
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
    ...(status !== "estimate"
      ? [{ href: `${base}/mark`, label: "Layout" }]
      : []),
    { href: `${base}/materials`, label: "Materials" },
    ...(status !== "estimate"
      ? [{ href: `${base}/progress`, label: "Progress" }]
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
