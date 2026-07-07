import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ChangeOrderList } from "@/components/change-orders/change-order-list";
import { listChangeOrders } from "@/lib/change-orders/queries";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Change orders — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function ChangeOrdersPage({
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
  // change_orders RLS is owner/pm-only both ways — same two-layer posture
  // (hidden tab + page redirect) as Handoff and /app/team.
  if (profile?.role !== "owner" && profile?.role !== "pm") {
    redirect(`/app/project/${id}`);
  }

  const changeOrders = await listChangeOrders(id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Change orders</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scope growth becomes a numbered, priced, customer-approved decision
          — not silent margin loss. Approved changes merge into the
          project&apos;s scope and materials automatically.
        </p>
      </div>

      <ChangeOrderList projectId={id} changeOrders={changeOrders} />
    </div>
  );
}
