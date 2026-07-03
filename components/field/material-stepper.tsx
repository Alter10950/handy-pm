"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/supabase/database.types";

export function MaterialStepper({
  rowId,
  rowLabel,
  material,
  required,
  installed,
  onLog,
}: {
  rowId: string;
  rowLabel: string;
  material: Tables<"materials">;
  required: number;
  installed: number;
  onLog: (
    rowId: string,
    rowLabel: string,
    materialId: string,
    materialName: string,
    qty: number
  ) => Promise<"logged" | "queued">;
}) {
  const [qty, setQty] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  async function commit(sign: 1 | -1) {
    const result = await onLog(
      rowId,
      rowLabel,
      material.id,
      material.name,
      qty * sign
    );
    setStatus(result === "queued" ? "Queued — will sync" : "Logged");
    setQty(1);
    setTimeout(() => setStatus(null), 2000);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{material.name}</span>
        <span className="text-sm text-muted-foreground">
          {installed} / {required} {material.unit}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
        >
          −
        </Button>
        <span className="w-10 text-center text-lg font-semibold tabular-nums text-foreground">
          {qty}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => setQty((q) => q + 1)}
        >
          +
        </Button>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          onClick={() => void commit(1)}
        >
          Log +{qty}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void commit(-1)}
        >
          Correct −{qty}
        </Button>
      </div>
      {status ? (
        <p className="text-xs text-muted-foreground">{status}</p>
      ) : null}
    </div>
  );
}
