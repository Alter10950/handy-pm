import { ReceivingPanel } from "@/components/materials/receiving-panel";
import {
  getMaterialReceiptTotals,
  getMaterialsReadiness,
  listMaterialReceiptHistoryByProject,
} from "@/lib/materials/queries";
import {
  listMaterialReconciliation,
  listMaterials,
} from "@/lib/projects/queries";

export default async function ProjectReceivingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [materials, reconciliation, receiptTotals, receiptHistory, readiness] =
    await Promise.all([
      listMaterials(id),
      listMaterialReconciliation(id),
      getMaterialReceiptTotals(id),
      listMaterialReceiptHistoryByProject(id),
      getMaterialsReadiness(id),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">Receiving</h2>
      <ReceivingPanel
        projectId={id}
        materials={materials}
        reconciliation={reconciliation}
        receiptTotals={receiptTotals}
        receiptHistory={Object.fromEntries(receiptHistory)}
        readiness={readiness}
      />
    </div>
  );
}
