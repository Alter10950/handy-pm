"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { verdict } from "@/lib/autopsy/shared";
import { requireRole } from "@/lib/auth/session";
import { recomputeCrewRates } from "@/lib/estimating/actions";
import { toggleGateItem } from "@/lib/gates/actions";
import { touchProjectActivity } from "@/lib/projects/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const AUTOPSY_MANAGERS = ["owner", "pm"] as const;
const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

function revalidateAutopsy(projectId: string) {
  revalidatePath(`/app/project/${projectId}/progress`);
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath("/app/estimate");
}

// Best-effort label sync of the seeded Closeout item — same pattern as
// handoff/materials/schedule (ADR-041/042/044).
async function tickAutopsyGateItem(projectId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId)
      .eq("stage_key", "closeout")
      .maybeSingle();
    if (!stage) return;
    const { data: item } = await supabase
      .from("project_gate_items")
      .select("id, done")
      .eq("project_stage_id", stage.id)
      .eq("label", "Autopsy generated")
      .maybeSingle();
    if (!item || item.done) return;
    await toggleGateItem(item.id, projectId, { done: true });
  } catch (err) {
    console.error("tickAutopsyGateItem failed", err);
  }
}

// Computes estimated-vs-actual across every dimension and upserts the
// autopsy row. Regenerating is safe and expected — numbers recompute
// from the ground truth each time; only the narrative (human/AI text)
// is preserved across regenerations.
export async function generateAutopsy(projectId: string): Promise<void> {
  await requireRole(AUTOPSY_MANAGERS);
  const supabase = await createClient();

  const [
    { data: project, error: projectError },
    { data: firstEstimate, error: estimateError },
    { data: rows, error: rowsError },
    { data: reconciliation, error: reconError },
    { data: dayLogs, error: dayLogsError },
    { data: blockers, error: blockersError },
    { data: approvedCos, error: cosError },
    { data: doneScope, error: scopeError },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("original_estimate_labor_units, original_estimate_days")
      .eq("id", projectId)
      .single(),
    supabase
      .from("project_estimates")
      .select("estimated_labor_units, estimated_hours, estimated_days")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("rows").select("id").eq("project_id", projectId),
    supabase
      .from("material_reconciliation")
      .select("name, needed, received, assigned, installed")
      .eq("project_id", projectId)
      .order("name"),
    supabase
      .from("day_logs")
      .select("install_start, install_end")
      .eq("project_id", projectId)
      .not("install_start", "is", null)
      .not("install_end", "is", null),
    supabase
      .from("blockers")
      .select("code, work_date")
      .eq("project_id", projectId),
    supabase
      .from("change_orders")
      .select("added_days")
      .eq("project_id", projectId)
      .eq("status", "approved"),
    supabase
      .from("scope_item_progress")
      .select("labor_units, status")
      .eq("project_id", projectId)
      .eq("status", "done"),
  ]);
  if (projectError) throw projectError;
  if (estimateError) throw estimateError;
  if (rowsError) throw rowsError;
  if (reconError) throw reconError;
  if (dayLogsError) throw dayLogsError;
  if (blockersError) throw blockersError;
  if (cosError) throw cosError;
  if (scopeError) throw scopeError;

  const rowIds = rows.map((r) => r.id);
  const [{ data: installs, error: installsError }, { data: materials, error: materialsError }] =
    await Promise.all([
      rowIds.length > 0
        ? supabase
            .from("installs")
            .select("material_id, qty, installed_on")
            .in("row_id", rowIds)
        : Promise.resolve({
            data: [] as { material_id: string; qty: number; installed_on: string }[],
            error: null,
          }),
      supabase.from("materials").select("id, labor_units").eq("project_id", projectId),
    ]);
  if (installsError) throw installsError;
  if (materialsError) throw materialsError;

  // Estimated side: the original-estimate snapshot (the deal-time
  // numbers, ADR-043) when it exists, else the FIRST saved estimate —
  // the earliest belief is the honest baseline to be judged against.
  const estimatedLaborUnits =
    project.original_estimate_labor_units ??
    firstEstimate?.estimated_labor_units ??
    null;
  const estimatedDays =
    project.original_estimate_days ?? firstEstimate?.estimated_days ?? null;
  const estimatedHours =
    firstEstimate?.estimated_hours ?? estimatedLaborUnits;

  // Actual side.
  const laborUnitsByMaterial = new Map(materials.map((m) => [m.id, m.labor_units]));
  const installedLaborUnits = installs.reduce(
    (sum, install) =>
      sum + install.qty * (laborUnitsByMaterial.get(install.material_id) ?? 0),
    0
  );
  const scopeLaborUnits = doneScope.reduce(
    (sum, item) => sum + (item.labor_units ?? 0),
    0
  );
  const actualLaborUnits =
    Math.round((installedLaborUnits + scopeLaborUnits) * 100) / 100;

  const actualDays = new Set(installs.map((i) => i.installed_on)).size;

  const actualLaborHours =
    Math.round(
      dayLogs.reduce((sum, log) => {
        const hours =
          (new Date(log.install_end!).getTime() -
            new Date(log.install_start!).getTime()) /
          3_600_000;
        return sum + Math.max(0, hours);
      }, 0) * 100
    ) / 100;

  // Blocker impact: distinct days with any blocker (total), and per code.
  const daysByCode = new Map<string, Set<string>>();
  const allBlockedDays = new Set<string>();
  for (const blocker of blockers) {
    allBlockedDays.add(blocker.work_date);
    const set = daysByCode.get(blocker.code) ?? new Set<string>();
    set.add(blocker.work_date);
    daysByCode.set(blocker.code, set);
  }
  const blockerBreakdown = Object.fromEntries(
    [...daysByCode.entries()].map(([code, days]) => [code, days.size])
  );

  const { error: upsertError } = await supabase.from("project_autopsies").upsert(
    {
      project_id: projectId,
      estimated_days: estimatedDays,
      actual_days: actualDays,
      estimated_hours: estimatedHours,
      actual_labor_hours: actualLaborHours,
      estimated_labor_units: estimatedLaborUnits,
      actual_labor_units: actualLaborUnits,
      material_variance: reconciliation as unknown as Json,
      change_order_count: approvedCos.length,
      change_order_days: approvedCos.reduce((sum, co) => sum + (co.added_days ?? 0), 0),
      blocker_days: allBlockedDays.size,
      blocker_breakdown: blockerBreakdown as unknown as Json,
    },
    { onConflict: "project_id" }
  );
  if (upsertError) throw upsertError;

  // Feed the estimation brain: this project's actuals are now history —
  // relearn crew rates so the next estimate weighs them (the rolling
  // window makes recent jobs the highest-weight data by construction).
  try {
    await recomputeCrewRates();
  } catch (err) {
    console.error("recomputeCrewRates after autopsy failed", err);
  }

  await tickAutopsyGateItem(projectId);
  await touchProjectActivity(projectId);
  revalidateAutopsy(projectId);
}

