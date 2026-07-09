"use client";

import { useEffect } from "react";

import { recordProjectVisit } from "@/lib/projects/pinned";

/** Mounted by the project layout — records the visit for the sidebar's
 * "Recent" list (design pass v3 F2). Renders nothing. */
export function RecentProjectTracker({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  useEffect(() => {
    recordProjectVisit({ id, name });
  }, [id, name]);
  return null;
}
