"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { pasteMaterialList } from "@/lib/projects/actions";

export function PasteMaterialsDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await pasteMaterialList(projectId, text, replaceExisting);
        setText("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not add materials."
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        ⬆ Paste from packing slip
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paste from packing slip</DialogTitle>
          <DialogDescription>
            One material per line, quantity at the end. Commas, tabs, or spaces
            all work — e.g. &ldquo;Upright frame, 220&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"Upright frame, 220\nBeam 96in, 1500\nWire deck, 760"}
          className="min-h-40 w-full rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        />

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(event) => setReplaceExisting(event.target.checked)}
            className="size-4 rounded border-border"
          />
          Replace the current list
        </label>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={submit}
            disabled={isPending || !text.trim()}
          >
            {isPending ? "Adding..." : "Add materials"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
