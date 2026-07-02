"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { recordPackingSlipUpload } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "uploading" | "error";

export function PackingSlipUpload({ projectId }: { projectId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
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
      <Button
        type="button"
        variant="outline"
        disabled={status === "uploading"}
        onClick={() => inputRef.current?.click()}
      >
        {status === "uploading" ? "Uploading..." : "Upload packing slip"}
      </Button>
      {message ? (
        <p
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
