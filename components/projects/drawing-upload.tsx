"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { renderFileToPages } from "@/lib/pdf/render-drawing-file";
import { recordDrawingUpload } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "rendering" | "uploading" | "error";

export function DrawingUpload({
  projectId,
  existingPageCount,
}: {
  projectId: string;
  existingPageCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setStatus("rendering");
    setMessage(null);
    try {
      const pages = await renderFileToPages(file);
      setStatus("uploading");

      const supabase = createClient();
      const uploaded: {
        storagePath: string;
        pageIndex: number;
        width: number;
        height: number;
      }[] = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageIndex = existingPageCount + i;
        const path = `${projectId}/${Date.now()}-page${pageIndex}.jpg`;
        const { error } = await supabase.storage
          .from("drawings")
          .upload(path, page.blob, { contentType: "image/jpeg" });
        if (error) throw error;
        uploaded.push({
          storagePath: path,
          pageIndex,
          width: page.width,
          height: page.height,
        });
      }

      await recordDrawingUpload(projectId, uploaded);
      setMessage(
        `${uploaded.length} page${uploaded.length === 1 ? "" : "s"} uploaded.`
      );
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Could not process that file."
      );
    }
  }

  const busy = status === "rendering" || status === "uploading";

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        data-testid="drawing-upload-input"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        size="lg"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {status === "rendering"
          ? "Rendering..."
          : status === "uploading"
            ? "Uploading..."
            : existingPageCount > 0
              ? "Add more pages"
              : "Upload layout (PDF or image)"}
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
