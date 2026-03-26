import { PriceDelta } from "./PriceDelta";
import { RichBriefRenderer } from "./RichBrief";
import type { RichBlock } from "./rich-brief-types";

interface BriefSectionProps {
  brief: {
    id: string;
    richBrief?: { blocks: RichBlock[] } | null;
    snapshotPrice?: number | null;
    timestamp: string;
  };
  asset: "BTC" | "ETH";
}

export function BriefSection({ brief, asset }: BriefSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      {brief.snapshotPrice != null && (
        <PriceDelta asset={asset} snapshotPrice={brief.snapshotPrice} briefTimestamp={brief.timestamp} />
      )}
      {brief.richBrief?.blocks && <RichBriefRenderer blocks={brief.richBrief.blocks} />}
    </div>
  );
}
