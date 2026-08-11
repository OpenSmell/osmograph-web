import {
  DEFAULT_R0_SAMPLES,
  type ChannelStats,
  type OsmellFile,
  type ParsedSample,
} from "./types"

export function channelSamples(
  samples: ParsedSample[],
  channelId: string,
): number[] {
  const out: number[] = []
  for (const s of samples) {
    const v = s.values[channelId]
    if (v !== undefined && v !== null) out.push(v)
  }
  return out
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function std(values: number[]): number {
  if (values.length === 0) return NaN
  const m = mean(values)
  const variance =
    values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length
  return Math.sqrt(variance)
}

export function r0FromSamples(values: number[], n = DEFAULT_R0_SAMPLES): number {
  const window = values.slice(0, n)
  if (window.length === 0) return NaN
  const r0 = median(window)
  return r0 > 0 ? r0 : mean(window.filter((v) => v > 0)) || 1
}

export interface BaselineResult {
  r0: number
  windowValues: number[]
  cv: number
}

/**
 * Compute R0 for a channel.
 *
 * When the file carries an explicit baseline, R0 is the median of the whole
 * baseline channel. Otherwise we fall back to auto-R0: the median of the first
 * r0Samples of the target channel (SmellNet-style session invariance without a
 * dedicated baseline file).
 */
export function baselineForChannel(
  file: OsmellFile,
  channelId: string,
  targetValues: number[],
): BaselineResult {
  const baseline = file.manifest.baseline
  const source = baseline?.source ?? "none"
  const r0Samples = baseline?.r0Samples ?? DEFAULT_R0_SAMPLES

  if (source === "explicit") {
    const b = file.data[channelId] ?? []
    const r0 = r0FromSamples(b, b.length)
    return { r0, windowValues: b, cv: std(b) / r0 }
  }

  const valid = targetValues
    .slice(0, r0Samples)
    .filter((v) => Number.isFinite(v))
  const r0 = r0FromSamples(valid, r0Samples)
  return { r0, windowValues: valid, cv: std(valid) / r0 }
}

export function normalizedSeries(values: number[], r0: number): number[] {
  if (!Number.isFinite(r0) || r0 <= 0) return values.map(() => NaN)
  return values.map((v) => (v - r0) / r0)
}

export function channelStats(values: number[], r0: number): ChannelStats {
  const finite = values.filter((v) => Number.isFinite(v))
  const nonFinite = values.length - finite.length
  const m = mean(finite)
  const sd = std(finite)
  const cv = r0 > 0 ? sd / r0 : Infinity
  const min = finite.length ? Math.min(...finite) : NaN
  const max = finite.length ? Math.max(...finite) : NaN
  return {
    id: "",
    min,
    max,
    mean: m,
    std: sd,
    r0,
    cv,
    dead: cv < 0.001,
    span: max - min,
    clipped: 0,
    nonFinite,
  }
}
