/**
 * L2a Per-Dimension ML Sub-Models
 *
 * ONNX-backed logistic regression per dimension per asset. Answers "P(price
 * goes up)" from raw amplitude-encoded features (extract-features.ts).
 * Output score = 2*pUp - 1 in [-1, +1].
 *
 * Cache: successful loads only (same pattern as ml-aggregator.ts). Failures
 * are not cached so a freshly-trained model is picked up on the next brief.
 * Missing or broken models throw — the pipeline must not silently degrade.
 *
 * Models live at packages/pipeline/models/dim_<dim>_<asset>_<version>.{onnx,meta.json}
 * and are produced by packages/pipeline/training/train_dim.py.
 */

import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import type { $Enums } from "../../generated/prisma/client.js";
import { DimensionEnum } from "../dimensions.js";
import type { RawFeaturesByDim } from "./extract-features.js";

const MODELS_DIR = path.resolve(import.meta.dirname, "../../../models");

interface DimModelMeta {
  model_name: string;
  dim: string;
  asset: string;
  version: string;
  feature_order: string[];
  onnx_output_index_for_win: number;
}

interface LoadedDimModel {
  session: ort.InferenceSession;
  meta: DimModelMeta;
  inputName: string;
  probabilityOutputName: string;
  winIndex: number;
}

export interface IntradimMlResult {
  /** Score in -1..+1 (2 * pUp - 1). */
  score: number;
  /** Raw P(price went up) in [0, 1]. */
  pUp: number;
  modelVersion: string;
}

export type IntradimMlResults = Record<DimensionEnum, IntradimMlResult>;

const cache = new Map<string, LoadedDimModel>();

function modelVersion(): string {
  return process.env.INTRADIM_ML_VERSION ?? "v1";
}

function modelPaths(dim: DimensionEnum, asset: $Enums.Asset): { onnx: string; meta: string } {
  const v = modelVersion();
  const base = `dim_${dim.toLowerCase()}_${asset.toLowerCase()}_${v}`;
  return {
    onnx: path.join(MODELS_DIR, `${base}.onnx`),
    meta: path.join(MODELS_DIR, `${base}.meta.json`),
  };
}

async function loadDimModel(dim: DimensionEnum, asset: $Enums.Asset): Promise<LoadedDimModel> {
  const key = `${dim}_${asset}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const paths = modelPaths(dim, asset);
  if (!fs.existsSync(paths.onnx) || !fs.existsSync(paths.meta)) {
    throw new Error(
      `[intradim-ml] model artifacts missing for ${dim}/${asset} (version=${modelVersion()}). ` +
        `Train: python train_dim.py --dim ${dim} --asset ${asset}`,
    );
  }

  const meta = JSON.parse(fs.readFileSync(paths.meta, "utf-8")) as DimModelMeta;
  const session = await ort.InferenceSession.create(paths.onnx);
  const probName =
    session.outputNames.find((n) => n.toLowerCase().includes("prob")) ??
    session.outputNames[session.outputNames.length - 1]!;
  const loaded: LoadedDimModel = {
    session,
    meta,
    inputName: session.inputNames[0]!,
    probabilityOutputName: probName,
    winIndex: meta.onnx_output_index_for_win ?? 1,
  };
  cache.set(key, loaded);
  return loaded;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function runDimModel(
  dim: DimensionEnum,
  asset: $Enums.Asset,
  rawFeatures: Record<string, number>,
): Promise<IntradimMlResult> {
  if (Object.keys(rawFeatures).length === 0) {
    throw new Error(`[intradim-ml] no features extracted for ${dim}/${asset}`);
  }

  const model = await loadDimModel(dim, asset);
  const features = new Float32Array(model.meta.feature_order.map((k) => rawFeatures[k] ?? 0));
  const tensor = new ort.Tensor("float32", features, [1, features.length]);

  const result = await model.session.run({ [model.inputName]: tensor });
  const probsTensor = result[model.probabilityOutputName];
  if (!probsTensor) {
    throw new Error(`[intradim-ml] output tensor missing for ${dim}/${asset}`);
  }
  const probs = probsTensor.data as Float32Array;
  const pUp = probs[model.winIndex];
  if (typeof pUp !== "number" || Number.isNaN(pUp)) {
    throw new Error(`[intradim-ml] invalid probability for ${dim}/${asset}: ${String(pUp)}`);
  }
  return {
    score: round3(2 * pUp - 1),
    pUp: round3(pUp),
    modelVersion: model.meta.version,
  };
}

/** Run all per-dimension ML sub-models for the given asset in parallel. Throws if any model is missing or fails. */
export async function runIntradimMl(asset: $Enums.Asset, rawFeatures: RawFeaturesByDim): Promise<IntradimMlResults> {
  const [derivatives, etfs, htf, exchangeFlows] = await Promise.all([
    runDimModel(DimensionEnum.DERIVATIVES, asset, rawFeatures.DERIVATIVES),
    runDimModel(DimensionEnum.ETFS, asset, rawFeatures.ETFS),
    runDimModel(DimensionEnum.HTF, asset, rawFeatures.HTF),
    runDimModel(DimensionEnum.EXCHANGE_FLOWS, asset, rawFeatures.EXCHANGE_FLOWS),
  ]);

  return {
    [DimensionEnum.DERIVATIVES]: derivatives,
    [DimensionEnum.ETFS]: etfs,
    [DimensionEnum.HTF]: htf,
    [DimensionEnum.EXCHANGE_FLOWS]: exchangeFlows,
  };
}
