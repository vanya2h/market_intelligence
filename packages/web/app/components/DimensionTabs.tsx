import { useState } from "react";
import type { BriefDimension } from "@market-intel/api";
import { DIMENSION_TABS, TAB_LABELS } from "./BriefSidebar";
import { DimensionCard } from "./DimensionCard";
import { TabBar } from "./TabBar";

interface DimensionTabsProps {
  dimensions: BriefDimension[];
}

export function DimensionTabs({ dimensions }: DimensionTabsProps) {
  const availableDims = DIMENSION_TABS.filter((dim) => dimensions.some((d) => d.dimension === dim));

  const [activeTab, setActiveTab] = useState<string>(availableDims[0] ?? "DERIVATIVES");

  return (
    <>
      {/* Dimension tabs */}
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <TabBar
          items={availableDims.map((dim) => ({ key: dim, label: TAB_LABELS[dim] }))}
          activeKey={activeTab}
          onSelect={setActiveTab}
          className="overflow-x-auto px-3 md:px-5"
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 p-3 md:p-5">
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
