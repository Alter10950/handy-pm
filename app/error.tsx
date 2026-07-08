"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Root-level catch-all — covers what (protected)/error.tsx can't (Next
// excludes a segment's own layout.tsx from that segment's error.tsx, so a
// failure in app/(protected)/layout.tsx itself — e.g. the auth/profile
// lookup that runs on every protected request — isn't caught there) and
// what nothing else covers at all (/portal/[token] is a public route
// outside every other error boundary in the tree). Deliberately shows a
// generic message, not error.message — unlike (protected)/error.tsx (an
// already-authenticated org member), this can fire before we even know
// who's asking, including on the fully public customer portal.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-e1 p-6 text-center">
        <h1 className="text-lg font-bold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Please try again, or come back in a moment.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
