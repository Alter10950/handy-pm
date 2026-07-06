import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OrgLogoUpload } from "@/components/org/org-logo-upload";
import { OrgSettingsForm } from "@/components/org/org-settings-form";
import { TemplateEditor } from "@/components/gates/template-editor";
import {
  getDefaultGateTemplateId,
  getTemplateStagesWithItems,
} from "@/lib/gates/queries";
import { getOrgSettings, getSignedOrgLogoUrl } from "@/lib/org/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage() {
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

  if (!profile?.org_id || (profile.role !== "owner" && profile.role !== "pm")) {
    redirect("/app");
  }

  const org = await getOrgSettings();
  if (!org) redirect("/app");

  const logoUrl = org.logo_path
    ? await getSignedOrgLogoUrl(org.logo_path)
    : null;

  const templateId = await getDefaultGateTemplateId(profile.org_id);
  const templateStages = templateId
    ? await getTemplateStagesWithItems(templateId)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Organization settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shown across the app and on any customer-facing pages.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Logo</h2>
        <OrgLogoUpload orgId={org.id} currentLogoUrl={logoUrl} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Details</h2>
        <OrgSettingsForm
          initialName={org.name}
          initialAddress={org.address ?? ""}
          initialWorkingDays={org.default_working_days}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Project checklist template
        </h2>
        <p className="text-sm text-muted-foreground">
          The 8 stages every project moves through — Handoff, Scope,
          Schedule, Materials, Mobilize, Execute, Punch, Closeout — are
          fixed, but the checklist items inside each one are yours to
          tune.
        </p>
        {templateStages.length > 0 ? (
          <TemplateEditor
            stages={templateStages}
            canManage={profile.role === "owner"}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No default template found for this organization yet.
          </p>
        )}
      </div>
    </div>
  );
}
