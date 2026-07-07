"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  logManualComm,
  sendCustomerReportNow,
  updateCustomerContact,
} from "@/lib/comms/actions";
import type { ProjectCommRow } from "@/lib/comms/queries";
import type { CommsChannel, CommsKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<CommsKind, string> = {
  milestone: "Milestone",
  weekly_report: "Weekly report",
  manual: "Logged",
  schedule_change: "Schedule change",
  change_order: "Change order",
};

const KIND_BADGE: Record<CommsKind, string> = {
  milestone: "bg-primary/15 text-primary",
  weekly_report: "bg-success/15 text-success",
  manual: "bg-muted text-muted-foreground",
  schedule_change: "bg-destructive/15 text-destructive",
  change_order: "bg-primary/15 text-primary",
};

const CHANNEL_LABEL: Record<CommsChannel, string> = {
  email: "email",
  portal: "portal",
  logged_call: "call",
  logged_other: "other",
};

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ContactCard({
  projectId,
  contactName,
  contactEmail,
  commsMilestones,
  commsWeeklyReport,
  resendConfigured,
}: {
  projectId: string;
  contactName: string | null;
  contactEmail: string | null;
  commsMilestones: boolean;
  commsWeeklyReport: boolean;
  resendConfigured: boolean;
}) {
  const [name, setName] = useState(contactName ?? "");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [milestones, setMilestones] = useState(commsMilestones);
  const [weekly, setWeekly] = useState(commsWeeklyReport);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await updateCustomerContact(projectId, {
          name,
          email,
          commsMilestones: milestones,
          commsWeeklyReport: weekly,
        });
        setNotice("Saved.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save contact.");
      }
    });
  }

  function sendNow() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await sendCustomerReportNow(projectId);
        setNotice("Update sent and logged below.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send the update.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Customer contact &amp; preferences
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-name" className="text-xs text-muted-foreground">
            Name
          </label>
          <Input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Dana at iBuy"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-email" className="text-xs text-muted-foreground">
            Email
          </label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            placeholder="customer@example.com"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={milestones}
            onChange={(e) => setMilestones(e.target.checked)}
            disabled={isPending}
            className="size-4 rounded border-border"
          />
          Auto milestone emails (schedule confirmed, install started, 50%,
          phase complete, finish changes, punch, closeout)
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={weekly}
            onChange={(e) => setWeekly(e.target.checked)}
            disabled={isPending}
            className="size-4 rounded border-border"
          />
          Auto weekly progress email while the job is executing
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" disabled={isPending} onClick={save}>
          {isPending ? "Working…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || !resendConfigured || !email.trim()}
          onClick={sendNow}
          title={
            !resendConfigured
              ? "Email isn't configured (RESEND_API_KEY)"
              : undefined
          }
        >
          Send update now
        </Button>
        {notice ? <span className="text-sm text-success">{notice}</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

function ManualLogForm({ projectId }: { projectId: string }) {
  const [channel, setChannel] = useState<CommsChannel>("logged_call");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await logManualComm(projectId, { channel, subject, body });
        setSubject("");
        setBody("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not log it.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Log a call or conversation
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Anything the customer was told outside the app belongs here too —
        this log is the complete record of what they know.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Comm channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as CommsChannel)}
          disabled={isPending}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="logged_call">Phone call</option>
          <option value="logged_other">Other</option>
        </select>
        <Input
          aria-label="Comm summary"
          placeholder="Short summary (e.g. told them install starts Monday)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isPending}
          className="h-8 min-w-64 flex-1 text-sm"
        />
      </div>
      <textarea
        aria-label="Comm details"
        placeholder="Details (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={isPending}
        rows={2}
        className="mt-2 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || !subject.trim()}
          onClick={submit}
        >
          {isPending ? "Logging…" : "Log it"}
        </Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

export function CommsWorkspace({
  projectId,
  contactName,
  contactEmail,
  commsMilestones,
  commsWeeklyReport,
  comms,
  resendConfigured,
}: {
  projectId: string;
  contactName: string | null;
  contactEmail: string | null;
  commsMilestones: boolean;
  commsWeeklyReport: boolean;
  comms: ProjectCommRow[];
  resendConfigured: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Customer communication
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The push channel — automatic milestones and weekly updates, plus a
          log of every call, so what the customer knows is never a mystery.
          The portal stays the pull channel.
        </p>
      </div>

      <ContactCard
        projectId={projectId}
        contactName={contactName}
        contactEmail={contactEmail}
        commsMilestones={commsMilestones}
        commsWeeklyReport={commsWeeklyReport}
        resendConfigured={resendConfigured}
      />

      <ManualLogForm projectId={projectId} />

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          History ({comms.length})
        </h3>
        {comms.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing sent or logged yet.
          </p>
        ) : (
          <ul data-testid="comms-history" className="mt-3 flex flex-col gap-2">
            {comms.map((comm) => (
              <li
                key={comm.id}
                className="flex flex-col gap-1 rounded-md border border-border p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium",
                      KIND_BADGE[comm.kind]
                    )}
                  >
                    {KIND_LABEL[comm.kind]}
                  </span>
                  <span className="text-muted-foreground">
                    {CHANNEL_LABEL[comm.channel]}
                    {comm.recipient ? ` · ${comm.recipient}` : ""}
                    {" · "}
                    {formatSentAt(comm.sent_at)}
                  </span>
                </div>
                <p className="text-sm text-foreground">{comm.subject}</p>
                {comm.body_snapshot ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      What was sent
                    </summary>
                    {comm.channel === "email" ? (
                      <div
                        className="mt-1.5 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-xs [&_*]:!text-foreground"
                        // The logged body_snapshot is HTML this app itself
                        // composed and sent (never user-authored markup) —
                        // rendering it is showing the office exactly what
                        // the customer received.
                        dangerouslySetInnerHTML={{ __html: comm.body_snapshot }}
                      />
                    ) : (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                        {comm.body_snapshot}
                      </p>
                    )}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
