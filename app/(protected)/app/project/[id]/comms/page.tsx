import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CommsWorkspace } from "@/components/comms/comms-workspace";
import { listProjectComms } from "@/lib/comms/queries";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Comms — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function CommsPage({
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
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // project_comms RLS is owner/pm-only both ways — same two-layer posture
  // (hidden tab + page redirect) as Handoff and Change orders.
  if (profile?.role !== "owner" && profile?.role !== "pm") {
    redirect(`/app/project/${id}`);
  }

  const comms = await listProjectComms(id);

  return (
    <CommsWorkspace
      projectId={id}
      contactName={project.customer_contact_name}
      contactEmail={project.customer_contact_email}
      commsMilestones={project.comms_milestones}
      commsWeeklyReport={project.comms_weekly_report}
      comms={comms}
      resendConfigured={Boolean(process.env.RESEND_API_KEY)}
    />
  );
}
