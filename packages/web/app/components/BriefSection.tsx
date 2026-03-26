import type { Brief } from "@market-intel/api";
import { PriceDelta } from "./PriceDelta";
import { RichBriefRenderer } from "./RichBrief";

interface BriefSectionProps {
  brief: Brief;
}

export function BriefSection({ brief }: BriefSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      {brief.snapshotPrice != null && (
        <PriceDelta asset={brief.asset} snapshotPrice={brief.snapshotPrice} timestamp={brief.timestamp} />
      )}
      {brief.richBrief?.blocks && <RichBriefRenderer blocks={brief.richBrief.blocks} />}
    </div>
  );
}
