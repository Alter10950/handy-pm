import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ChangeOrderDetail } from "@/components/change-orders/change-order-detail";
import { getChangeOrder } from "@/lib/change-orders/queries";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Change order — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function ChangeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string; coId: string }>;
}) {
  const { id, coId } = await params;
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
  if (profile?.role !== "owner" && profile?.role !== "pm") {
    redirect(`/app/project/${id}`);
  }

  const result = await getChangeOrder(coId);
  if (!result || result.changeOrder.project_id !== id) notFound();

  return (
    <ChangeOrderDetail
      projectId={id}
      changeOrder={result.changeOrder}
      items={result.items}
      customerEmail={project.customer_contact_email}
      resendConfigured={Boolean(process.env.RESEND_API_KEY)}
    />
  );
}
