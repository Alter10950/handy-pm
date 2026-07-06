"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addTemplateItem,
  removeTemplateItem,
  updateTemplateItem,
} from "@/lib/gates/actions";
import { STAGE_LABEL } from "@/lib/gates/shared";
import type { TemplateStageWithItems } from "@/lib/gates/shared";
import type {
  GateStageKey,
  ProfileRole,
  Tables,
} from "@/lib/supabase/database.types";

function TemplateItemRow({
  item,
  canManage,
}: {
  item: Tables<"gate_template_items">;
  canManage: boolean;
}) {
  const [label, setLabel] = useState(item.label);
  const [requiresPhoto, setRequiresPhoto] = useState(item.requires_photo);
  const [signoffRole, setSignoffRole] = useState(item.requires_signoff_role ?? "");
  const [isRemoved, setIsRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleLabelBlur() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === item.label) {
      setLabel(item.label);
      return;
    }
    startTransition(async () => {
      try {
        await updateTemplateItem(item.id, { label: trimmed });
        router.refresh();
      } catch (err) {
        setLabel(item.label);
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function handlePhotoToggle() {
    const next = !requiresPhoto;
    setRequiresPhoto(next);
    startTransition(async () => {
      try {
        await updateTemplateItem(item.id, { requiresPhoto: next });
        router.refresh();
      } catch (err) {
        setRequiresPhoto(!next);
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function handleSignoffChange(value: string) {
    const previous = signoffRole;
    setSignoffRole(value);
    startTransition(async () => {
      try {
        await updateTemplateItem(item.id, {
          requiresSignoffRole: (value || null) as ProfileRole | null,
        });
        router.refresh();
      } catch (err) {
        setSignoffRole(previous);
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function handleRemove() {
    setIsRemoved(true);
    startTransition(async () => {
      try {
        await removeTemplateItem(item.id);
        router.refresh();
      } catch (err) {
        setIsRemoved(false);
        setError(err instanceof Error ? err.message : "Could not remove.");
      }
    });
  }

  if (isRemoved) return null;

  if (!canManage) {
    return (
      <li
        data-testid={`template-item-${item.id}`}
        className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm text-foreground first:border-t-0"
      >
        <span className="flex-1">{item.label}</span>
        {item.requires_photo ? (
          <span className="text-xs text-muted-foreground">Photo required</span>
        ) : null}
        {item.requires_signoff_role ? (
          <span className="text-xs text-muted-foreground">
            {item.requires_signoff_role} sign-off
          </span>
        ) : null}
      </li>
    );
  }

  return (
    <li
      data-testid={`template-item-${item.id}`}
      className="flex flex-wrap items-center gap-2 border-t border-border py-2 first:border-t-0"
    >
      <Input
        value={label}
        disabled={isPending}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={handleLabelBlur}
        aria-label="Item label"
        className="h-8 min-w-48 flex-1 text-sm"
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={requiresPhoto}
          disabled={isPending}
          onChange={handlePhotoToggle}
          className="size-4 rounded border-border"
        />
        Photo
      </label>
      <select
        aria-label={`Sign-off role for ${item.label}`}
        value={signoffRole}
        disabled={isPending}
        onChange={(event) => handleSignoffChange(event.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">No sign-off</option>
        <option value="pm">PM sign-off</option>
        <option value="owner">Owner sign-off</option>
      </select>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={handleRemove}
        aria-label={`Remove ${item.label}`}
        className="text-destructive"
      >
        Remove
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

function TemplateStageCard({
  stage,
  canManage,
}: {
  stage: TemplateStageWithItems;
  canManage: boolean;
}) {
  const [newItemLabel, setNewItemLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAdd() {
    const label = newItemLabel.trim();
    if (!label) return;
    setError(null);
    startTransition(async () => {
      try {
        await addTemplateItem(stage.id, label);
        setNewItemLabel("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add item.");
      }
    });
  }

  return (
    <div
      data-testid={`template-stage-${stage.stage_key}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-semibold text-foreground">
        {STAGE_LABEL[stage.stage_key as GateStageKey]}
      </h3>
      {stage.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items yet.</p>
      ) : (
        <ul className="flex flex-col">
          {stage.items.map((item) => (
            <TemplateItemRow key={item.id} item={item} canManage={canManage} />
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Input
            placeholder="Add a checklist item…"
            value={newItemLabel}
            onChange={(event) => setNewItemLabel(event.target.value)}
            disabled={isPending}
            className="h-8 flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleAdd}
          >
            + Add
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function TemplateEditor({
  stages,
  canManage,
}: {
  stages: TemplateStageWithItems[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Changes apply to new projects only — a project already under way
        keeps the checklist it started with.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {stages.map((stage) => (
          <TemplateStageCard key={stage.id} stage={stage} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
