"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addChangeOrderItem,
  cancelChangeOrder,
  recordManualApproval,
  removeChangeOrderItem,
  sendChangeOrderForApproval,
  setCustomerContactEmail,
  updateChangeOrder,
} from "@/lib/change-orders/actions";
import {
  CO_REASON_LABEL,
  CO_STATUS_BADGE_CLASS,
  CO_STATUS_LABEL,
  coLabel,
  type ChangeOrderItemRow,
  type ChangeOrderRow,
} from "@/lib/change-orders/shared";
import type {
  ChangeOrderReason,
  ScopeWorkType,
} from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const REASONS = Object.keys(CO_REASON_LABEL) as ChangeOrderReason[];
const WORK_TYPES: ScopeWorkType[] = [
  "install",
  "teardown",
  "remove_levels",
  "add_levels",
  "relocate",
  "repair",
  "other",
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AddLineForm({
  changeOrderId,
  projectId,
}: {
  changeOrderId: string;
  projectId: string;
}) {
  const [kind, setKind] = useState<"scope" | "material">("scope");
  const [workType, setWorkType] = useState<ScopeWorkType>("install");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await addChangeOrderItem(changeOrderId, projectId, {
          kind,
          workType: kind === "scope" ? workType : undefined,
          description,
          qty: qty ? Number(qty) : null,
          unit: unit || null,
        });
        setDescription("");
        setQty("");
        setUnit("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add line.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex gap-1.5 text-xs">
        {(["scope", "material"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={cn(
              "rounded-md border px-2 py-1",
              kind === option
                ? "border-brand bg-brand-subtle text-foreground"
                : "border-border text-muted-foreground"
            )}
          >
            {option === "scope" ? "Scope work" : "Material"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === "scope" ? (
          <select
            aria-label="Work type"
            value={workType}
            onChange={(e) => setWorkType(e.target.value as ScopeWorkType)}
            disabled={isPending}
            className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
          >
            {WORK_TYPES.map((wt) => (
              <option key={wt} value={wt}>
                {wt.replace("_", " ")}
              </option>
            ))}
          </select>
        ) : null}
        <Input
          placeholder={kind === "scope" ? "What work?" : "Material name"}
          aria-label="Line description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          className="h-8 min-w-48 flex-1 text-sm"
        />
        <Input
          type="number"
          min={0}
          placeholder="qty"
          aria-label="Line quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          disabled={isPending}
          className="h-8 w-20 text-sm"
        />
        <Input
          placeholder="unit"
          aria-label="Line unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          disabled={isPending}
          className="h-8 w-20 text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || !description.trim()}
          onClick={submit}
        >
          {isPending ? "Adding…" : "+ Add line"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ChangeOrderDetail({
  projectId,
  changeOrder,
  items,
  customerEmail,
  resendConfigured,
}: {
  projectId: string;
  changeOrder: ChangeOrderRow;
  items: ChangeOrderItemRow[];
  customerEmail: string | null;
  resendConfigured: boolean;
}) {
  const co = changeOrder;
  const isDraft = co.status === "draft";
  const [title, setTitle] = useState(co.title);
  const [description, setDescription] = useState(co.description ?? "");
  const [reason, setReason] = useState<ChangeOrderReason>(co.reason);
  const [laborUnits, setLaborUnits] = useState(
    co.labor_units !== null ? String(co.labor_units) : ""
  );
  const [addedDays, setAddedDays] = useState(
    co.added_days !== null ? String(co.added_days) : ""
  );
  const [price, setPrice] = useState(co.price !== null ? String(co.price) : "");

  // Adding/removing a line server-recomputes labor_units/added_days and
  // router.refresh() delivers the new props — but useState initials
  // don't re-run, so the inputs would show stale figures forever.
  // Adopt the fresh server value whenever it changes (the
  // adjust-state-during-render pattern, same as LifecyclePanel's
  // active-stage follow in ADR-038).
  const [lastServerLabor, setLastServerLabor] = useState(co.labor_units);
  if (co.labor_units !== lastServerLabor) {
    setLastServerLabor(co.labor_units);
    setLaborUnits(co.labor_units !== null ? String(co.labor_units) : "");
  }
  const [lastServerDays, setLastServerDays] = useState(co.added_days);
  if (co.added_days !== lastServerDays) {
    setLastServerDays(co.added_days);
    setAddedDays(co.added_days !== null ? String(co.added_days) : "");
  }
  const [emailInput, setEmailInput] = useState(customerEmail ?? "");
  const [approverName, setApproverName] = useState("");
  const [approvalVia, setApprovalVia] = useState<"verbal" | "written">(
    "verbal"
  );
  const [showManualApproval, setShowManualApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<void>, successNotice?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await fn();
        if (successNotice) setNotice(successNotice);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function saveHeaderFields() {
    run(() =>
      updateChangeOrder(co.id, projectId, {
        title,
        description: description || null,
        reason,
      })
    );
  }

  function saveFigures() {
    run(() =>
      updateChangeOrder(co.id, projectId, {
        laborUnits: laborUnits ? Number(laborUnits) : null,
        addedDays: addedDays ? Number(addedDays) : null,
        price: price ? Number(price) : null,
      })
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link
            href={`/app/project/${projectId}/change-orders`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← All COs
          </Link>
          <h2 className="text-lg font-semibold text-foreground">
            {coLabel(co.number)}
          </h2>
          <span
            data-testid="co-status-badge"
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              CO_STATUS_BADGE_CLASS[co.status]
            )}
          >
            {CO_STATUS_LABEL[co.status]}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="text-sm font-semibold text-foreground">Details</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="co-edit-title"
              className="text-xs text-muted-foreground"
            >
              Title
            </label>
            <Input
              id="co-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={isDraft ? saveHeaderFields : undefined}
              disabled={!isDraft || isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="co-edit-reason"
              className="text-xs text-muted-foreground"
            >
              Reason
            </label>
            <select
              id="co-edit-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as ChangeOrderReason);
              }}
              onBlur={isDraft ? saveHeaderFields : undefined}
              disabled={!isDraft || isPending}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {CO_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <label
            htmlFor="co-edit-description"
            className="text-xs text-muted-foreground"
          >
            Description (the customer will see this)
          </label>
          <textarea
            id="co-edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={isDraft ? saveHeaderFields : undefined}
            disabled={!isDraft || isPending}
            rows={2}
            className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          What this change adds
        </h3>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No lines yet — add the scope work and/or materials this change
            covers.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5" data-testid="co-line-list">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      item.kind === "scope"
                        ? "bg-brand-subtle text-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.kind === "scope"
                      ? (item.work_type ?? "scope").replace("_", " ")
                      : "material"}
                  </span>
                  <span className="text-foreground">{item.description}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {item.qty !== null ? (
                    <span>
                      {item.qty} {item.unit ?? ""}
                    </span>
                  ) : null}
                  {item.labor_units !== null ? (
                    <span>{item.labor_units} hrs</span>
                  ) : null}
                  {isDraft ? (
                    <button
                      type="button"
                      onClick={() =>
                        run(() =>
                          removeChangeOrderItem(item.id, co.id, projectId)
                        )
                      }
                      disabled={isPending}
                      className="text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isDraft ? (
          <div className="mt-3">
            <AddLineForm changeOrderId={co.id} projectId={projectId} />
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Impact (auto-suggested from the lines — edit before sending)
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-labor" className="text-xs text-muted-foreground">
              Labor hours
            </label>
            <Input
              id="co-labor"
              type="number"
              min={0}
              step="0.1"
              value={laborUnits}
              onChange={(e) => setLaborUnits(e.target.value)}
              onBlur={isDraft ? saveFigures : undefined}
              disabled={!isDraft || isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-days" className="text-xs text-muted-foreground">
              Added days
            </label>
            <Input
              id="co-days"
              type="number"
              min={0}
              step="0.1"
              value={addedDays}
              onChange={(e) => setAddedDays(e.target.value)}
              onBlur={isDraft ? saveFigures : undefined}
              disabled={!isDraft || isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-price" className="text-xs text-muted-foreground">
              Price ($, optional)
            </label>
            <Input
              id="co-price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={isDraft ? saveFigures : undefined}
              disabled={!isDraft || isPending}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Customer approval
        </h3>

        {co.status === "approved" ? (
          <p
            className="mt-2 text-sm text-success-fg"
            data-testid="co-approved-line"
          >
            Approved{" "}
            {co.customer_approved_via ? `(${co.customer_approved_via})` : ""}
            {co.customer_approver_name
              ? ` by ${co.customer_approver_name}`
              : ""}{" "}
            on {formatDateTime(co.customer_approved_at)}. Its scope and
            materials have merged into the project.
          </p>
        ) : co.status === "rejected" ? (
          <p className="mt-2 text-sm text-destructive">
            Rejected {formatDateTime(co.customer_approved_at)}.
          </p>
        ) : co.status === "cancelled" ? (
          <p className="mt-2 text-sm text-muted-foreground">Cancelled.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {co.status === "pending_customer" ? (
              <p className="text-sm text-info-fg">
                Sent to {co.sent_to} on {formatDateTime(co.sent_at)} — waiting
                on the customer. You can still record their approval manually
                below (e.g. they called instead).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Email the customer a secure approve/decline link
                  {resendConfigured
                    ? ""
                    : " (email isn't configured — use manual approval below)"}
                  :
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Customer email"
                    type="email"
                    placeholder="customer@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    disabled={isPending || !resendConfigured}
                    className="h-8 w-64 text-sm"
                  />
                  {emailInput.trim() &&
                  emailInput.trim() !== (customerEmail ?? "") ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => setCustomerContactEmail(projectId, emailInput),
                          "Customer email saved."
                        )
                      }
                    >
                      Save email
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !resendConfigured || !customerEmail}
                    onClick={() =>
                      run(
                        () => sendChangeOrderForApproval(co.id, projectId),
                        "Sent — the customer has the approval link."
                      )
                    }
                  >
                    {isPending ? "Working…" : "Send for approval"}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {!showManualApproval ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowManualApproval(true)}
                  >
                    Record approval manually
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => cancelChangeOrder(co.id, projectId),
                        "Cancelled."
                      )
                    }
                  >
                    Cancel CO
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    The customer approved outside the link (a call, a signed
                    doc) — record who and how:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Approval channel"
                      value={approvalVia}
                      onChange={(e) =>
                        setApprovalVia(e.target.value as "verbal" | "written")
                      }
                      disabled={isPending}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                    >
                      <option value="verbal">Verbal</option>
                      <option value="written">Written</option>
                    </select>
                    <Input
                      aria-label="Approver name"
                      placeholder="Who approved it?"
                      value={approverName}
                      onChange={(e) => setApproverName(e.target.value)}
                      disabled={isPending}
                      className="h-8 w-56 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending || !approverName.trim()}
                      onClick={() =>
                        run(
                          () =>
                            recordManualApproval(co.id, projectId, {
                              via: approvalVia,
                              approverName,
                            }),
                          "Approved — scope and materials merged into the project."
                        )
                      }
                    >
                      {isPending ? "Working…" : "Record approval"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowManualApproval(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {notice ? <p className="text-sm text-success-fg">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
