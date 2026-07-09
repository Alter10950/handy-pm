import type { ProfileRole } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phase E: the read-only tool surface the NL assistant calls.
// The model NEVER sees raw SQL or unscoped data — only these typed
// functions, each of which runs under the caller's own RLS session (so
// org scoping and role limits are enforced by the database, not by the
// prompt) and is additionally gated here by role. Every tool is read-only.
// Where a result points at a real screen, it returns a `link` so answers
// can offer a "show me".

export interface AssistantTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** office-only tools are hidden from crew entirely */
  officeOnly?: boolean;
  run: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResult>;
}

export interface ToolContext {
  role: ProfileRole;
}

export interface ToolResult {
  data: unknown;
  /** optional deep links the UI can render as "show me" */
  links?: { label: string; href: string }[];
}

const OFFICE: ProfileRole[] = ["owner", "pm", "scheduler"];

async function findProjectId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ref: string
): Promise<{ id: string; name: string } | null> {
  // Accept an id or a (fuzzy) name — RLS keeps it org-scoped.
  const byId = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", ref)
    .maybeSingle();
  if (byId.data) return byId.data;
  const byName = await supabase
    .from("projects")
    .select("id, name")
    .ilike("name", `%${ref}%`)
    .limit(1)
    .maybeSingle();
  return byName.data ?? null;
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: "list_projects",
    description:
      "List the org's projects with status and % complete. Use to answer 'which projects…', 'how many active jobs', 'what's the status of…'.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "on_hold", "estimate", "complete"],
          description: "optional status filter",
        },
      },
    },
    run: async (args) => {
      const supabase = await createClient();
      let q = supabase
        .from("project_progress")
        .select("project_id, name, status, pct, deadline");
      const status = args.status;
      if (
        status === "active" ||
        status === "on_hold" ||
        status === "estimate" ||
        status === "complete"
      ) {
        q = q.eq("status", status);
      }
      const { data, error } = await q.limit(100);
      if (error) return { data: { error: error.message } };
      return {
        data: (data ?? []).map((p) => ({
          name: p.name,
          status: p.status,
          percentComplete: Math.round((p.pct ?? 0) * 100),
          deadline: p.deadline,
        })),
        links: (data ?? []).slice(0, 8).map((p) => ({
          label: p.name,
          href: `/app/project/${p.project_id}`,
        })),
      };
    },
  },
  {
    name: "project_status",
    description:
      "Detailed status for ONE project by name or id: % complete, rows done, deadline. Use for 'are we on track for X', 'how far along is X'.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "project name or id" },
      },
      required: ["project"],
    },
    run: async (args) => {
      const supabase = await createClient();
      const found = await findProjectId(supabase, String(args.project ?? ""));
      if (!found) return { data: { error: "No matching project." } };
      const { data } = await supabase
        .from("project_progress")
        .select("*")
        .eq("project_id", found.id)
        .maybeSingle();
      return {
        data: data
          ? {
              name: found.name,
              status: data.status,
              percentComplete: Math.round((data.pct ?? 0) * 100),
              rowsComplete: data.rows_complete,
              rowCount: data.row_count,
              deadline: data.deadline,
            }
          : { name: found.name },
        links: [
          { label: found.name, href: `/app/project/${found.id}` },
        ],
      };
    },
  },
  {
    name: "materials_short",
    description:
      "Materials still needing an order, optionally for one project. Use for 'what's short', 'do we have enough anchors for X', 'which rows are missing materials'.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "optional project name or id to scope to",
        },
      },
    },
    run: async (args) => {
      const supabase = await createClient();
      let projectId: string | null = null;
      let projectName: string | null = null;
      if (typeof args.project === "string" && args.project.trim()) {
        const found = await findProjectId(supabase, args.project);
        if (found) {
          projectId = found.id;
          projectName = found.name;
        }
      }
      let q = supabase
        .from("material_reconciliation")
        .select("project_id, name, to_order")
        .gt("to_order", 0)
        .order("to_order", { ascending: false })
        .limit(50);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) return { data: { error: error.message } };
      return {
        data: (data ?? []).map((r) => ({
          material: r.name,
          toOrder: r.to_order,
        })),
        links:
          projectId && projectName
            ? [
                {
                  label: `${projectName} · Receiving`,
                  href: `/app/project/${projectId}/receiving`,
                },
              ]
            : [],
      };
    },
  },
  {
    name: "rows_missing_materials",
    description:
      "Rows on a project that have no materials assigned yet. Use for 'which rows are missing anchors/materials on X'.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "project name or id" },
      },
      required: ["project"],
    },
    run: async (args) => {
      const supabase = await createClient();
      const found = await findProjectId(supabase, String(args.project ?? ""));
      if (!found) return { data: { error: "No matching project." } };
      const { data: rows } = await supabase
        .from("rows")
        .select("id, label")
        .eq("project_id", found.id);
      const { data: rms } = await supabase
        .from("row_materials")
        .select("row_id")
        .in("row_id", (rows ?? []).map((r) => r.id));
      const withMaterials = new Set((rms ?? []).map((r) => r.row_id));
      const missing = (rows ?? []).filter((r) => !withMaterials.has(r.id));
      return {
        data: {
          project: found.name,
          missingRows: missing.map((r) => r.label),
          missingCount: missing.length,
          totalRows: (rows ?? []).length,
        },
        links: [
          {
            label: `${found.name} · Layout`,
            href: `/app/project/${found.id}/mark`,
          },
        ],
      };
    },
  },
  {
    name: "crew_performance",
    description:
      "Each crew's blended productivity rate and sample size — office-only. Use for 'which crew is fastest', 'how is crew X doing'.",
    officeOnly: true,
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const { getCrewPerformanceSummary } = await import(
        "@/lib/dashboard/queries"
      );
      const crews = await getCrewPerformanceSummary();
      return {
        data: crews.map((c) => ({
          crew: c.crewName,
          rate: c.blendedRate,
          sampleDays: c.totalSamples,
          tier: c.tier,
        })),
        links: crews
          .filter((c) => c.blendedRate !== null)
          .slice(0, 6)
          .map((c) => ({
            label: `${c.crewName} scorecard`,
            href: `/scheduler/crew/${c.crewId}`,
          })),
      };
    },
  },
];

export function toolsForRole(role: ProfileRole): AssistantTool[] {
  const office = OFFICE.includes(role);
  return ASSISTANT_TOOLS.filter((t) => !t.officeOnly || office);
}
