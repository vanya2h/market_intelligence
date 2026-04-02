import { useState } from "react";
import type { BriefDimension } from "@market-intel/api";
import { DimensionCard } from "./DimensionCard";
import { TabBar } from "./TabBar";
import { DIMENSIONS, DIMENSION_LABELS } from "../lib/dimensions";

interface DimensionTabsProps {
  dimensions: BriefDimension[];
}

export function DimensionTabs({ dimensions }: DimensionTabsProps) {
  const availableDims = DIMENSIONS.filter((dim) => dimensions.some((d) => d.dimension === dim));

  const [activeTab, setActiveTab] = useState(availableDims[0] ?? "DERIVATIVES");

  return (
    <>
      {/* Dimension tabs */}
      <div
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
        className="h-10 px-2 rounded-t-md"
      >
        <TabBar
          items={availableDims.map((dim) => ({
            key: dim,
            label: DIMENSION_LABELS[dim],
          }))}
          activeKey={activeTab}
          onSelect={(x) => setActiveTab(x as (typeof availableDims)[0])}
          className="overflow-x-auto h-full"
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 p-3 md:p-5 rounded-b-md" style={{ background: "var(--bg-card)" }}>
        {availableDims.map((dim) => {
          const bd = dimensions.find((d) => d.dimension === dim);
          if (!bd) return null;

          return (
            <DimensionCard
              key={dim}
              dimension={dim}
              regime={bd.regime}
              context={bd.context}
              interpretation={bd.interpretation}
              isActive={activeTab === dim}
            />
          );
        })}
      </div>
    </>
  );
}
