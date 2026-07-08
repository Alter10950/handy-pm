"use client";

import { useRef, useState } from "react";

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
export function VoiceNoteRecorder({
  onDraft,
}: {
  onDraft: (draft: VoiceNoteDraft) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SpeechRecognitionCtor = getSpeechRecognitionCtor();

  async function processTranscript(transcript: string) {
    setStatus("processing");
    try {
      const response = await fetch("/api/field/voice-note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not process that note.");
      }
      onDraft(data as VoiceNoteDraft);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Could not process that note."
      );
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
