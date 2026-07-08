import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EstimateAccuracy } from "@/components/autopsy/estimate-accuracy";
import { PageHeader } from "@/components/ui/page-header";
import { CrewRatesPanel } from "@/components/estimating/crew-rates-panel";
import { LaborStandardsEditor } from "@/components/estimating/labor-standards-editor";
import { NewEstimateDialog } from "@/components/estimating/new-estimate-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import {
  listCompanyAutopsies,
  listLaborStandardDivergence,
} from "@/lib/autopsy/queries";
import { listCrews } from "@/lib/crews/queries";
import {
  listCrewRates,
  listEstimateProjects,
  listLaborStandards,
} from "@/lib/estimating/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Estimating — Handy PM",
};

export const dynamic = "force-dynamic";

// Same RLS-matching gate as /scheduler — labor_standards/crew_rates are
// owner/pm/scheduler-write, not owner/pm-only like /app/settings.
export default async function EstimatingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (
    !profile?.org_id ||
    !["owner", "pm", "scheduler"].includes(profile.role)
  ) {
    redirect("/app");
  }

  // project_autopsies RLS is owner/pm-only — a scheduler would just get
  // silent empties, so skip the queries entirely for them.
  const isOffice = profile.role === "owner" || profile.role === "pm";
  const [estimates, standards, crews, rates, autopsies, divergences] =
    await Promise.all([
      listEstimateProjects(),
      listLaborStandards(),
      listCrews(),
      listCrewRates(),
      isOffice ? listCompanyAutopsies() : Promise.resolve([]),
      isOffice ? listLaborStandardDivergence() : Promise.resolve([]),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Handy Equip"
        title="Estimating"
        description="Price future jobs from a pasted material list — before a drawing exists."
        actions={<NewEstimateDialog />}
      />

      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Draft estimates
        </h2>
        {estimates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
            <p className="text-foreground">No draft estimates yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to paste a future job&apos;s material list and see
              estimated days before it&apos;s a real project.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {estimates.map((project) => (
              <ProjectCard key={project.project_id} project={project} />
            ))}
          </div>
        )}
      </div>

      {isOffice ? (
        <EstimateAccuracy autopsies={autopsies} divergences={divergences} />
      ) : null}

      <LaborStandardsEditor standards={standards} />
      <CrewRatesPanel crews={crews} rates={rates} />
    </div>
  );
}
