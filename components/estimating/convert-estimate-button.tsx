"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { convertEstimateToActive } from "@/lib/estimating/actions";

// A plain form action, not a manual onClick + try/catch — convertEstimateToActive
// redirects on success, and Next.js's redirect throw needs to reach the
// framework unintercepted (same reason new-project-dialog.tsx's createProject
// call is a form action, not a wrapped handler). Any real failure surfaces
// via the route's own error boundary (app/(protected)/error.tsx).
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Converting…" : "Convert to active project"}
    </Button>
  );
}

export function ConvertEstimateButton({ projectId }: { projectId: string }) {
  return (
    <form action={convertEstimateToActive.bind(null, projectId)}>
      <SubmitButton />
    </form>
  );
}
