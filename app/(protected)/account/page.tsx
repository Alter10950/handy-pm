import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata: Metadata = {
  title: "Account — Handy PM",
};

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Account
      </h1>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Change password
        </h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