export async function saveAutopsyNarrative(
  projectId: string,
  narrative: string
): Promise<void> {
  await requireRole(AUTOPSY_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_autopsies")
    .update({ narrative: narrative.trim() || null })
    .eq("project_id", projectId);
  if (error) throw error;
  revalidateAutopsy(projectId);
}

// Optional email to the org's owners — the autopsy as a short text
// summary. Owner-only recipients (this is the bid-accuracy feedback
// loop, an ownership concern), resolved via the admin auth API the same
// way the internal reports do (ADR-032).
export async function emailAutopsyToOwners(projectId: string): Promise<void> {
  await requireRole(AUTOPSY_MANAGERS);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email isn't configured (RESEND_API_KEY).");

  const supabase = await createClient();
  const [{ data: autopsy, error }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("project_autopsies")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase.from("projects").select("name").eq("id", projectId).single(),
    ]);
  if (error) throw error;
  if (projectError) throw projectError;
  if (!autopsy) throw new Error("Generate the autopsy first.");

  const admin = createAdminClient();
  const { data: owners, error: ownersError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "owner");
  if (ownersError) throw ownersError;
  const emails = (
    await Promise.all(
      owners.map(async (owner) => {
        const { data } = await admin.auth.admin.getUserById(owner.id);
        return data.user?.email ?? null;
      })
    )
  ).filter((email): email is string => Boolean(email));
  if (emails.length === 0) throw new Error("No owner emails found.");

  const line = (label: string, estimated: number | null, actual: number | null) => {
    const v = verdict(estimated, actual);
    return `<tr>
      <td style="padding:6px;border:1px solid #eee;font-size:13px;color:#666;">${label}</td>
      <td style="padding:6px;border:1px solid #eee;font-size:14px;">${estimated ?? "—"}</td>
      <td style="padding:6px;border:1px solid #eee;font-size:14px;">${actual ?? "—"}</td>
      <td style="padding:6px;border:1px solid #eee;font-size:14px;font-weight:bold;">${v ? v.label : "—"}</td>
    </tr>`;
  };

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;">${project.name} — closeout autopsy</h1>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr>
          <th style="padding:6px;border:1px solid #eee;font-size:12px;color:#666;text-align:left;">Dimension</th>
          <th style="padding:6px;border:1px solid #eee;font-size:12px;color:#666;text-align:left;">Estimated</th>
          <th style="padding:6px;border:1px solid #eee;font-size:12px;color:#666;text-align:left;">Actual</th>
          <th style="padding:6px;border:1px solid #eee;font-size:12px;color:#666;text-align:left;">Verdict</th>
        </tr>
        ${line("Days", autopsy.estimated_days, autopsy.actual_days)}
        ${line("Productive hours", autopsy.estimated_hours, autopsy.actual_labor_hours)}
        ${line("Labor units", autopsy.estimated_labor_units, autopsy.actual_labor_units)}
      </table>
      <p style="font-size:14px;">
        Change orders: ${autopsy.change_order_count} (+${autopsy.change_order_days} day(s)) ·
        Blocker-affected days: ${autopsy.blocker_days}
      </p>
      ${autopsy.narrative ? `<p style="font-size:14px;white-space:pre-line;">${autopsy.narrative.replace(/</g, "&lt;")}</p>` : ""}
      <p style="color:#999;font-size:12px;margin-top:24px;">Sent from Handy PM.</p>
    </div>`;

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const { error: sendError } = await resend.emails.send({
    from,
    to: emails,
    subject: `Autopsy: ${project.name}`,
    html,
  });
  if (sendError) throw new Error(`Email failed to send: ${sendError.message}`);
}
