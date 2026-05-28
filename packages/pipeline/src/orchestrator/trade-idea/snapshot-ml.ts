/**
 * Snapshot ML — cross-dimension trend-strength model.
 *
 * Loads `models/snapshot_{asset}_{version}.onnx` and runs inference on the
 * full concatenated cross-dim feature vector from RawFeaturesByDim.
 *
 * Replaces the two-level L2a + L1 stack when the model is available.
 * Falls back to null (caller then uses the heuristic path) if the model
 * file is missing or inference fails.
 *
 * Feature order is fixed by meta.json `feature_order` — same list the
 * Python training script derives from feature_schema.json.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { InferenceSession } from "onnxruntime-node";
import * as ort from "onnxruntime-node";
import type { $Enums } from "../../generated/prisma/client.js";
import type { RawFeaturesByDim } from "./extract-features.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnapshotModelMeta {
  model_name: string;
  asset: string;
  version: string;
  model_type: string;
  feature_order: string[];
  onnx_output_name: string;
  quality_scale: number;
  n_samples?: number;
  cv?: {
    oof?: {
      pearson_ic?: number;
      hit_rate?: number;
      p_value?: number;
    };
  };
}

interface LoadedSnapshotModel {
  session: InferenceSession;
  meta: SnapshotModelMeta;
  inputName: string;
}

export interface ModelStats {
  oofIc: number;
  hitRate: number;
  nSamples: number;
}

export interface SnapshotMlResult {
  score: number;
  modelVersion: string;
  stats: ModelStats | null;
}

// ─── Model cache (loaded once per process) ────────────────────────────────────

const MODEL_CACHE = new Map<string, LoadedSnapshotModel | null>();

const MODELS_DIR = resolve(import.meta.dirname, "../../../models");

function modelKey(asset: $Enums.Asset, version: string): string {
  return `snapshot_${asset.toLowerCase()}_${version}`;
}

async function loadSnapshotModel(asset: $Enums.Asset, version: string): Promise<LoadedSnapshotModel | null> {
  const key = modelKey(asset, version);
  if (MODEL_CACHE.has(key)) return MODEL_CACHE.get(key)!;

  const onnxPath = resolve(MODELS_DIR, `${key}.onnx`);
  const metaPath = resolve(MODELS_DIR, `${key}.meta.json`);

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SnapshotModelMeta;
    const session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: ["cpu"],
    });
    const loaded: LoadedSnapshotModel = {
      session,
      meta,
      inputName: session.inputNames[0]!,
    };
    MODEL_CACHE.set(key, loaded);
    return loaded;
  } catch {
    // Model not trained yet — silent fallback
    MODEL_CACHE.set(key, null);
    return null;
  }
}

// ─── Feature vector assembly ─────────────────────────────────────────────────

/**
 * Assemble the flat Float32Array input from RawFeaturesByDim using the
 * canonical feature order stored in meta.json.
 *
 * Column names are "{DIM}_{featureKey}". Unknown or missing features default
 * to 0.0 so that older snapshots with fewer features still produce valid input.
 */
function assembleFeatureVector(rawFeatures: RawFeaturesByDim, featureOrder: string[]): Float32Array {
  const vec = new Float32Array(featureOrder.length);
  for (let i = 0; i < featureOrder.length; i++) {
    const name = featureOrder[i]!;
    const sep = name.indexOf("_");
    const dim = name.slice(0, sep) as keyof RawFeaturesByDim;
    const key = name.slice(sep + 1);
    const v = rawFeatures[dim]?.[key];
    vec[i] = v == null || !Number.isFinite(v) ? 0 : v;
  }
  return vec;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the snapshot model if available.
 * Returns null when the model file is missing or inference fails — the caller
 * then continues with the L2a + L1 fallback path.
 */
export async function runSnapshotMl(
  asset: $Enums.Asset,
  rawFeatures: RawFeaturesByDim,
  version = "v1",
): Promise<SnapshotMlResult | null> {
  const model = await loadSnapshotModel(asset, version);
  if (!model) return null;

  try {
    const vec = assembleFeatureVector(rawFeatures, model.meta.feature_order);
    const tensor = new ort.Tensor("float32", vec, [1, vec.length]);
    const results = await model.session.run({ [model.inputName]: tensor });
    const output = results[model.meta.onnx_output_name];
    if (!output) return null;

    const raw = (output.data as Float32Array)[0];
    if (raw == null || !Number.isFinite(raw)) return null;

    const score = Math.max(-1, Math.min(1, raw));
    const oof = model.meta.cv?.oof;
    const stats: ModelStats | null =
      oof?.pearson_ic != null && oof?.hit_rate != null && model.meta.n_samples != null
        ? { oofIc: oof.pearson_ic, hitRate: oof.hit_rate, nSamples: model.meta.n_samples }
        : null;
    return { score, modelVersion: model.meta.model_name, stats };
  } catch {
    return null;
  }
}
