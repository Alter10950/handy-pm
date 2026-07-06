import { ProjectEstimatePanel } from "@/components/estimating/project-estimate-panel";
import { computeProjectEstimate, listProjectEstimates } from "@/lib/estimating/queries";
import { listCrews } from "@/lib/crews/queries";

export default async function ProjectEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [estimate, history, crews] = await Promise.all([
    computeProjectEstimate(id),
    listProjectEstimates(id),
    listCrews(),
  ]);

  return (
    <ProjectEstimatePanel
      projectId={id}
      initialEstimate={estimate}
      history={history}
      crews={crews}
      aiExplainAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
