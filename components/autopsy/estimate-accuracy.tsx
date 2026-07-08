import Link from "next/link";

import type {
  CompanyAutopsyEntry,
  LaborStandardDivergence,
} from "@/lib/autopsy/queries";
import { cn } from "@/lib/utils";

function pctClass(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct > 10) return "text-destructive";
  if (pct < -10) return "text-success-fg";
  return "text-foreground";
}

function pctLabel(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

// The company view: every closed-out project's estimate accuracy in one
// table, plus labor-standard seeds the learned rates say are wrong —
// the feedback loop that makes the next bid sharper (ADR-046).
export function EstimateAccuracy({
  autopsies,
  divergences,
}: {
  autopsies: CompanyAutopsyEntry[];
  divergences: LaborStandardDivergence[];
}) {
  return (
    <div data-testid="estimate-accuracy" className="rounded-lg border border-border bg-card shadow-e1 p-4">
      <h2 className="text-lg font-semibold text-foreground">Estimate accuracy</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Autopsied projects, estimated vs actual — positive means it ran
        over.
      </p>

      {autopsies.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No autopsies yet — generate one from a project&apos;s Progress tab
          at closeout.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Project</th>
                <th className="px-3 pb-2 text-right font-medium">Days</th>
                <th className="px-3 pb-2 text-right font-medium">Labor</th>
                <th className="px-3 pb-2 text-right font-medium">COs</th>
                <th className="pb-2 pl-3 text-right font-medium">Blocked days</th>
              </tr>
            </thead>
            <tbody>
              {autopsies.map((entry) => (
                <tr key={entry.projectId} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/app/project/${entry.projectId}/progress`}
                      className="text-foreground hover:underline"
                    >
                      {entry.projectName}
                    </Link>
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", pctClass(entry.daysPct))}>
                    {pctLabel(entry.daysPct)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      pctClass(entry.laborUnitsPct)
                    )}
                  >
                    {pctLabel(entry.laborUnitsPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {entry.changeOrderCount}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-foreground">
                    {entry.blockerDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {divergences.length > 0 ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium text-foreground">
            Labor standards diverging from learned reality:
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
            {divergences.map((d) => (
              <li key={d.taskKey}>
                <span className="font-medium text-foreground">{d.taskKey}</span>
                : crews average {d.learnedUnitsPerHour} units/hr across{" "}
                {d.crews} crew{d.crews === 1 ? "" : "s"} —{" "}
                {d.divergencePct > 0
                  ? `the seed looks ~${d.divergencePct}% pessimistic`
                  : `quotes will run ~${Math.abs(d.divergencePct)}% over at this seed`}
                . Adjust it in the labor standards below.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
