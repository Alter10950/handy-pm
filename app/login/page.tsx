import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in — Handy PM",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-lg">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-foreground">
            Handy<span className="text-primary">PM</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to manage your racking-install projects.
          </p>
        </div>

        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
