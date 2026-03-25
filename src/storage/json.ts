import fs from "node:fs";
import path from "node:path";
import { DerivativesSnapshot, DerivativesState } from "../types.js";

const DATA_DIR = path.resolve("data");
const HISTORY_FILE = path.join(DATA_DIR, "derivatives_history.json");
const STATE_FILE = path.join(DATA_DIR, "derivatives_state.json");

// 30 days of hourly snapshots
const MAX_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── History ────────────────────────────────────────────────────────────────

export function loadHistory(): DerivativesSnapshot[] {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
  return JSON.parse(raw) as DerivativesSnapshot[];
}

export function appendSnapshot(snapshot: DerivativesSnapshot): DerivativesSnapshot[] {
  const history = loadHistory();
  history.push(snapshot);

  // Prune entries older than 30 days
  const cutoff = Date.now() - MAX_HISTORY_MS;
  const pruned = history.filter(
    (s) => new Date(s.timestamp).getTime() >= cutoff
  );

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(pruned, null, 2));
  return pruned;
}

// ─── State ───────────────────────────────────────────────────────────────────

export function loadState(): DerivativesState | null {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return null;
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  return JSON.parse(raw) as DerivativesState;
}

export function saveState(state: DerivativesState): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
