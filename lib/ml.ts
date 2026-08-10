import type { MoxFeatures } from "@/lib/osmell/processors"

// Client-side multinomial logistic regression (softmax) with stratified
// k-fold cross-validation — the web counterpart to the sklearn
// LogisticRegression trainer in Osmograph desktop. Pure math, no dependencies.

export interface TrainingSample {
  label: string
  features: number[]
}

export interface ClassResult {
  n: number
  correct: number
  precision: number
  recall: number
}

export interface TrainResult {
  classes: string[]
  nSamples: number
  nFeatures: number
  folds: number
  cvAccuracy: number
  trainAccuracy: number
  baseline: number
  perClass: Record<string, ClassResult>
  confusion: number[][]
  error: string | null
}

const FEATURE_FIELDS = [
  "relative_amplitude",
  "direction",
  "rise_time_ms",
  "decay_time_ms",
  "auc",
  "endpoint_delta",
  "saturation_index",
] as const

export function featureNames(channelCount: number): string[] {
  const out: string[] = []
  for (let ch = 0; ch < channelCount; ch++) {
    for (const field of FEATURE_FIELDS) out.push(`ch${ch}_${field}`)
  }
  return out
}

// Per-channel kinetic features, flattened. r0 is intentionally excluded: it is
// device- and baseline-specific, and the whole point of the framework is
// device-agnostic discrimination of the (R - R0)/R0 response shape.
export function featuresFromMox(features: MoxFeatures[]): number[] {
  const out: number[] = []
  for (const f of features) {
    out.push(
      f.relativeAmplitude,
      f.direction,
      f.riseTimeMs ?? 0,
      f.decayTimeMs ?? 0,
      f.auc,
      f.endpointDelta,
      f.saturationIndex,
    )
  }
  return out
}

interface Folded {
  trainIdx: number[]
  testIdx: number[]
}

// Stratified k-fold: each class's samples are round-robinned across folds so
// every fold sees the full label mix.
export function stratifiedKFold(y: string[], k: number): Folded[] {
  const n = y.length
  if (k < 2) return [{ trainIdx: [], testIdx: [0] }]
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const list = buckets.get(y[i]) ?? []
    list.push(i)
    buckets.set(y[i], list)
  }
  const folds: number[][] = Array.from({ length: k }, () => [])
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      folds[i % k].push(list[i])
    }
  }
  return folds.map((testIdx) => {
    const testSet = new Set(testIdx)
    const trainIdx = []
    for (let i = 0; i < n; i++) {
      if (!testSet.has(i)) trainIdx.push(i)
    }
    return { trainIdx, testIdx }
  })
}

interface Model {
  weights: number[][] // [class][feature]
  mean: number[]
  std: number[]
}

// Full-batch softmax regression with L2. Features are assumed unstandardized;
// the returned model carries the fold's train-fold mean/std for prediction.
function fitSoftmax(X: number[][], y: string[], classes: string[]): Model {
  const d = X[0]?.length ?? 0
  const n = X.length
  const K = classes.length
  const labelIdx = new Map(classes.map((c, i) => [c, i]))

  const mean = new Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j]
  for (let j = 0; j < d; j++) mean[j] /= n

  const std = new Array(d).fill(0)
  for (const row of X) {
    for (let j = 0; j < d; j++) {
      const v = row[j] - mean[j]
      std[j] += v * v
    }
  }
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / n) || 1

  const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]))
  const Y: number[][] = X.map((row, i) => {
    const oneHot = new Array(K).fill(0)
    oneHot[labelIdx.get(y[i]) ?? 0] = 1
    return oneHot
  })

  let W: number[][] = Array.from({ length: K }, () => new Array(d + 1).fill(0))
  const lr = 0.1
  const l2 = 0.001
  const epochs = 400

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad: number[][] = Array.from({ length: K }, () => new Array(d + 1).fill(0))
    for (let i = 0; i < n; i++) {
      const logits = W.map((wRow) => {
        let z = wRow[d]
        for (let j = 0; j < d; j++) z += wRow[j] * Z[i][j]
        return z
      })
      const maxLogit = Math.max(...logits)
      const exps = logits.map((z) => Math.exp(z - maxLogit))
      const sumExp = exps.reduce((a, b) => a + b, 0)
      for (let k = 0; k < K; k++) {
        const p = exps[k] / sumExp
        const err = p - Y[i][k]
        for (let j = 0; j < d; j++) grad[k][j] += err * Z[i][j]
        grad[k][d] += err
      }
    }
    for (let k = 0; k < K; k++) {
      for (let j = 0; j <= d; j++) {
        W[k][j] -= lr * (grad[k][j] / n + l2 * W[k][j])
      }
    }
  }

  return { weights: W, mean, std }
}

