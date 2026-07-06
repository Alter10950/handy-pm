import { cn } from "@/lib/utils";
import type { Views } from "@/lib/supabase/database.types";

export function ReconciliationCard({
  reconciliation,
  overallPct,
}: {
  reconciliation: Views<"material_reconciliation">[];
  overallPct: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Reconciliation
        </h3>
        <span className="text-lg font-bold tabular-nums text-foreground">
          {Math.round(overallPct * 100)}% complete
        </span>
      </div>

      {reconciliation.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Add materials to see reconciliation.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="reconciliation-table" className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Part</th>
                <th className="px-3 py-2 text-right font-medium">Installed</th>
                <th className="px-3 py-2 text-right font-medium">Assigned</th>
                <th className="px-3 py-2 text-right font-medium">Needed</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="py-2 pl-3 text-right font-medium">To order</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row) => {
                const mismatched = row.assigned !== row.needed;
                const needsOrder = row.to_order > 0;
                return (
                  <tr
                    key={row.material_id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="py-2 pr-3 text-foreground">{row.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.installed}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        mismatched ? "text-warning" : "text-foreground"
                      )}
                    >
                      {row.assigned}
                      {mismatched ? " ⚠" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.needed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.received}
                    </td>
                    <td
                      className={cn(
                        "py-2 pl-3 text-right tabular-nums",
                        needsOrder ? "text-destructive" : "text-success"
                      )}
                    >
                      {row.to_order}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
