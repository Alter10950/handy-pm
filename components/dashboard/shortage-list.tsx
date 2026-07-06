import Link from "next/link";

import type { DashboardShortage } from "@/lib/dashboard/queries";

export function ShortageList({ shortages }: { shortages: DashboardShortage[] }) {
  if (shortages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing short across any active project.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {shortages.map((shortage) => (
        <li
          key={`${shortage.projectId}-${shortage.materialId}`}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="text-foreground">
            {shortage.materialName}{" "}
            <Link
              href={`/app/project/${shortage.projectId}/materials`}
              className="text-muted-foreground hover:underline"
            >
              ({shortage.projectName})
            </Link>
          </span>
          <span className="shrink-0 font-medium text-destructive">
            {shortage.toOrder} to order
          </span>
        </li>
      ))}
    </ul>
  );
}
