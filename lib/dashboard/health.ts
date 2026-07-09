import {
  listActiveProjectsForDashboard,
  listShortagesAcrossProjects,
} from "@/lib/dashboard/queries";
import { listOverriddenStages } from "@/lib/gates/queries";

// Project health rollup (design pass v3 F2): SPI + gate overrides +
// material shortages folded into one green/amber/red badge shown on every
// project card and table row. Rules are deliberately explainable — the
// reasons array becomes the badge's tooltip:
//   red   = SPI in the 'risk' tier
//   amber = SPI 'watch', any open shortage, or any overridden gate
//   green = none of the above

export type HealthTier = "green" | "amber" | "red";

export interface ProjectHealth {
  tier: HealthTier;
  reasons: string[];
}

export async function computeProjectHealthMap(): Promise<
  Record<string, ProjectHealth>
> {
  try {
    const [projects, shortages, overrides] = await Promise.all([
      listActiveProjectsForDashboard(),
      listShortagesAcrossProjects(),
      listOverriddenStages(),
    ]);

    const shortageCount = new Map<string, number>();
    for (const s of shortages) {
      shortageCount.set(s.projectId, (shortageCount.get(s.projectId) ?? 0) + 1);
    }
    const overrideCount = new Map<string, number>();
    for (const o of overrides) {
      overrideCount.set(o.projectId, (overrideCount.get(o.projectId) ?? 0) + 1);
    }

    const map: Record<string, ProjectHealth> = {};
    for (const project of projects) {
      const reasons: string[] = [];
      let tier: HealthTier = "green";
      if (project.riskTier === "risk") {
        tier = "red";
        reasons.push(`Behind schedule (SPI ${project.spi?.toFixed(2)})`);
      } else if (project.riskTier === "watch") {
        tier = "amber";
        reasons.push(
          project.spi !== null
            ? `Schedule watch (SPI ${project.spi.toFixed(2)})`
            : "No schedule targets yet"
        );
      }
      const shorts = shortageCount.get(project.projectId) ?? 0;
      if (shorts > 0) {
        if (tier === "green") tier = "amber";
        reasons.push(`${shorts} material${shorts === 1 ? "" : "s"} short`);
      }
      const overridden = overrideCount.get(project.projectId) ?? 0;
      if (overridden > 0) {
        if (tier === "green") tier = "amber";
        reasons.push(
          `${overridden} gate${overridden === 1 ? "" : "s"} overridden`
        );
      }
      if (reasons.length === 0) reasons.push("On track");
      map[project.projectId] = { tier, reasons };
    }
    return map;
  } catch {
    // Crew-scoped sessions can't read every input — the badge simply
    // doesn't render rather than breaking the Projects page.
    return {};
  }
}
