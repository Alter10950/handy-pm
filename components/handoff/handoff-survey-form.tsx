"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addHandoffPhoto,
  removeHandoffPhoto,
  saveHandoffSurvey,
  signHandoffAsEstimator,
  signHandoffAsPm,
  type HandoffSurveyInput,
} from "@/lib/handoff/actions";
import {
  EMPTY_CONSTRAINTS,
  parseConstraints,
  type HandoffConstraints,
  type HandoffSurveyRow,
} from "@/lib/handoff/shared";
import { createClient } from "@/lib/supabase/client";

interface HandoffDraftResponse {
  existingRackingCondition: string | null;
  teardownRequired: boolean;
  teardownNotes: string | null;
  constraints: HandoffConstraints;
}

function formatSignedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function HandoffSurveyForm({
  projectId,
  survey,
  photoUrls,
  currentUserId,
  canManage,
  aiDraftAvailable,
}: {
  projectId: string;
  survey: HandoffSurveyRow | null;
  photoUrls: Record<string, string>;
  currentUserId: string;
  canManage: boolean;
  aiDraftAvailable: boolean;
}) {
  const [siteVisitDate, setSiteVisitDate] = useState(survey?.site_visit_date ?? "");
  const [existingCondition, setExistingCondition] = useState(
    survey?.existing_racking_condition ?? ""
  );
  const [teardownRequired, setTeardownRequired] = useState(
    survey?.teardown_required ?? false
  );
  const [teardownNotes, setTeardownNotes] = useState(survey?.teardown_notes ?? "");
  const [constraints, setConstraints] = useState<HandoffConstraints>(
    survey ? parseConstraints(survey.constraints) : { ...EMPTY_CONSTRAINTS }
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [roughNotes, setRoughNotes] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const photoPaths = survey?.photo_paths ?? [];

  async function handleDraftWithAi() {
    if (!roughNotes.trim()) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const response = await fetch("/api/handoff/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: roughNotes }),
      });
      const data = (await response.json()) as HandoffDraftResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not draft from notes.");
      }
      // Applied to local form state only — nothing is saved until the
      // estimator reviews/edits and clicks "Save survey" themselves.
      if (data.existingRackingCondition) {
        setExistingCondition(data.existingRackingCondition);
      }
      setTeardownRequired(data.teardownRequired);
      if (data.teardownNotes) setTeardownNotes(data.teardownNotes);
      setConstraints(data.constraints);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not draft from notes.");
    } finally {
      setDrafting(false);
    }
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    const input: HandoffSurveyInput = {
      siteVisitDate: siteVisitDate || null,
      existingRackingCondition: existingCondition || null,
      teardownRequired,
      teardownNotes: teardownRequired ? teardownNotes : null,
      constraints,
    };
    startTransition(async () => {
      try {
        await saveHandoffSurvey(projectId, input);
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save survey.");
      }
    });
  }

  async function handlePhotoSelected(file: File) {
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `${projectId}/handoff/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("daily-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (uploadError) throw uploadError;
      await addHandoffPhoto(projectId, path);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }

  function handleRemovePhoto(path: string) {
    startTransition(async () => {
      try {
        await removeHandoffPhoto(projectId, path);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove photo.");
      }
    });
  }

  function handleSignEstimator() {
    setError(null);
    startTransition(async () => {
      try {
        await signHandoffAsEstimator(projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not sign.");
      }
    });
  }

  function handleSignPm() {
    setError(null);
    startTransition(async () => {
      try {
        await signHandoffAsPm(projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not sign.");
      }
    });
  }

  const disabled = !canManage || isPending;

  return (
    <div className="flex flex-col gap-4">
      {aiDraftAvailable && canManage ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Draft from rough notes
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Typed or dictated notes from the walk-through — AI drafts the
            fields below from them, but nothing saves until you review and
            hit Save yourself.
          </p>
          <Textarea
            id="handoff_rough_notes"
            data-testid="handoff-rough-notes"
            value={roughNotes}
            onChange={(e) => setRoughNotes(e.target.value)}
            disabled={drafting}
            rows={3}
            placeholder="e.g. Existing racking is Ridg-U-Rak, rusted in back corner, needs to come down along the north wall. Warehouse stays live during install, forklift on site, dock doors on the east side only, permits probably needed…"
            className="mt-2"
          />
          <div className="mt-2 flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={drafting || !roughNotes.trim()}
              onClick={handleDraftWithAi}
            >
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
            {draftError ? (
              <span className="text-sm text-destructive">{draftError}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Site visit</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="site_visit_date" className="text-xs text-muted-foreground">
              Site visit date
            </label>
            <Input
              id="site_visit_date"
              type="date"
              value={siteVisitDate}
              onChange={(e) => setSiteVisitDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <label
            htmlFor="existing_racking_condition"
            className="text-xs text-muted-foreground"
          >
            Existing racking condition
          </label>
          <Textarea
            id="existing_racking_condition"
            value={existingCondition}
            onChange={(e) => setExistingCondition(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="What's already there — condition, brand/system if known, damage…"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Teardown</h3>
        <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={teardownRequired}
            onChange={(e) => setTeardownRequired(e.target.checked)}
            disabled={disabled}
            className="size-4 rounded border-border"
          />
          Teardown of existing racking is required
        </label>
        {teardownRequired ? (
          <Textarea
            value={teardownNotes}
            onChange={(e) => setTeardownNotes(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="What needs to come down, and any specifics (e.g. 3-level run along north wall)…"
            className="mt-2"
          />
        ) : null}
        {teardownRequired && teardownNotes.trim() ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Saving will create a draft teardown item on the Scope tab if one
            doesn&apos;t already exist.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Site constraints</h3>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={constraints.liveWarehouse}
              onChange={(e) =>
                setConstraints((c) => ({ ...c, liveWarehouse: e.target.checked }))
              }
              disabled={disabled}
              className="size-4 rounded border-border"
            />
            Warehouse is live/operating during install
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={constraints.forkliftOnsite}
              onChange={(e) =>
                setConstraints((c) => ({ ...c, forkliftOnsite: e.target.checked }))
              }
              disabled={disabled}
              className="size-4 rounded border-border"
            />
            Forklift available onsite
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={constraints.permitsNeeded}
              onChange={(e) =>
                setConstraints((c) => ({ ...c, permitsNeeded: e.target.checked }))
              }
              disabled={disabled}
              className="size-4 rounded border-border"
            />
            Permits needed
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="working_hours" className="text-xs text-muted-foreground">
                Working hours allowed
              </label>
              <Input
                id="working_hours"
                value={constraints.workingHours}
                onChange={(e) =>
                  setConstraints((c) => ({ ...c, workingHours: e.target.value }))
                }
                disabled={disabled}
                placeholder="e.g. 7am–3pm, no weekends"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="floor_condition" className="text-xs text-muted-foreground">
                Floor condition
              </label>
              <Input
                id="floor_condition"
                value={constraints.floorCondition}
                onChange={(e) =>
                  setConstraints((c) => ({ ...c, floorCondition: e.target.value }))
                }
                disabled={disabled}
                placeholder="e.g. concrete, cracking near dock 3"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="access_notes" className="text-xs text-muted-foreground">
              Access notes
            </label>
            <Input
              id="access_notes"
              value={constraints.accessNotes}
              onChange={(e) =>
                setConstraints((c) => ({ ...c, accessNotes: e.target.value }))
              }
              disabled={disabled}
              placeholder="Dock doors, freight elevator, parking for trucks…"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Site photos</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {photoPaths.map((path) =>
            photoUrls[path] ? (
              <div key={path} className="relative size-24 overflow-hidden rounded-md">
                <Image
                  src={photoUrls[path]}
                  alt="Site photo"
                  fill
                  unoptimized
                  className="object-cover"
                />
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(path)}
                    disabled={isPending}
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-xs text-destructive"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null
          )}
          {canManage ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                data-testid="handoff-photo-upload-input"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handlePhotoSelected(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
              >
                {uploading ? "Uploading…" : "+ Add photo"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button type="button" disabled={disabled} onClick={handleSave}>
            {isPending ? "Saving…" : "Save survey"}
          </Button>
          {saved ? <span className="text-sm text-success">Saved.</span> : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Dual sign-off
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Estimator
            </p>
            {survey?.estimator_signed_at ? (
              <p className="mt-1 text-sm text-foreground">
                Signed {formatSignedAt(survey.estimator_signed_at)}
                {survey.estimator_signoff_user_id === currentUserId ? " (you)" : ""}
              </p>
            ) : canManage ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={isPending}
                onClick={handleSignEstimator}
              >
                Sign as estimator
              </Button>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Not yet signed.</p>
            )}
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">PM</p>
            {survey?.pm_signed_at ? (
              <p className="mt-1 text-sm text-foreground">
                Signed {formatSignedAt(survey.pm_signed_at)}
                {survey.pm_signoff_user_id === currentUserId ? " (you)" : ""}
              </p>
            ) : canManage ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={isPending}
                onClick={handleSignPm}
              >
                Sign as PM
              </Button>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Not yet signed.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
