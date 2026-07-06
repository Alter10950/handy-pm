"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approvePhoto, unapprovePhoto } from "@/lib/portal/actions";
import type { CandidatePhoto } from "@/lib/portal/queries";

function PhotoCard({
  photo,
  isPending,
  onApprove,
  onUnapprove,
}: {
  photo: CandidatePhoto;
  isPending: boolean;
  onApprove: (storagePath: string, source: CandidatePhoto["source"], caption: string) => void;
  onUnapprove: (photoId: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const isApproved = photo.approvedPhotoId !== null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
        <Image
          src={photo.url}
          alt={photo.context}
          fill
          unoptimized
          className="object-cover"
        />
        {isApproved ? (
          <span className="absolute right-1 top-1 rounded-full bg-card px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/40">
            Visible to customer
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{photo.context}</p>
      {isApproved ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => onUnapprove(photo.approvedPhotoId!)}
        >
          Remove from portal
        </Button>
      ) : (
        <>
          <Input
            placeholder="Caption (optional)"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            disabled={isPending}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => onApprove(photo.storagePath, photo.source, caption)}
          >
            Show to customer
          </Button>
        </>
      )}
    </div>
  );
}

export function PhotoApprovalPanel({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: CandidatePhoto[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove(
    storagePath: string,
    source: CandidatePhoto["source"],
    caption: string
  ) {
    setError(null);
    startTransition(async () => {
      try {
        await approvePhoto(projectId, storagePath, source, caption || null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not approve photo.");
      }
    });
  }

  function handleUnapprove(photoId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await unapprovePhoto(photoId, projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove photo.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Photos ({candidates.length})
      </h2>
      <p className="text-xs text-muted-foreground">
        Day-log and blocker photos from this project. Nothing is customer-visible
        until you explicitly show it here.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No photos logged yet — they show up here once a crew attaches one from
          Field.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {candidates.map((photo) => (
            <PhotoCard
              key={photo.storagePath}
              photo={photo}
              isPending={isPending}
              onApprove={handleApprove}
              onUnapprove={handleUnapprove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
