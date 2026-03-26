import { useState } from "react";
import { DIMENSION_TABS, TAB_LABELS } from "./BriefSidebar";
import { DimensionCard } from "./DimensionCard";

interface BriefDimension {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
}

interface DimensionTabsProps {
  dimensions: BriefDimension[];
}

export function DimensionTabs({ dimensions }: DimensionTabsProps) {
  const availableDims = DIMENSION_TABS.filter((dim) => dimensions.some((d) => d.dimension === dim));

  const [activeTab, setActiveTab] = useState<string>(availableDims[0] ?? "DERIVATIVES");

  return (
    <>
      {/* Dimension tabs */}
      <div
        className="flex items-center gap-0 overflow-x-auto px-3 md:px-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {availableDims.map((dim) => {
          const isActive = activeTab === dim;
          return (
            <button
              key={dim}
              onClick={() => setActiveTab(dim)}
              className={`relative shrink-0 px-3 py-3 text-xs font-medium tracking-wide transition-colors md:px-4 ${isActive ? "tab-active" : ""}`}
              style={{
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {TAB_LABELS[dim]}
            </button>
          );
        })}
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
