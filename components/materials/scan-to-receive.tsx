"use client";

import { ScanLineIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Batch 5 Sub-phase C(1): camera-based scan-to-receive. Uses the browser
// BarcodeDetector API (Chrome/Android — works as a PWA); when it isn't
// available the button still opens a manual code-entry box, and the
// panel's own per-material check-in form always remains. On a successful
// scan it calls onScan(materialId) so the panel can jump to that line.

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

function getDetector(): BarcodeDetectorLike | null {
  const w = window as unknown as {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  };
  if (!w.BarcodeDetector) return null;
  try {
    return new w.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function ScanToReceive({
  knownIds,
  onScan,
}: {
  /** valid material ids for this project — a scan must match one */
  knownIds: string[];
  onScan: (materialId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [cameraOk, setCameraOk] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const known = new Set(knownIds);

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    const detector = getDetector();
    let cancelled = false;

    (async () => {
      if (!detector) {
        setStatus("Camera scanning isn't supported here — type the code below.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraOk(true);
          setStatus("Point at a material label…");
        }
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => known.has(c.rawValue));
            if (hit) {
              setStatus("Matched.");
              onScan(hit.rawValue);
              setOpen(false);
              return;
            }
            if (codes.length > 0) {
              setStatus("That code isn't a material on this project.");
            }
          } catch {
            // transient decode error — keep scanning
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setStatus(
          "Couldn't open the camera — type the code below, or use the manual check-in."
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submitManual() {
    const value = manual.trim();
    if (known.has(value)) {
      onScan(value);
      setOpen(false);
      setManual("");
    } else {
      setStatus("No material on this project has that code.");
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="scan-to-receive"
        onClick={() => {
          setStatus(null);
          setCameraOk(false);
          setOpen(true);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-muted"
      >
        <ScanLineIcon aria-hidden className="size-4" />
        Scan
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scan a material label"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-e4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                Scan a label
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>

            <div className="overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                className={cameraOk ? "aspect-square w-full object-cover" : "hidden"}
              />
            </div>

            {status ? (
              <p className="mt-2 text-sm text-muted-foreground">{status}</p>
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="…or paste a code"
                className="h-9 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitManual();
                }}
              />
              <button
                type="button"
                onClick={submitManual}
                disabled={!manual.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-e1 disabled:opacity-50"
              >
                Go
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
