import type { Metadata } from "next";

import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = {
  title: "Scheduler — Handy PM",
};

export default function SchedulerPage() {
  return (
    <PlaceholderPanel
      title="Scheduler"
      description="Crew and install scheduling lands in a later phase."
    />
  );
}
