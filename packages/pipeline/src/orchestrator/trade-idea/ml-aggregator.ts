/**
 * ML Aggregator (L1) — ONNX-backed Ridge regression on the four per-dim scores.
 *
 * Produces a learned `mlTotal` in -1..+1 representing cross-dim trend strength.
 * Positive = bullish momentum; negative = bearish momentum; near-zero = no trend.
 *
 * Backward-compatible with old classification models: if the meta.json has
 * `onnx_output_index_for_win`, the model is treated as a probability classifier
 * and mlTotal = 2*pWin-1 (old behavior). New regression models use `onnx_output_name`
 * and return the raw regression scalar (clamped to [-1, +1]).
 *
 * Always tries to run. On any failure returns null with a console warning;
 * the caller silently falls back to the heuristic `total` via `decisionScore()`.
 * Failures are not cached so a freshly-trained model is picked up on the next brief.
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
  /** Present on new regression models. */
  onnx_output_name?: string;
  /** Present on old classification models — used to detect the model type. */
  onnx_output_index_for_win?: number;
  trained_at: string;
  n_samples: number;
}

interface LoadedModel {
  session: ort.InferenceSession;
  meta: ModelMeta;
  inputName: string;
  outputName: string;
  /** True = old logistic-regression model; false = new regression model. */
  isClassification: boolean;
  /** Index of the win-class probability column (classification only). */
  winIndex: number;
}

/** Result of a successful ML inference. */
export interface MlResult {
  /** Trend strength in -1..+1. Positive = bullish, negative = bearish. */
  mlTotal: number;
  /** Model version string from metadata, e.g. "v1". */
  modelVersion: string;
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

    // Old classification models have `onnx_output_index_for_win` in meta.
    // New regression models have `onnx_output_name` (or neither — default to regression).
    const isClassification = typeof meta.onnx_output_index_for_win === "number";
    const winIndex = meta.onnx_output_index_for_win ?? 1;
    const outputName = isClassification
      ? (session.outputNames.find((n) => n.toLowerCase().includes("prob")) ??
        session.outputNames[session.outputNames.length - 1]!)
      : (meta.onnx_output_name ?? session.outputNames[0]!);

    const loaded: LoadedModel = {
      session,
      meta,
      inputName: session.inputNames[0]!,
      outputName,
      isClassification,
      winIndex,
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
    const outputTensor = result[model.outputName];
    if (!outputTensor) {
      console.warn(`[ml-aggregator] output "${model.outputName}" missing for ${asset}; falling back.`);
      return null;
    }

    let mlTotal: number;
    if (model.isClassification) {
      // Old model: probability output → convert to [-1, +1] via 2*pWin-1
      const probs = outputTensor.data as Float32Array;
      const pWin = probs[model.winIndex];
      if (typeof pWin !== "number" || Number.isNaN(pWin)) {
        console.warn(`[ml-aggregator] invalid probability output for ${asset} (${pWin}); falling back.`);
        return null;
      }
      mlTotal = 2 * pWin - 1;
    } else {
      // New model: regression scalar, clamp to [-1, +1]
      const rawScore = (outputTensor.data as Float32Array)[0];
      if (typeof rawScore !== "number" || Number.isNaN(rawScore)) {
        console.warn(`[ml-aggregator] invalid regression output for ${asset} (${rawScore}); falling back.`);
        return null;
      }
      mlTotal = Math.max(-1, Math.min(1, rawScore));
    }

    return {
      mlTotal: round3(mlTotal),
      modelVersion: model.meta.version,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ml-aggregator] inference failed for ${asset}: ${msg}; falling back to heuristic.`);
    return null;
  }
}
