import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in — Handy PM",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-e2">
            H
          </span>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">
              Handy<span className="text-text-secondary">PM</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Racking installs, run right.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Handy Equip · project management
        </p>
      </div>
    </main>
  );
}
