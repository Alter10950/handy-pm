"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { BlockerCode } from "@/lib/supabase/database.types";

type Status = "idle" | "recording" | "processing" | "error";

export interface VoiceNoteDraft {
  cleanedNote: string;
  isBlocker: boolean;
  blockerCode: BlockerCode | null;
}

// The Web Speech API has no official TS lib types (still vendor-prefixed
// on some browsers, unsupported on others — iOS Safari historically had
// no/limited SpeechRecognition support) — this is a minimal ambient
// shape covering only what this component actually reads/calls.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Voice-to-note: transcribes speech to text entirely client-side (no
// network round-trip, no extra API key needed for that half), then sends
// just the transcript to /api/field/voice-note for Claude to clean up
// into a draft — which the crew reviews before it's saved anywhere. Never
// renders on a browser without SpeechRecognition support, rather than
// showing a button that would always fail.
// Batch 5 Sub-phase C(2): transcripts captured while offline are queued
// and parsed on reconnect, so a crew's voice note is never lost in a dead
// spot on the warehouse floor.
const QUEUE_KEY = "handy-pm:voice-queue";
function readQueue(): string[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function writeQueue(items: string[]) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function VoiceNoteRecorder({
  onDraft,
}: {
  onDraft: (draft: VoiceNoteDraft) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(() =>
    typeof window === "undefined" ? 0 : readQueue().length
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SpeechRecognitionCtor = getSpeechRecognitionCtor();

  async function parseTranscript(transcript: string): Promise<VoiceNoteDraft> {
    const response = await fetch("/api/field/voice-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Could not process that note.");
    }
    return data as VoiceNoteDraft;
  }

  const drainQueue = useCallback(async () => {
    const items = readQueue();
    if (items.length === 0) return;
    const remaining = [...items];
    for (const transcript of items) {
      try {
        const draft = await parseTranscript(transcript);
        onDraft(draft);
        remaining.shift();
        writeQueue(remaining);
        setQueued(remaining.length);
      } catch {
        break; // still offline / server down — keep the rest queued
      }
    }
  }, [onDraft]);

  useEffect(() => {
    // Deferred so any state updates land after this effect, not
    // synchronously inside it.
    const initial = window.setTimeout(() => void drainQueue(), 0);
    const onOnline = () => void drainQueue();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("online", onOnline);
    };
  }, [drainQueue]);

  async function processTranscript(transcript: string) {
    setStatus("processing");
    // Offline up front → queue immediately, don't even try the round-trip.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const next = [...readQueue(), transcript];
      writeQueue(next);
      setQueued(next.length);
      setStatus("idle");
      setError(null);
      return;
    }
    try {
      const draft = await parseTranscript(transcript);
      onDraft(draft);
      setStatus("idle");
    } catch (err) {
      // A network failure (vs. a real API error) → queue for reconnect.
      const offlineish =
        err instanceof TypeError ||
        (typeof navigator !== "undefined" && navigator.onLine === false);
      if (offlineish) {
        const next = [...readQueue(), transcript];
        writeQueue(next);
        setQueued(next.length);
        setStatus("idle");
        setError(null);
      } else {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Could not process that note."
        );
      }
    }
  }

  function startRecording() {
    if (!SpeechRecognitionCtor) return;
    setError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      void processTranscript(transcript);
    };
    recognition.onerror = () => {
      setStatus("error");
      setError("Couldn't hear that — try again.");
    };
    recognition.onend = () => {
      setStatus((current) => (current === "recording" ? "idle" : current));
    };
    recognitionRef.current = recognition;
    recognition.start();
    setStatus("recording");
  }

  if (!SpeechRecognitionCtor) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        disabled={status === "processing"}
        onClick={() =>
          status === "recording"
            ? recognitionRef.current?.stop()
            : startRecording()
        }
      >
        {status === "recording"
          ? "⏹ Stop recording"
          : status === "processing"
            ? "Processing..."
            : "🎤 Voice note"}
      </Button>
      {queued > 0 ? (
        <p className="text-xs text-warning-fg">
          {queued} note{queued === 1 ? "" : "s"} queued — will process when
          you&apos;re back online.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
