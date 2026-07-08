import { Resend } from "resend";

import { todayIso } from "@/lib/dates";
import { isProjectStalled } from "@/lib/gates/shared";
import { notifyUsers } from "@/lib/notifications/create";
import { createAdminClient } from "@/lib/supabase/admin";

// Same sandbox-sender caveat as lib/reports/send.ts (Resend's
// onboarding@resend.dev can only deliver to the account's own verified
// address until a custom domain is verified) — kept identical rather
// than importing from reports/, since that module has no shared export
// for it (see ADR-038: no lib/email/ helper exists yet in this codebase).
const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

export interface GateNagsResult {
  configured: boolean;
  projectsChecked: number;
  overdueItemNotifications: number;
  stalledNotifications: number;
  digestsSent: number;
  errors: string[];
}

interface RecipientDigestEntry {
  projectName: string;
  overdueLabels: string[];
  stalledDaysSinceActivity: number | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderDigestHtml(entries: RecipientDigestEntry[]): string {
  const rows = entries
    .map((entry) => {
      const bits: string[] = [];
      if (entry.stalledDaysSinceActivity !== null) {
        bits.push(
          `<strong style="color:#b91c1c;">Stalled</strong> — no activity in ${entry.stalledDaysSinceActivity} days`
        );
      }
      if (entry.overdueLabels.length > 0) {
        bits.push(
          `${entry.overdueLabels.length} overdue checklist item${entry.overdueLabels.length === 1 ? "" : "s"}: ${entry.overdueLabels
            .map((label) => escapeHtml(label))
            .join(", ")}`
        );
      }
      return `<li style="font-size:14px;margin-bottom:8px;"><strong>${escapeHtml(entry.projectName)}</strong><br/>${bits.join("<br/>")}</li>`;
    })
    .join("");
  return `<div style="font-family:sans-serif;max-width:520px;">
    <h2 style="font-size:16px;">Handy PM — daily checklist digest</h2>
    <p style="font-size:14px;color:#444;">Projects needing your attention today:</p>
    <ul style="padding-left:20px;">${rows}</ul>
  </div>`;
}

// The one function both the cron route and (later, if wired up) a manual
// trigger would call — checks every active project for overdue gate
// items and the STALLED flag, always creates in-app notifications (free,
// no external service), and additionally emails each affected recipient
// ONE combined digest (gated on RESEND_API_KEY, same "configured" signal
// convention as lib/reports/send.ts) rather than one email per project —
// a PM with several flagged projects should get a single summary, not a
// flood.
export async function sendGateNags(): Promise<GateNagsResult> {
  const admin = createAdminClient();
  const errors: string[] = [];
  const today = todayIso();

  const { data: projects, error: projectsError } = await admin
    .from("projects")
    .select("id, name, org_id, pm_user_id, last_activity_at")
    .eq("status", "active");
  if (projectsError) throw projectsError;

  const result: GateNagsResult = {
    configured: Boolean(process.env.RESEND_API_KEY),
    projectsChecked: projects.length,
    overdueItemNotifications: 0,
    stalledNotifications: 0,
    digestsSent: 0,
    errors,
  };
  if (projects.length === 0) return result;

  const projectIds = projects.map((p) => p.id);
  const orgIds = [...new Set(projects.map((p) => p.org_id))];

  const [
    { data: orgs, error: orgsError },
    { data: stages, error: stagesError },
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id, stalled_after_days")
      .in("id", orgIds),
    admin
      .from("project_stages")
      .select("id, project_id")
      .in("project_id", projectIds),
  ]);
  if (orgsError) throw orgsError;
  if (stagesError) throw stagesError;
  const stalledAfterDaysByOrg = new Map(
    orgs.map((o) => [o.id, o.stalled_after_days])
  );
  const projectIdByStage = new Map(stages.map((s) => [s.id, s.project_id]));
  const stageIds = stages.map((s) => s.id);

  const { data: overdueItems, error: itemsError } =
    stageIds.length > 0
      ? await admin
          .from("project_gate_items")
          .select("label, project_stage_id")
          .in("project_stage_id", stageIds)
          .eq("done", false)
          .lt("due_date", today)
      : {
          data: [] as { label: string; project_stage_id: string }[],
          error: null,
        };
  if (itemsError) throw itemsError;

  const overdueLabelsByProject = new Map<string, string[]>();
  for (const item of overdueItems) {
    const projectId = projectIdByStage.get(item.project_stage_id);
    if (!projectId) continue;
    const list = overdueLabelsByProject.get(projectId) ?? [];
    list.push(item.label);
    overdueLabelsByProject.set(projectId, list);
  }

  const ownerPmIdsByOrg = new Map<string, string[]>();
  for (const orgId of orgIds) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .in("role", ["owner", "pm"]);
    if (profilesError) throw profilesError;
    ownerPmIdsByOrg.set(
      orgId,
      profiles.map((p) => p.id)
    );
  }

  const digestByRecipient = new Map<string, RecipientDigestEntry[]>();

  for (const project of projects) {
    const overdueLabels = overdueLabelsByProject.get(project.id) ?? [];
    const stalledAfterDays = stalledAfterDaysByOrg.get(project.org_id) ?? 3;
    const stalled = isProjectStalled(
      project.last_activity_at,
      stalledAfterDays
    );
    if (overdueLabels.length === 0 && !stalled) continue;

    const daysSinceActivity = stalled
      ? Math.floor(
          (Date.now() - new Date(project.last_activity_at).getTime()) /
            86_400_000
        )
      : null;

    const recipients = project.pm_user_id
      ? [project.pm_user_id]
      : (ownerPmIdsByOrg.get(project.org_id) ?? []);
    if (recipients.length === 0) continue;

    try {
      if (overdueLabels.length > 0) {
        await notifyUsers(
          admin,
          project.org_id,
          recipients,
          "gate_item_overdue",
          {
            projectId: project.id,
            projectName: project.name,
            itemLabel: overdueLabels[0],
            overdueCount: overdueLabels.length,
          }
        );
        result.overdueItemNotifications += overdueLabels.length;
      }
      if (stalled) {
        await notifyUsers(
          admin,
          project.org_id,
          recipients,
          "project_stalled",
          {
            projectId: project.id,
            projectName: project.name,
            daysSinceActivity,
          }
        );
        result.stalledNotifications += 1;
      }
    } catch (err) {
      errors.push(
        `${project.name}: ${err instanceof Error ? err.message : "unknown error"}`
      );
      continue;
    }

    for (const userId of recipients) {
      const list = digestByRecipient.get(userId) ?? [];
      list.push({
        projectName: project.name,
        overdueLabels,
        stalledDaysSinceActivity: daysSinceActivity,
      });
      digestByRecipient.set(userId, list);
    }
  }

  if (!result.configured || digestByRecipient.size === 0) return result;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

  for (const [userId, entries] of digestByRecipient) {
    try {
      const { data: userData, error: userError } =
        await admin.auth.admin.getUserById(userId);
      if (userError) throw userError;
      const email = userData.user?.email;
      if (!email) continue;

      const { error } = await resend.emails.send({
        from,
        to: [email],
        subject: `Handy PM — ${entries.length} project${entries.length === 1 ? "" : "s"} need attention`,
        html: renderDigestHtml(entries),
      });
      if (error) {
        errors.push(`digest to ${email}: ${error.message}`);
        continue;
      }
      result.digestsSent += 1;
    } catch (err) {
      errors.push(
        `digest: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  return result;
}
