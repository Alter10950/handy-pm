"use client";

import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Batch 5 Sub-phase E: the "Ask" box. Posts a question to the read-only,
// role-scoped assistant and shows the answer with "show me" links to the
// real screens. Opens from the top-bar button or the `handy-pm:open-ask`
// event (so ⌘K / other surfaces can trigger it).

interface AskResult {
  answer: string;
  links: { label: string; href: string }[];
}

const EXAMPLES = [
  "Which projects are behind schedule?",
  "What's short on Bingo Warehouse?",
  "Which rows are missing materials?",
];

export function AskDialog() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("handy-pm:open-ask", onOpen);
    return () => window.removeEventListener("handy-pm:open-ask", onOpen);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't answer that.");
      setResult({ answer: data.answer, links: data.links ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="assistant-open"
        aria-label="Ask the assistant"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
      >
        <SparklesIcon aria-hidden className="size-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SparklesIcon aria-hidden className="size-4 text-brand" />
              Ask
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
            className="flex items-center gap-2"
          >
            <Input
              ref={inputRef}
              data-testid="assistant-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about projects, materials, crews…"
              className="flex-1"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-e1 disabled:opacity-50"
            >
              {loading ? "Thinking…" : "Ask"}
            </button>
          </form>

          {!result && !loading && !error ? (
            <div className="flex flex-col gap-1.5">
              <p className="type-overline text-muted-foreground">Try</p>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setQuestion(ex);
                    void ask(ex);
                  }}
                  className="rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-accent hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              <p
                data-testid="assistant-answer"
                className="whitespace-pre-wrap rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-sm text-foreground"
              >
                {result.answer}
              </p>
              {result.links.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="type-overline text-muted-foreground">Show me</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-info-fg shadow-e1 hover:underline"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                Answers come only from your data (scoped to what your role can
                see) — double-check before acting on anything material.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
