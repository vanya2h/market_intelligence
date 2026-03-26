import { SentimentGauge } from "./SentimentGauge";
import { SectionBlock } from "./SectionBlock";
import { Tooltip } from "./Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { regimeColor } from "../lib/regime-colors";

export const DIMENSION_TABS = ["DERIVATIVES", "ETFS", "SENTIMENT", "HTF"] as const;
export type DimensionTab = (typeof DIMENSION_TABS)[number];

export const TAB_LABELS: Record<DimensionTab, string> = {
  DERIVATIVES: "Derivatives",
  ETFS: "ETFs",
  SENTIMENT: "Sentiment",
  HTF: "HTF Structure",
};

export interface BriefSidebarData {
  compositeIndex: number | null;
  compositeLabel: string | null;
  dimensions: { dimension: string; regime: string }[];
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
}

export function BriefSidebar({ brief }: { brief: BriefSidebarData }) {
  const { compositeIndex, compositeLabel, dimensions, positioning, trend, institutionalFlows, expertConsensus } = brief;
  return (
    <aside
      className="sticky top-19 hidden w-72 shrink-0 flex-col overflow-y-auto p-5 md:flex"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-card)",
        height: "calc(100vh - 4.75rem)",
      }}
    >
      {compositeIndex != null && compositeLabel && (
        <SectionBlock
          title="Composite Fear & Greed Index"
          className="mb-6"
          tooltip="Proprietary Fear & Greed index (0–100) built from four crypto-native inputs: derivatives positioning (30%), HTF trend (25%), analyst consensus (25%), ETF institutional flows (20%). Avoids Alternative.me's opaque methodology."
        >
          <SentimentGauge value={compositeIndex} label={compositeLabel} />
        </SectionBlock>
      )}

      <SectionBlock title="Regime Overview" className="mb-6">
        <div className="space-y-1">
          {DIMENSION_TABS.map((dim) => {
            const bd = dimensions.find((d) => d.dimension === dim);
            if (!bd) return null;
            const { color, arrow } = regimeColor(bd.regime);
            return (
              <div
                key={dim}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {TAB_LABELS[dim]}
                </span>
                <span className="text-xs font-medium" style={{ color }}>
                  {bd.regime} {arrow}
                </span>
              </div>
            );
          })}
        </div>
      </SectionBlock>

      <SectionBlock title="Overview">
        <div className="space-y-1">
          {[
            {
              label: "Positioning",
              value: positioning,
              tooltip: "Derivatives positioning score (0–100). Derived from funding rates, long/short ratio, and open interest percentiles. High = crowded longs / greed. Low = crowded shorts / fear.",
            },
            {
              label: "Trend",
              value: trend,
              tooltip: "HTF trend score (0–100). Derived from price vs 50/200 SMA, daily RSI, and market structure (HH/HL vs LH/LL). High = bullish macro structure.",
            },
            {
              label: "Inst. Flows",
              value: institutionalFlows,
              tooltip: "Institutional flows score (0–100). Derived from spot ETF daily net flows and streak length. Multi-day inflow streaks signal conviction. Outflows signal cooling appetite.",
            },
            {
              label: "Expert Cons.",
              value: expertConsensus,
              tooltip: "Expert consensus score (0–100). Derived from accuracy-weighted analyst consensus via unbias API. Z-score ≥ +0.8 = bullish conviction. Z-score ≤ −1.5 = bearish conviction.",
            },
          ].map(({ label, value, tooltip }) => {
            if (value == null) return null;
            const color = value < 30 ? "var(--red)" : value > 70 ? "var(--green)" : "var(--amber)";
            return (
              <div
                key={label}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <Tooltip content={tooltip} side="right">
                  <span className="inline-flex cursor-default items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {label}
                    <InfoCircledIcon width={11} height={11} />
                  </span>
                </Tooltip>
                <span className="font-mono-jb text-xs font-medium tabular-nums" style={{ color }}>
                  {Math.round(value)}
                </span>
              </div>
            );
          })}
        </div>
      </SectionBlock>
    </aside>
  );
}
