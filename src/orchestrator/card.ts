/**
 * Orchestrator — Regime Card Image Generator
 *
 * Generates a color-coded regime summary card as PNG.
 * Renders an SVG string via sharp — no browser or canvas needed.
 */

import sharp from "sharp";
import type { DimensionOutput } from "./types.js";

// ─── Color mapping ───────────────────────────────────────────────────────────

function regimeColor(regime: string): { bg: string; text: string } {
  const lower = regime.toLowerCase();

  if (lower.includes("bullish") || lower.includes("inflow") || lower.includes("greed") || lower.includes("squeeze")) {
    return { bg: "#16a34a", text: "#ffffff" };
  }
  if (
    lower.includes("bearish") ||
    lower.includes("outflow") ||
    lower.includes("fear") ||
    lower.includes("capitulation") ||
    lower.includes("deleveraging")
  ) {
    return { bg: "#dc2626", text: "#ffffff" };
  }
  if (
    lower.includes("divergence") ||
    lower.includes("heating") ||
    lower.includes("unwinding") ||
    lower.includes("crowded")
  ) {
    return { bg: "#d97706", text: "#ffffff" };
  }
  return { bg: "#374151", text: "#e5e7eb" };
}

function compositeColor(value: number): string {
  if (value < 20) return "#dc2626";
  if (value < 40) return "#ef4444";
  if (value <= 60) return "#d97706";
  if (value <= 80) return "#16a34a";
  return "#15803d";
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface SentimentData {
  compositeIndex: number;
  compositeLabel: string;
  components?: {
    positioning: number;
    trend: number;
    institutionalFlows: number;
    expertConsensus: number;
  };
}

function extractSentimentData(outputs: DimensionOutput[]): SentimentData | null {
  const sentiment = outputs.find((o) => o.dimension === "sentiment");
  if (!sentiment) return null;
  const ctx = sentiment.context as unknown as Record<string, unknown>;
  const metrics = ctx.metrics as Record<string, unknown> | undefined;
  if (!metrics) return null;
  return {
    compositeIndex: (metrics.compositeIndex as number) ?? 50,
    compositeLabel: (metrics.compositeLabel as string) ?? "Neutral",
    components: metrics.components as SentimentData["components"],
  };
}

function buildComponentBar(label: string, value: number, x: number, y: number, barWidth: number): string {
  const filled = (value / 100) * barWidth;
  const color = value < 30 ? "#ef4444" : value > 70 ? "#16a34a" : "#d97706";
  return `
    <text x="${x}" y="${y + 20}" font-family="monospace" font-size="16" fill="#aaaaaa">${escapeXml(label)}</text>
    <rect x="${x + 170}" y="${y + 4}" width="${barWidth}" height="22" rx="5" fill="#1a1a1a"/>
    <rect x="${x + 170}" y="${y + 4}" width="${filled}" height="22" rx="5" fill="${color}"/>
    <text x="${x + 170 + barWidth + 12}" y="${y + 20}" font-family="monospace" font-size="16" font-weight="bold" fill="#e5e7eb">${Math.round(value)}</text>
  `;
}

// ─── Main SVG builder ────────────────────────────────────────────────────────

export function buildSvgCard(asset: string, outputs: DimensionOutput[]): string {
  const sentiment = extractSentimentData(outputs);

  const cardWidth = 800;
  const headerHeight = 70;
  const topSectionHeight = 210;
  const rowHeight = 56;
  const regimeSectionHeight = outputs.length * rowHeight + 28;
  const cardHeight = headerHeight + topSectionHeight + regimeSectionHeight + 20;

  const date = new Date().toUTCString().replace(/ GMT$/, "");

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="${cardWidth}" height="${cardHeight}" rx="16" fill="url(#bg)"/>
  <rect width="${cardWidth}" height="${cardHeight}" rx="16" fill="none" stroke="#222222" stroke-width="1"/>`;

  // ── Header
  svg += `
  <text x="36" y="46" font-family="system-ui, sans-serif" font-size="24" font-weight="bold" fill="#ffffff">MARKET BRIEF</text>
  <text x="${cardWidth - 36}" y="32" font-family="monospace" font-size="20" font-weight="bold" fill="#e5e7eb" text-anchor="end">${escapeXml(asset)}</text>
  <text x="${cardWidth - 36}" y="54" font-family="monospace" font-size="13" fill="#777777" text-anchor="end">${escapeXml(date)}</text>
  <line x1="36" y1="${headerHeight}" x2="${cardWidth - 36}" y2="${headerHeight}" stroke="#1a1a1a" stroke-width="1"/>`;

  // ── Top section: Gauge (left) + Component bars (right)
  if (sentiment) {
    const circleCx = 150;
    const circleCy = headerHeight + 105;
    const circleR = 90;
    const color = compositeColor(sentiment.compositeIndex);

    // Ring
    svg += `<circle cx="${circleCx}" cy="${circleCy}" r="${circleR}" fill="none" stroke="#1a1a1a" stroke-width="6"/>`;
    svg += `<circle cx="${circleCx}" cy="${circleCy}" r="${circleR}" fill="none" stroke="${color}" stroke-width="6" opacity="0.3"/>`;
    // Score
    svg += `<text x="${circleCx}" y="${circleCy - 6}" font-family="system-ui, sans-serif" font-size="48" font-weight="bold" fill="${color}" text-anchor="middle">${sentiment.compositeIndex.toFixed(1)}</text>`;
    svg += `<text x="${circleCx}" y="${circleCy + 22}" font-family="monospace" font-size="16" fill="#aaaaaa" text-anchor="middle">${escapeXml(sentiment.compositeLabel)}</text>`;
    svg += `<text x="${circleCx}" y="${circleCy + 42}" font-family="monospace" font-size="12" fill="#666666" text-anchor="middle">FEAR &amp; GREED</text>`;

    // Component bars (right side)
    if (sentiment.components) {
      const barsX = 300;
      const barsY = headerHeight + 26;
      const barW = 230;
      svg += buildComponentBar("Positioning", sentiment.components.positioning, barsX, barsY, barW);
      svg += buildComponentBar("Trend", sentiment.components.trend, barsX, barsY + 40, barW);
      svg += buildComponentBar("Inst. Flows", sentiment.components.institutionalFlows, barsX, barsY + 80, barW);
      svg += buildComponentBar("Expert Cons.", sentiment.components.expertConsensus, barsX, barsY + 120, barW);
    }
  }

  // ── Separator
  const regimeStartY = headerHeight + topSectionHeight;
  svg += `<line x1="36" y1="${regimeStartY}" x2="${cardWidth - 36}" y2="${regimeStartY}" stroke="#1a1a1a" stroke-width="1"/>`;

  // ── Dimension regime rows
  outputs.forEach((o, i) => {
    const y = regimeStartY + 16 + i * rowHeight;

    // Label
    svg += `<text x="36" y="${y + 34}" font-family="monospace" font-size="17" fill="#d1d5db">${escapeXml(o.label)}</text>`;

    // Regime pill
    const pillText = o.regime;
    const pillWidth = pillText.length * 10 + 28;
    const pillX = cardWidth - 36 - pillWidth;
    const { bg, text } = regimeColor(o.regime);
    svg += `<rect x="${pillX}" y="${y + 12}" width="${pillWidth}" height="32" rx="16" fill="${bg}"/>`;
    svg += `<text x="${pillX + pillWidth / 2}" y="${y + 33}" font-family="monospace" font-size="14" font-weight="bold" fill="${text}" text-anchor="middle">${escapeXml(pillText)}</text>`;
  });

  svg += `</svg>`;
  return svg;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateCard(asset: string, outputs: DimensionOutput[]): Promise<Buffer> {
  const svg = buildSvgCard(asset, outputs);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
