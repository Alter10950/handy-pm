import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { CloseoutPdfDocument, type CloseoutPdfData } from "@/lib/pdf/closeout-pdf";
import { createClient } from "@/lib/supabase/server";

const PDF_VIEWERS = ["owner", "pm"] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(PDF_VIEWERS);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not signed in." },
      { status: 401 }
    );
  }

  const { id: projectId } = await params;
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("project_progress")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const [
    { data: fullProject, error: fullProjectError },
    { data: org, error: orgError },
    { data: reconciliation, error: reconError },
    { data: blockers, error: blockersError },
    { data: markingDrawing, error: drawingError },
    { data: dayLogs, error: dayLogsError },
    { data: changeOrders, error: changeOrdersError },
  ] = await Promise.all([
    supabase.from("projects").select("site_address, created_at").eq("id", projectId).single(),
    supabase.from("organizations").select("name, address, logo_path").eq("id", project.org_id).single(),
    supabase
      .from("material_reconciliation")
      .select("name, needed, received, assigned, installed, left_qty, to_order")
      .eq("project_id", projectId)
      .order("name"),
    supabase
      .from("blockers")
      .select("code, note, work_date, resolved_at")
      .eq("project_id", projectId)
      .order("work_date"),
    supabase
      .from("drawings")
      .select("storage_path")
      .eq("project_id", projectId)
      .eq("role", "marking")
      .maybeSingle(),
    supabase
      .from("day_logs")
      .select("work_date, crew_id, arrived_at, departed_at, note")
      .eq("project_id", projectId)
      .order("work_date"),
    supabase
      .from("change_orders")
      .select("number, title, status, added_days, price, customer_approved_via, customer_approved_at")
      .eq("project_id", projectId)
      .order("number"),
  ]);
  if (fullProjectError) throw fullProjectError;
  if (orgError) throw orgError;
  if (reconError) throw reconError;
  if (blockersError) throw blockersError;
  if (drawingError) throw drawingError;
  if (dayLogsError) throw dayLogsError;
  if (changeOrdersError) throw changeOrdersError;

  const { data: autopsy, error: autopsyError } = await supabase
    .from("project_autopsies")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (autopsyError) throw autopsyError;

  const crewIds = [
    ...new Set(dayLogs.map((log) => log.crew_id).filter((id): id is string => id !== null)),
  ];
  const { data: crews, error: crewsError } =
    crewIds.length > 0
      ? await supabase.from("crews").select("id, name").in("id", crewIds)
      : { data: [] as { id: string; name: string }[], error: null };
  if (crewsError) throw crewsError;
  const crewNameById = new Map(crews.map((c) => [c.id, c.name]));

  const [drawingUrlResult, logoUrlResult] = await Promise.all([
    markingDrawing
      ? supabase.storage.from("drawings").createSignedUrl(markingDrawing.storage_path, 3600)
      : Promise.resolve({ data: null, error: null }),
    org.logo_path
      ? supabase.storage.from("org-logos").createSignedUrl(org.logo_path, 3600)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const data: CloseoutPdfData = {
    orgName: org.name,
    orgAddress: org.address,
    orgLogoUrl: logoUrlResult.data?.signedUrl ?? null,
    projectName: project.name,
    projectAddress: fullProject.site_address,
    createdAt: fullProject.created_at,
    pct: project.pct,
    drawingUrl: drawingUrlResult.data?.signedUrl ?? null,
    reconciliation: reconciliation.map((row) => ({
      name: row.name,
      needed: row.needed,
      received: row.received,
      assigned: row.assigned,
      installed: row.installed,
      leftQty: row.left_qty,
      toOrder: row.to_order,
    })),
    blockers: blockers.map((b) => ({
      code: b.code,
      note: b.note,
      workDate: b.work_date,
      resolvedAt: b.resolved_at,
    })),
    dayLogs: dayLogs.map((log) => ({
      workDate: log.work_date,
      crewName: log.crew_id ? (crewNameById.get(log.crew_id) ?? "Unknown crew") : "—",
      arrivedAt: log.arrived_at,
      departedAt: log.departed_at,
      note: log.note,
    })),
    changeOrders: changeOrders.map((co) => ({
      number: co.number,
      title: co.title,
      status: co.status,
      addedDays: co.added_days,
      price: co.price,
      approvedVia: co.customer_approved_via,
      approvedAt: co.customer_approved_at,
    })),
    autopsy: autopsy
      ? {
          estimatedDays: autopsy.estimated_days,
          actualDays: autopsy.actual_days,
          estimatedHours: autopsy.estimated_hours,
          actualLaborHours: autopsy.actual_labor_hours,
          estimatedLaborUnits: autopsy.estimated_labor_units,
          actualLaborUnits: autopsy.actual_labor_units,
          changeOrderCount: autopsy.change_order_count,
          changeOrderDays: autopsy.change_order_days,
          blockerDays: autopsy.blocker_days,
          narrative: autopsy.narrative,
        }
      : null,
  };

  const buffer = await renderToBuffer(<CloseoutPdfDocument data={data} />);
  const fileName = `${project.name.replace(/[^a-z0-9]+/gi, "-")}-closeout.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });
}
