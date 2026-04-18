/**
 * Arrow.js block renderers — client-only module.
 *
 * This file is never imported on the server. The React bridge in
 * RichBrief.tsx dynamically imports it inside useEffect.
 *
 * IMPORTANT: Arrow.js does not support multiple expressions within a
 * single HTML attribute. Always pre-compute style strings and pass
 * them as a single expression: style="${computedStyle}".
 */

import { html, reactive } from "@arrow-js/core";
import type { Regime } from "@market-intel/api";
import type {
  BarChartBlock,
  CalloutBlock,
  HeadingBlock,
  HeatmapBlock,
  LevelMapBlock,
  MetricRowBlock,
  RegimeBannerBlock,
  RichBlock,
  ScorecardBlock,
  SignalBlock,
  SpectrumBlock,
  TensionBlock,
  TextBlock,
} from "@market-intel/pipeline";
import { regimeLabel } from "../lib/regime-colors";

// ─── Color helpers ──────────────────────────────────────────────────────────

const C = {
  green: "var(--green)",
  greenDim: "var(--green-dim)",
  red: "var(--red)",
  redDim: "var(--red-dim)",
  amber: "var(--amber)",
  amberDim: "var(--amber-dim)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  bgCard: "var(--bg-card)",
  bgSurface: "var(--bg-surface)",
  bgHover: "var(--bg-hover)",
  border: "var(--border)",
  borderSubtle: "var(--border-subtle)",
};

const mono = "'JetBrains Mono', monospace";

function sentimentColor(s?: "bullish" | "bearish" | "neutral" | "mixed"): string {
  if (s === "bullish") return C.green;
  if (s === "bearish") return C.red;
  if (s === "mixed") return C.amber;
  return C.textSecondary;
}

function sentimentBg(s?: "bullish" | "bearish" | "neutral" | "mixed"): string {
  if (s === "bullish") return C.greenDim;
  if (s === "bearish") return C.redDim;
  if (s === "mixed") return C.amberDim;
  return C.bgSurface;
}

function thresholdColor(value: number, thresholds?: [number, number]): string {
  const [low, high] = thresholds ?? [30, 70];
  if (value <= low) return C.red;
  if (value >= high) return C.green;
  return C.amber;
}

function variantColor(v: string): string {
  if (v === "bullish") return C.green;
  if (v === "bearish") return C.red;
  if (v === "warning") return C.amber;
  return C.textSecondary;
}

function variantBg(v: string): string {
  if (v === "bullish") return C.greenDim;
  if (v === "bearish") return C.redDim;
  if (v === "warning") return C.amberDim;
  return C.bgSurface;
}

// ─── Block renderers ────────────────────────────────────────────────────────

function renderHeading(b: HeadingBlock) {
  const sizes: Record<number, string> = { 1: "1.25rem", 2: "1.0625rem", 3: "0.9375rem" };
  const size = sizes[b.level ?? 2] ?? "1.0625rem";
  const s = `font-size: ${size}; font-weight: 600; color: ${C.textPrimary}; letter-spacing: -0.01em; margin-bottom: 0.25rem;`;
  return html`<div style="${s}">${b.text}</div>`;
}

function renderText(b: TextBlock) {
  const color = b.style === "emphasis" ? C.textPrimary : b.style === "muted" ? C.textMuted : C.textSecondary;
  const s = `font-size: 0.8125rem; line-height: 1.6; color: ${color}; margin: 0;`;
  return html`<p style="${s}">${b.content}</p>`;
}

function renderDivider() {
  const s = `height: 1px; background: ${C.border}; margin: 0.25rem 0;`;
  return html`<div style="${s}"></div>`;
}

function renderSpacer() {
  return html`<div style="height: 0.75rem;"></div>`;
}

