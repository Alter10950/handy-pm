"use client";

import { UploadCloudIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Drag-and-drop + click/keyboard file picker (Phase 11). Wraps a real
// <input type=file> so mobile browsers open the camera/photo sheet; the
// drop surface is progressive enhancement for desktop.
export function FileDropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  label,
  hint,
  className,
  testId,
}: {
  onFiles: (files: File[]) => void;
  /** e.g. "image/*,.pdf" — mirrors the native accept attribute */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** shows a spinner + blocks input while an upload runs */
  busy?: boolean;
  label: string;
  hint?: string;
  className?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const blocked = disabled || busy;

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(multiple ? Array.from(list) : [list[0]]);
  }

  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-label={label}
      aria-disabled={blocked || undefined}
      data-testid={testId}
      onClick={() => !blocked && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (blocked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!blocked) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!blocked) emit(e.dataTransfer.files);
      }}
      className={cn(
        "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        dragOver
          ? "border-brand bg-brand-subtle"
          : "border-border-strong bg-surface-sunken hover:border-brand hover:bg-brand-subtle/50",
        blocked ? "pointer-events-none opacity-60" : "",
        className
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={blocked}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      {busy ? (
        <Spinner className="size-6 text-muted-foreground" />
      ) : (
        <UploadCloudIcon aria-hidden className="size-6 text-muted-foreground" />
      )}
      <div className="text-sm font-medium text-foreground">{label}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