function predict(model: Model, x: number[], classes: string[]): string {
  const d = x.length
  const z = x.map((v, j) => (v - model.mean[j]) / model.std[j])
  let bestK = 0
  let bestScore = -Infinity
  for (let k = 0; k < classes.length; k++) {
    const wRow = model.weights[k]
    let score = wRow[d]
    for (let j = 0; j < d; j++) score += wRow[j] * z[j]
    if (score > bestScore) {
      bestScore = score
      bestK = k
    }
  }
  return classes[bestK]
}

function accuracy(model: Model, X: number[][], y: string[], classes: string[]): number {
  let correct = 0
  for (let i = 0; i < X.length; i++) {
    if (predict(model, X[i], classes) === y[i]) correct++
  }
  return correct / X.length
}

export function trainCrossValidated(
  samples: TrainingSample[],
  folds: number,
): TrainResult {
  if (samples.length === 0) {
    return emptyResult("No labeled sessions with features available.")
  }
  const classes = [...new Set(samples.map((s) => s.label))].sort()
  const nFeatures = samples[0].features.length
  if (nFeatures === 0) {
    return emptyResult("Sessions have no channel features to train on.")
  }
  if (classes.length < 2) {
    return emptyResult("Need at least 2 distinct labels to fit a model.")
  }

  const X = samples.map((s) => s.features)
  const y = samples.map((s) => s.label)
  const k = Math.max(2, Math.min(folds, Math.min(...classes.map((c) => samples.filter((s) => s.label === c).length))))

  const foldsIdx = stratifiedKFold(y, k)
  const confusion = Array.from({ length: classes.length }, () => new Array(classes.length).fill(0))
  const perClass: Record<string, ClassResult> = {}
  for (const c of classes) perClass[c] = { n: 0, correct: 0, precision: 0, recall: 0 }

  let cvCorrect = 0
  for (const { trainIdx, testIdx } of foldsIdx) {
    if (trainIdx.length === 0) continue
    const model = fitSoftmax(
      trainIdx.map((i) => X[i]),
      trainIdx.map((i) => y[i]),
      classes,
    )
    for (const i of testIdx) {
      const predicted = predict(model, X[i], classes)
      const truth = y[i]
      const ti = classes.indexOf(truth)
      const pi = classes.indexOf(predicted)
      confusion[ti][pi]++
      perClass[truth].n++
      if (predicted === truth) {
        perClass[truth].correct++
        cvCorrect++
      }
    }
  }

  const fullModel = fitSoftmax(X, y, classes)
  const cvAccuracy = cvCorrect / samples.length
  const trainAccuracy = accuracy(fullModel, X, y, classes)
  const baseline =
    Math.max(...classes.map((c) => samples.filter((s) => s.label === c).length)) / samples.length

  for (const c of classes) {
    const idx = classes.indexOf(c)
    const tp = perClass[c].correct
    const pred = classes.reduce((sum, _, j) => sum + confusion[j][idx], 0)
    perClass[c].precision = tp / (pred || 1)
    perClass[c].recall = tp / (perClass[c].n || 1)
  }

  return {
    classes,
    nSamples: samples.length,
    nFeatures,
    folds: k,
    cvAccuracy,
    trainAccuracy,
    baseline,
    perClass,
    confusion,
    error: null,
  }
}

function emptyResult(error: string): TrainResult {
  return {
    classes: [],
    nSamples: 0,
    nFeatures: 0,
    folds: 0,
    cvAccuracy: 0,
    trainAccuracy: 0,
    baseline: 0,
    perClass: {},
    confusion: [],
    error,
  }
}
