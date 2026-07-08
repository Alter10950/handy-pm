import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScopeWorkspace } from "@/components/scope/scope-workspace";
import { loadLaborStandardsMap } from "@/lib/estimating/queries";
import { listPhases } from "@/lib/phases/queries";
import { getProject, listRows } from "@/lib/projects/queries";
import { listScopeItems } from "@/lib/scope/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Scope — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function ScopePage({
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

  const [items, phases, rows, laborStandards] = await Promise.all([
    listScopeItems(id),
    listPhases(id),
    listRows(id),
    loadLaborStandardsMap(),
  ]);
  // Maps don't serialize across the Server->Client Component boundary —
  // pass a plain object instead (see components/scope/scope-workspace.tsx).
  const laborStandardsByTaskKey = Object.fromEntries(laborStandards);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Scope of work</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything beyond install — teardown, level changes, relocation,
          repair — so it&apos;s captured, estimated, and tracked instead of
          discovered on site.
        </p>
      </div>

      <ScopeWorkspace
        projectId={id}
        items={items}
        phases={phases}
        rows={rows.map((r) => ({ id: r.id, label: r.label }))}
        laborStandards={laborStandardsByTaskKey}
        canManage={canManage}
      />
    </div>
  );
}
