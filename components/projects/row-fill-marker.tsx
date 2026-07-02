import { cn } from "@/lib/utils";

// Shared visual content for a marked row: the proportional fill bar,
// centered label + %, and the hazard indicator for rows with no material
// assigned. Used by both RowStage (editable) and MaterialsReferenceStage
// (read-only) so the two views always render a row identically.
export function RowFillMarker({
  label,
  pct,
  hasMaterials,
  isComplete,
  isVertical,
}: {
  label: string;
  pct: number;
  hasMaterials: boolean;
  isComplete: boolean;
  isVertical: boolean;
}) {
  const pctInt = Math.round(pct * 100);

  return (
    <>
      <div
        className={cn("absolute bg-primary/55", isComplete && "bg-success/60")}
        style={
          isVertical
            ? { left: 0, bottom: 0, width: "100%", height: `${pctInt}%` }
            : { left: 0, bottom: 0, height: "100%", width: `${pctInt}%` }
        }
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-0.5 text-center text-[10px] font-extrabold leading-tight text-[#06121f] [text-shadow:0_1px_2px_rgba(255,255,255,.5)]">
        <span>{label}</span>
        <span>{hasMaterials ? `${pctInt}%` : "⚠"}</span>
      </div>
      {!hasMaterials ? (
        <span className="absolute right-0.5 top-0.5 text-xs drop-shadow-[0_1px_1px_rgba(0,0,0,.6)]">
          ⚠️
        </span>
      ) : null}
    </>
  );
}
