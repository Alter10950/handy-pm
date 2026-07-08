import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { VerificationWorksheet } from "@/components/materials/verification-worksheet";
import { getMaterialsReadiness } from "@/lib/materials/queries";
import {
  getProject,
  listMaterialReconciliation,
  listMaterials,
} from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Verification worksheet — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function VerificationWorksheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const canManage = profile?.role === "owner" || profile?.role === "pm";

  const [materials, reconciliation, readiness] = await Promise.all([
    listMaterials(id),
    listMaterialReconciliation(id),
    getMaterialsReadiness(id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Verification worksheet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check each delivery off against the packing slip — confirm the good,
            flag the short/damaged/wrong. The Materials gate goes green only
            when everything below does.
          </p>
        </div>
        <Link
          href={`/app/project/${id}/receiving`}
          className="text-xs font-medium text-info-fg hover:underline"
        >
          ← Back to Receiving
        </Link>
      </div>

      <div
        data-testid="readiness-summary"
        className={`rounded-lg border px-4 py-3 ${
          readiness.isReady
            ? "border-success/50 bg-success/10"
            : "border-border bg-card"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span
            className={
              readiness.isReady
                ? "font-semibold text-success-fg"
                : "font-semibold text-foreground"
            }
          >
            {readiness.isReady
              ? "Materials gate: green"
              : "Materials gate: not ready"}
          </span>
          <span className="text-muted-foreground">
            {Math.round(readiness.pctReceived * 100)}% received
          </span>
          <span className="text-muted-foreground">
            {Math.round(readiness.pctVerified * 100)}% verified
          </span>
          <span
            className={
              readiness.openFlagQty > 0
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            }
          >
            {readiness.openFlagQty} flagged open
          </span>
        </div>
        {!readiness.isReady && readiness.blockedReason ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {readiness.blockedReason}
          </p>
        ) : null}
      </div>

      <VerificationWorksheet
        materials={materials}
        reconciliation={reconciliation}
        canManage={canManage}
      />
    </div>
  );
}
