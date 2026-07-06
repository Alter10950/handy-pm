"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { recordOrgLogo } from "@/lib/org/actions";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "uploading" | "error";

export function OrgLogoUpload({
  orgId,
  currentLogoUrl,
}: {
  orgId: string;
  currentLogoUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setStatus("uploading");
    setMessage(null);
    try {
      const supabase = createClient();
      const path = `${orgId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from("org-logos")
        .upload(path, file);
      if (error) throw error;

      await recordOrgLogo(path);
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Could not upload that file."
      );
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <div className="flex items-center gap-3">
        {currentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed URL to Storage; next/image's remote-pattern allowlist isn't worth configuring for one org-scoped logo.
          <img
            src={currentLogoUrl}
            alt="Organization logo"
            className="h-12 w-12 rounded-md border border-border object-contain bg-card"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            None
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={status === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {status === "uploading"
            ? "Uploading..."
            : currentLogoUrl
              ? "Replace logo"
              : "Upload logo"}
        </Button>
      </div>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
