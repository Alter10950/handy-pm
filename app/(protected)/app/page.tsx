import type { Metadata } from "next";

import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = {
  title: "Projects — Handy PM",
};

export default function ProjectsPage() {
  return (
    <PlaceholderPanel
      title="Projects"
      description="Office/PM area. Project list and details land in Phase 2 once the data model is in place."
    />
  );
}
