"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  importDealAsProject,
  listImportableDeals,
  type ImportableDeal,
} from "@/lib/integrations/zoho-actions";

// Batch 5 Sub-phase G: one-click import of a won Zoho deal into a
// pre-filled project. Gated — when Zoho isn't connected it points to
// Settings; manual project creation (the sibling "New project" button) is
// untouched.
export function ImportFromZohoDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [deals, setDeals] = useState<ImportableDeal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function load() {
    setOpen(true);
    setLoading(true);
    try {
      const result = await listImportableDeals();
      setConnected(result.connected);
      setDeals(result.deals);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load deals.");
    } finally {
      setLoading(false);
    }
  }

  function importDeal(deal: ImportableDeal) {
    setBusyId(deal.id);
    startTransition(async () => {
      try {
        const projectId = await importDealAsProject(deal.id);
        toast.success(`Imported ${deal.dealName}.`);
        setOpen(false);
        router.push(`/app/project/${projectId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed.");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        data-testid="import-from-zoho"
        onClick={() => void load()}
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-muted"
      >
        Import from Zoho
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a won deal</DialogTitle>
            <DialogDescription>
              Turn a Closed-Won Zoho deal into a project, pre-filled and
              linked so status flows back to the deal.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading deals…
            </p>
          ) : !connected ? (
            <div className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-3 text-sm text-foreground">
              Zoho isn&apos;t connected yet. An owner can connect it in{" "}
              <a
                href="/app/settings"
                className="font-medium text-info-fg hover:underline"
              >
                Settings → Integrations
              </a>
              . Until then, use{" "}
              <span className="font-medium">New project</span> to create one by
              hand.
            </div>
          ) : deals.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No Closed-Won deals waiting to import.
            </p>
          ) : (
            <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-auto">
              {deals.map((deal) => (
                <li
                  key={deal.id}
                  className="flex items-center gap-2 rounded-md border border-border p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {deal.accountName
                        ? `${deal.accountName} — ${deal.dealName}`
                        : deal.dealName}
                    </p>
                    <p className="num text-xs text-muted-foreground">
                      {deal.amount != null
                        ? deal.amount.toLocaleString(undefined, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : "no amount"}
                      {deal.address ? ` · ${deal.address}` : ""}
                    </p>
                  </div>
                  {deal.alreadyImported ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Imported
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isPending && busyId === deal.id}
                      onClick={() => importDeal(deal)}
                      className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-e1 disabled:opacity-50"
                    >
                      {isPending && busyId === deal.id ? "Importing…" : "Import"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