function renderSpectrum(b: SpectrumBlock) {
  const pct = Math.max(0, Math.min(100, b.value));
  const state = reactive({ animated: 0 });
  setTimeout(() => {
    state.animated = pct;
  }, 50);

  const labelStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.375rem;`;
  const trackStyle = `position: relative; height: 0.5rem; border-radius: 4px; background: linear-gradient(90deg, ${C.red} 0%, ${C.amber} 50%, ${C.green} 100%);`;
  const leftStyle = `font-size: 0.625rem; color: ${C.red};`;
  const rightStyle = `font-size: 0.625rem; color: ${C.green};`;

  const blockStyle = `padding: 0.875rem; background: ${C.bgSurface}; border: 1px solid ${C.borderSubtle}; border-radius: 6px; margin: 0.125rem 0;`;

  return html`<div style="${blockStyle}">
    <div style="${labelStyle}">${b.label}</div>
    <div style="${trackStyle}">
      <div
        style="${() =>
          `position: absolute; top: -3px; width: 0.875rem; height: 0.875rem; border-radius: 50%; background: ${C.textPrimary}; border: 2px solid ${C.bgCard}; left: ${state.animated}%; transform: translateX(-50%); transition: left 0.8s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 6px rgba(0,0,0,0.5);`}"
      ></div>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 0.25rem;">
      <span style="${leftStyle}">${b.leftLabel}</span>
      <span style="${rightStyle}">${b.rightLabel}</span>
    </div>
  </div>`;
}

function renderMetricRow(b: MetricRowBlock) {
  const gridStyle = `display: grid; grid-template-columns: repeat(${Math.min(b.items.length, 4)}, 1fr); gap: 0.75rem; margin: 0.125rem 0;`;
  const cardStyle = `padding: 0.625rem 0.75rem; background: ${C.bgSurface}; border-radius: 6px; border: 1px solid ${C.borderSubtle};`;
  const metricLabelStyle = `font-size: 0.625rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;`;
  const detailStyle = `font-size: 0.625rem; color: ${C.textMuted}; margin-top: 0.125rem;`;

  return html`<div style="${gridStyle}">
    ${b.items.map((item) => {
      const color = sentimentColor(item.sentiment);
      const valStyle = `font-size: 1.125rem; font-weight: 700; font-family: ${mono}; color: ${color};`;
      return html`<div style="${cardStyle}">
        <div style="${metricLabelStyle}">${item.label}</div>
        <div style="${valStyle}">${item.value}</div>
        ${item.detail ? html`<div style="${detailStyle}">${item.detail}</div>` : html``}
      </div>`;
    })}
  </div>`;
}

function renderBarChart(b: BarChartBlock) {
  const maxVal = b.items.reduce((m, item) => Math.max(m, item.maxValue ?? item.value), 0);
  const titleStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;`;
  const blockStyle = `padding: 0.875rem; background: ${C.bgSurface}; border: 1px solid ${C.borderSubtle}; border-radius: 6px; margin: 0.125rem 0;`;

  return html`<div style="margin: 0.125rem 0;">
    ${b.title ? html`<div style="${titleStyle}">${b.title}</div>` : html``}
    <div style="${blockStyle}">
      <div style="display: flex; flex-direction: column; gap: 0.625rem;">
        ${b.items.map((item) => {
          const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
          const color = item.value >= 0 ? C.green : C.red;
          const absPct = Math.abs(pct);

          const state = reactive({ animated: 0 });
          setTimeout(() => {
            state.animated = absPct;
          }, 50);

          const lblStyle = `font-size: 0.6875rem; color: ${C.textSecondary};`;
          const numStyle = `font-size: 0.6875rem; font-family: ${mono}; color: ${color};`;
          const trackStyle = `height: 0.25rem; background: ${C.bgHover}; border-radius: 2px; overflow: hidden;`;

          return html`<div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.375rem;">
              <span style="${lblStyle}">${item.label}</span>
              <span style="${numStyle}">${item.value.toLocaleString()}</span>
            </div>
            <div style="${trackStyle}">
              <div
                style="${() =>
                  `height: 100%; width: ${state.animated}%; background: ${color}; border-radius: 2px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);`}"
              ></div>
            </div>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function renderHeatmap(b: HeatmapBlock) {
  const titleStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;`;
  const gridStyle = `display: grid; grid-template-columns: repeat(${Math.min(b.cells.length, 5)}, 1fr); gap: 0.25rem;`;
  const cellLabelStyle = `font-size: 0.65rem; color: ${C.textMuted}; margin-bottom: 0.125rem;`;

  return html`<div style="margin: 0.125rem 0;">
    ${b.title ? html`<div style="${titleStyle}">${b.title}</div>` : html``}
    <div>
      <div style="${gridStyle}">
        ${b.cells.map((cell) => {
          const min = cell.min ?? 0;
          const max = cell.max ?? 100;
          const norm = Math.max(0, Math.min(1, (cell.value - min) / (max - min)));
          // How far from neutral (0.5) — 0 = boring, 1 = extreme
          const intensity = Math.abs(norm - 0.5) * 2;
          const baseColor = norm < 0.3 ? C.red : norm > 0.7 ? C.green : C.amber;
          const baseBg = norm < 0.3 ? C.redDim : norm > 0.7 ? C.greenDim : C.amberDim;
          // Blend bg toward surface for low-intensity, keep vivid for high
          const bg = `color-mix(in srgb, ${baseBg} ${Math.round(10 + intensity * 90)}%, ${C.bgSurface})`;
          const opacity = (0.2 + intensity * 0.8).toFixed(2);
          const cellStyle = `padding: 0.5rem; background: ${bg}; border-radius: 4px; text-align: center;`;
          const valStyle = `font-size: 0.875rem; font-weight: 700; font-family: ${mono}; color: ${baseColor}; opacity: ${opacity};`;

          return html`<div style="${cellStyle}">
            <div style="${cellLabelStyle}">${cell.label}</div>
            <div style="${valStyle}">${cell.value.toFixed(0)}</div>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function renderScorecard(b: ScorecardBlock) {
  const trendArrow = (t?: string) => (t === "up" ? " ↑" : t === "down" ? " ↓" : t === "flat" ? " →" : "");
  const trendColor = (t?: string) => (t === "up" ? C.green : t === "down" ? C.red : C.textMuted);
  const titleStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;`;
  const listStyle = `display: flex; flex-direction: column; gap: 1px; background: ${C.bgSurface}; border-radius: 6px; overflow: hidden;`;
  const rowBaseStyle = `display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: ${C.bgSurface};`;
  const labelStyle = `flex: 1; font-size: 0.75rem; color: ${C.textSecondary};`;
  const trackStyle = `width: 3.75rem; height: 0.1875rem; background: ${C.bgHover}; border-radius: 2px; overflow: hidden;`;

  const interpStyle = `font-size: 0.75rem; line-height: 1.5; color: ${C.textSecondary}; padding: 0.5rem 0.75rem; background: ${C.bgHover}; border-radius: 4px; margin-top: 0.5rem;`;

  return html`<div style="margin: 0.125rem 0;">
    ${b.title ? html`<div style="${titleStyle}">${b.title}</div>` : html``}
    <div style="${listStyle}">
      ${b.items.map((item) => {
        const max = item.maxScore ?? 100;
        const pct = Math.max(0, Math.min(100, (item.score / max) * 100));
        const color = thresholdColor(pct);
        const fillStyle = `height: 100%; width: ${pct}%; background: ${color}; border-radius: 2px;`;
        const scoreStyle = `font-size: 0.75rem; font-weight: 600; font-family: ${mono}; color: ${color}; min-width: 1.75rem; text-align: right;`;
        const tStyle = `font-size: 0.6875rem; color: ${trendColor(item.trend)}; min-width: 0.875rem;`;

        return html`<div style="${rowBaseStyle}">
          <span style="${labelStyle}">${item.label}</span>
          <div style="${trackStyle}">
            <div style="${fillStyle}"></div>
          </div>
          <span style="${scoreStyle}">${item.score}</span>
          <span style="${tStyle}">${trendArrow(item.trend)}</span>
        </div>`;
      })}
    </div>
    ${b.interpretation ? html`<div style="${interpStyle}">${b.interpretation}</div>` : html``}
  </div>`;
}

function renderCallout(b: CalloutBlock) {
  const color = variantColor(b.variant);
  const bg = variantBg(b.variant);
  const icon = b.variant === "bullish" ? "▲" : b.variant === "bearish" ? "▼" : b.variant === "warning" ? "⚠" : "ℹ";

  const boxStyle = `padding: 0.75rem 0.875rem; background: ${bg}; border-left: 3px solid ${color}; border-radius: 0 6px 6px 0; margin: 0.125rem 0;`;
  const headerStyle = `display: flex; align-items: center; gap: 0.375rem; margin-bottom: 0.25rem;`;
  const iconStyle = `font-size: 0.6875rem; color: ${color};`;
  const titleStyle = `font-size: 0.75rem; font-weight: 600; color: ${color};`;
  const bodyStyle = `font-size: 0.75rem; line-height: 1.5; color: ${C.textSecondary}; margin: 0;`;

  return html`<div style="${boxStyle}">
    <div style="${headerStyle}">
      <span style="${iconStyle}">${icon}</span>
      <span style="${titleStyle}">${b.title}</span>
    </div>
    <p style="${bodyStyle}">${b.content}</p>
  </div>`;
}

function renderSignal(b: SignalBlock) {
  const color = "#5b9bf5";
  const bg = "rgba(91, 155, 245, 0.08)";
  const icon = b.direction === "bullish" ? "▲" : b.direction === "bearish" ? "▼" : "●";

  const boxStyle = `padding: 0.75rem 0.875rem; background: ${bg}; border-left: 3px solid ${color}; border-radius: 0 6px 6px 0; margin: 0.125rem 0;`;
  const headerStyle = `display: flex; align-items: center; gap: 0.375rem; margin-bottom: 0.25rem;`;
  const iconStyle = `font-size: 0.6875rem; color: ${color};`;
  const titleStyle = `font-size: 0.75rem; font-weight: 600; color: ${color};`;
  const bodyStyle = `font-size: 0.75rem; line-height: 1.5; color: ${C.textSecondary}; margin: 0;`;

  return html`<div style="${boxStyle}">
    <div style="${headerStyle}">
      <span style="${iconStyle}">${icon}</span>
      <span style="${titleStyle}">${b.label}</span>
    </div>
    ${b.detail ? html`<p style="${bodyStyle}">${b.detail}</p>` : html``}
  </div>`;
}

function renderLevelMap(b: LevelMapBlock) {
  const levelColor = (type: string) => {
    if (type === "support") return C.green;
    if (type === "resistance") return C.red;
    if (type === "target") return C.amber;
    if (type === "stop") return C.red;
    return C.textMuted;
  };

  const typeLabel = (type: string) => {
    if (type === "support") return "SUP";
    if (type === "resistance") return "RES";
    if (type === "target") return "TGT";
    if (type === "stop") return "STP";
    return type.toUpperCase().slice(0, 3);
  };

  const sorted = [...b.levels].sort((a, c) => c.price - a.price);

  const containerStyle = `margin: 0.125rem 0;background: ${C.bgSurface}; border-radius: 6px; border: 1px solid ${C.borderSubtle};`;
  const titleStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;`;

  return html`<div style="margin: 0.125rem 0;">
    <div style="${titleStyle}">Key Levels</div>
    <div style="${containerStyle}">
      <div style="display: flex; flex-direction: column; gap: 0.125rem;">
        ${sorted.map((level) => {
          const color = levelColor(level.type);
          const rowStyle = `display: flex; align-items: center; gap: 0.5rem; padding: 0.3125rem 0.625rem; border-bottom: 1px solid ${C.borderSubtle};`;
          const tagStyle = `font-size: 0.5625rem; font-weight: 600; color: ${color}; text-transform: uppercase; letter-spacing: 0.05em; min-width: 1.75rem;`;
          const lblStyle = `flex: 1; font-size: 0.75rem; color: ${C.textSecondary};`;
          const priceStyle = `font-size: 0.75rem; font-weight: 600; font-family: ${mono}; color: ${color};`;

          return html`<div style="${rowStyle}">
            <span style="${tagStyle}">${typeLabel(level.type)}</span>
            <span style="${lblStyle}">${level.label}</span>
            <span style="${priceStyle}">${level.price.toLocaleString()}</span>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function renderRegimeBanner(b: RegimeBannerBlock) {
  const color = sentimentColor(b.sentiment);
  const bg = sentimentBg(b.sentiment);

  const boxStyle = `padding: 0.875rem 1rem; background: ${bg}; border-radius: 8px; border: 1px solid ${color}20; margin: 0.125rem 0;`;
  const headerStyle = `display: flex; align-items: center; gap: 0.5rem; margin-bottom: ${b.subtitle ? "0.25rem" : "0"};`;
  const dotStyle = `width: 0.625rem; height: 0.625rem; border-radius: 50%; background: ${color};`;
  const titleStyle = `font-size: 0.9rem; font-weight: 700; color: ${C.textPrimary}; letter-spacing: -0.01em;`;
  const subtitleStyle = `font-size: 0.8rem; color: ${C.textSecondary}; margin: 0; padding-left: 1.125rem;`;

  return html`<div style="${boxStyle}">
    <div style="${headerStyle}">
      <div style="${dotStyle}"></div>
      <span style="${titleStyle}">${b.regime}</span>
    </div>
    ${b.subtitle ? html`<p style="${subtitleStyle}">${b.subtitle}</p>` : html``}
  </div>`;
}

function renderTension(b: TensionBlock) {
  const leftColor = sentimentColor(b.left.sentiment);
  const rightColor = sentimentColor(b.right.sentiment);

  const titleStyle = `font-size: 0.6875rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;`;
  const gridStyle = `display: grid; grid-template-columns: 1fr auto 1fr; gap: 0; align-items: stretch;`;
  const leftBoxStyle = `padding: 0.625rem 0.75rem; background: ${sentimentBg(b.left.sentiment)}; border-radius: 6px 0 0 6px; border: 1px solid ${leftColor}20;`;
  const rightBoxStyle = `padding: 0.625rem 0.75rem; background: ${sentimentBg(b.right.sentiment)}; border-radius: 0 6px 6px 0; border: 1px solid ${rightColor}20;`;
  const centerStyle = `display: flex; align-items: center; padding: 0 0.5rem; background: ${C.bgSurface};`;
  const leftTitleStyle = `font-size: 0.75rem; font-weight: 600; color: ${leftColor}; margin-bottom: 0.125rem;`;
  const rightTitleStyle = `font-size: 0.75rem; font-weight: 600; color: ${rightColor}; margin-bottom: 0.125rem;`;
  const detailStyle = `font-size: 0.6875rem; color: ${C.textSecondary}; line-height: 1.4;`;
  const arrowStyle = `font-size: 0.875rem; color: ${C.textMuted};`;

  return html`<div style="margin: 0.125rem 0;">
    <div style="${titleStyle}">${b.title}</div>
    <div style="${gridStyle}">
      <div style="${leftBoxStyle}">
        <div style="${leftTitleStyle}">${b.left.label}</div>
        <div style="${detailStyle}">${b.left.detail}</div>
      </div>
      <div style="${centerStyle}">
        <span style="${arrowStyle}">⟷</span>
      </div>
      <div style="${rightBoxStyle}">
        <div style="${rightTitleStyle}">${b.right.label}</div>
        <div style="${detailStyle}">${b.right.detail}</div>
      </div>
    </div>
  </div>`;
}

// ─── Block dispatcher ───────────────────────────────────────────────────────

function renderBlock(block: RichBlock) {
  switch (block.type) {
    case "heading":
      return renderHeading(block);
    case "text":
      return renderText(block);
    case "divider":
      return renderDivider();
    case "spacer":
      return renderSpacer();
    case "spectrum":
      return renderSpectrum(block);
    case "metric_row":
      return renderMetricRow(block);
    case "bar_chart":
      return renderBarChart(block);
    case "heatmap":
      return renderHeatmap(block);
    case "scorecard":
      return renderScorecard(block);
    case "callout":
      return renderCallout(block);
    case "signal":
      return renderSignal(block);
    case "level_map":
      return renderLevelMap(block);
    case "regime_banner":
      return renderRegimeBanner(block);
    case "tension":
      return renderTension(block);
    default:
      return html``;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function mountRichBrief(el: HTMLElement, blocks: RichBlock[]): void {
  el.innerHTML = "";

  const template = html`<div style="display: flex; flex-direction: column; gap: 0.625rem;">
    ${blocks.map((block) => renderBlock(block))}
  </div>`;

  template(el);
}
