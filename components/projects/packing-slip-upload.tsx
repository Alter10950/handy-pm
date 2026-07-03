"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PackingSlipExtractDialog } from "@/components/projects/packing-slip-extract-dialog";
import { recordPackingSlipUpload } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "uploading" | "error";

export function PackingSlipUpload({ projectId }: { projectId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setStatus("uploading");
    setMessage(null);
    try {
      const supabase = createClient();
      const path = `${projectId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from("packing-slips")
        .upload(path, file);
      if (error) throw error;

      await recordPackingSlipUpload(projectId, path);
      setMessage(`Uploaded ${file.name}.`);
      setUploaded({ path, name: file.name });
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
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={status === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {status === "uploading" ? "Uploading..." : "Upload packing slip"}
        </Button>
        {uploaded ? (
          <PackingSlipExtractDialog
            projectId={projectId}
            storagePath={uploaded.path}
            slipName={uploaded.name}
          />
        ) : null}
      </div>
      {message ? (
        <p
          data-testid="packing-slip-upload-message"
          className={
            status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
