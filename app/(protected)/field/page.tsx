import type { Metadata } from "next";

import { FieldHome } from "@/components/field/field-home";
import { listCrews } from "@/lib/crews/queries";
import {
  getMyCrewId,
  listActiveProjectsForField,
  listTodayAssignments,
} from "@/lib/field/queries";

export const metadata: Metadata = {
  title: "Field — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function FieldPage() {
  const [projects, todayAssignments, crews, myCrewId] = await Promise.all([
    listActiveProjectsForField(),
    listTodayAssignments(),
    listCrews(),
    getMyCrewId(),
  ]);

  return (
    <FieldHome
      projects={projects}
      todayAssignments={todayAssignments}
      crews={crews}
      myCrewId={myCrewId}
    />
  );
}
