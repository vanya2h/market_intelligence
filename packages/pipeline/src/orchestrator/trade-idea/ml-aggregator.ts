/**
 * ML Aggregator (L1) — ONNX-backed logistic regression on the four per-dim scores.
 *
 * Produces a learned `mlTotal` in -1..+1 (P(win) mapped via 2p-1) that runs
 * alongside the heuristic `total` so the rest of the pipeline (sizing, bias,
 * targets) can switch between them via `decisionScore()`.
 *
 * Always tries to run. On any failure (model artifacts missing, inference
 * error, malformed output) returns null with a console warning; the caller
 * silently falls back to the heuristic `total` via `decisionScore()`. We
 * avoid caching failures so a freshly-trained model is picked up on the
 * next brief without a process restart.
 *
 * Models live at packages/pipeline/models/confluence_<asset>_<version>.{onnx,meta.json}
 * and are produced by packages/pipeline/training/train.py.
 */

import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import type { $Enums } from "../../generated/prisma/client.js";
import { DimensionEnum } from "../dimensions.js";
import type { Confluence } from "./confluence.js";

const MODELS_DIR = path.resolve(import.meta.dirname, "../../../models");

interface ModelMeta {
  model_name: string;
  asset: string;
  version: string;
  feature_order: string[];
  onnx_output_index_for_win: number;
  trained_at: string;
  n_samples: number;
}

interface LoadedModel {
  session: ort.InferenceSession;
  meta: ModelMeta;
  inputName: string;
  probabilityOutputName: string;
  winIndex: number;
}

/** Result of a successful ML inference. */
export interface MlResult {
  /** -1..+1, equal to 2 * pWin - 1. */
  mlTotal: number;
  /** Model version string from metadata, e.g. "v1". */
  modelVersion: string;
  /** Raw P(win) in [0,1]. */
  pWin: number;
}

/** Successful loads only — failures are not cached so retraining is picked up. */
const cache = new Map<$Enums.Asset, LoadedModel>();

function modelVersion(): string {
  return process.env.ML_AGGREGATOR_VERSION ?? "v1";
}

function modelPaths(asset: $Enums.Asset): { onnx: string; meta: string } {
  const v = modelVersion();
  const base = `confluence_${asset.toLowerCase()}_${v}`;
  return {
    onnx: path.join(MODELS_DIR, `${base}.onnx`),
    meta: path.join(MODELS_DIR, `${base}.meta.json`),
  };
}

async function loadModel(asset: $Enums.Asset): Promise<LoadedModel | null> {
  const cached = cache.get(asset);
  if (cached) return cached;

  const paths = modelPaths(asset);
  if (!fs.existsSync(paths.onnx) || !fs.existsSync(paths.meta)) {
    console.warn(
      `[ml-aggregator] model artifacts missing for ${asset} (version=${modelVersion()}); ` +
        `falling back to heuristic. Train via packages/pipeline/training/train.py --asset ${asset}.`,
    );
    return null;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(paths.meta, "utf-8")) as ModelMeta;
    const session = await ort.InferenceSession.create(paths.onnx);
    const probName =
      session.outputNames.find((n) => n.toLowerCase().includes("prob")) ??
      session.outputNames[session.outputNames.length - 1]!;
    const loaded: LoadedModel = {
      session,
      meta,
      inputName: session.inputNames[0]!,
      probabilityOutputName: probName,
      winIndex: meta.onnx_output_index_for_win ?? 1,
    };
    cache.set(asset, loaded);
    return loaded;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ml-aggregator] failed to load ${asset} model: ${msg}; falling back to heuristic.`);
    return null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Run the ML aggregator for one direction's per-dim scores.
 *
 * Returns:
 *   - `MlResult` on success
 *   - `null` on any failure (missing model, load error, inference error, bad output);
 *     a warning is logged and the caller falls back to the heuristic total.
 */
export async function runMlAggregator(asset: $Enums.Asset, scores: Confluence): Promise<MlResult | null> {
  const model = await loadModel(asset);
  if (!model) return null;

  const features = new Float32Array(model.meta.feature_order.map((k) => scores[k as DimensionEnum] ?? 0));
  const tensor = new ort.Tensor("float32", features, [1, features.length]);

  try {
    const result = await model.session.run({ [model.inputName]: tensor });
    const probsTensor = result[model.probabilityOutputName];
    if (!probsTensor) {
      console.warn(`[ml-aggregator] output ${model.probabilityOutputName} missing for ${asset}; falling back.`);
      return null;
    }
    const probs = probsTensor.data as Float32Array;
    const pWin = probs[model.winIndex];
    if (typeof pWin !== "number" || Number.isNaN(pWin)) {
      console.warn(`[ml-aggregator] invalid probability output for ${asset} (${pWin}); falling back.`);
      return null;
    }
    return {
      mlTotal: round3(2 * pWin - 1),
      modelVersion: model.meta.version,
      pWin: round3(pWin),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ml-aggregator] inference failed for ${asset}: ${msg}; falling back to heuristic.`);
    return null;
  }
}
