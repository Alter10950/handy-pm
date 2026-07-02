import type { Metadata } from "next";

import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = {
  title: "Field — Handy PM",
};

export default function FieldPage() {
  return (
    <PlaceholderPanel
      title="Field"
      description="Crew phone app (PWA) — install checklists, photos, and job status updates land in a later phase."
    />
  );
}
