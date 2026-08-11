import type {
  ChannelStats,
  OsmellFile,
  SensorType,
} from "./types"
import { DEFAULT_R0_SAMPLES, DEFAULT_SYNTHETIC_RATE_HZ } from "./types"
import { baselineForChannel, channelStats, normalizedSeries, std } from "./normalize"
import { parseCsv } from "./csv"

export interface MoxFeatures {
  channel: string
  relativeAmplitude: number
  direction: 1 | -1
  riseTimeMs: number | null
  decayTimeMs: number | null
  auc: number
  r0: number
  dead: boolean
  endpointDelta: number
  saturationIndex: number
}

export interface MoxProcessorResult {
  sensorType: "mox"
  features: MoxFeatures[]
  normalized: Record<string, number[]>
}

function firstCrossTime(
  time: number[],
  norm: number[],
  threshold: number,
): number | null {
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] >= threshold) return time[i]
  }
  return null
}

export function processMox(file: OsmellFile): MoxProcessorResult {
  const channels = file.manifest.sensor.channels
  const r0Samples = file.manifest.baseline?.r0Samples ?? DEFAULT_R0_SAMPLES
  const features: MoxFeatures[] = []
  const normalized: Record<string, number[]> = {}

  for (const ch of channels) {
    const values = file.data[ch.id] ?? []
    const r0 = baselineForChannel(file, ch.id, values).r0
    const stats: ChannelStats = channelStats(values, r0)
    const norm = normalizedSeries(values, r0)

    const finiteNorm = norm.filter((v) => Number.isFinite(v))
    let relativeAmplitude = 0
    let direction: 1 | -1 = 1
    let auc = 0
    let riseTimeMs: number | null = null
    let decayTimeMs: number | null = null
    let endpointDelta = 0
    let saturationIndex = 0

    if (!stats.dead && finiteNorm.length > 0) {
      const maxVal = Math.max(...finiteNorm)
      const minVal = Math.min(...finiteNorm)
      const peak = Math.abs(maxVal) >= Math.abs(minVal) ? maxVal : minVal
      direction = peak >= 0 ? 1 : -1
      relativeAmplitude = Math.abs(peak)

      const span = maxVal - minVal
      const t10 = firstCrossTime(file.time, norm, minVal + 0.1 * span)
      const t90 = firstCrossTime(file.time, norm, minVal + 0.9 * span)
      if (t10 !== null && t90 !== null) {
        riseTimeMs = t90 - t10
      }

      let prev = norm[0]
      for (let i = 1; i < norm.length; i++) {
        const dt = file.time[i] - file.time[i - 1]
        if (dt > 0) auc += (norm[i] + prev) * dt * 0.5
        prev = norm[i]
      }

      const peakIdx = argmaxAbs(norm)
      decayTimeMs = decayTimeMsAfter(norm, file.time, peakIdx)
      endpointDelta = norm[norm.length - 1] ?? 0
      saturationIndex = saturationIndexFor(norm, r0Samples)
    }

    normalized[ch.id] = norm
    features.push({
      channel: ch.id,
      relativeAmplitude,
      direction,
      riseTimeMs,
      decayTimeMs,
      auc,
      r0,
      dead: stats.dead,
      endpointDelta,
      saturationIndex,
    })
  }

  return { sensorType: "mox", features, normalized }
}

function argmaxAbs(values: number[]): number {
  let best = 0
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i]) > Math.abs(values[best])) best = i
  }
  return best
}

function decayTimeMsAfter(
  norm: number[],
  time: number[],
  peakIdx: number,
): number | null {
  if (norm.length - peakIdx <= 2) return null
  const pk = norm[peakIdx]
  if (!Number.isFinite(pk) || pk === 0) return null
  const t90 = 0.9 * pk
  const t10 = 0.1 * pk
  const nearPeak = (v: number) => (pk >= 0 ? v >= t90 : v <= t90)
  const nearBaseline = (v: number) => (pk >= 0 ? v <= t10 : v >= t10)
  let si = -1
  for (let i = peakIdx; i < norm.length; i++) {
    if (nearPeak(norm[i])) {
      si = i
      break
    }
  }
  if (si < 0) return null
  for (let i = si; i < norm.length; i++) {
    if (nearBaseline(norm[i])) {
      return time[i] - time[peakIdx]
    }
  }
  return null
}

function saturationIndexFor(norm: number[], r0Samples: number): number {
  if (norm.length < r0Samples + 5) return 0
  const r0Norm = norm.slice(0, r0Samples)
  const currentResponse = Math.max(...norm.map((v) => Math.abs(v)))
  const noiseFloor = std(r0Norm)
  if (!Number.isFinite(noiseFloor) || currentResponse < noiseFloor * 2) return 0
  return Math.min(1, currentResponse / (currentResponse + noiseFloor * 10))
}

export interface ProcessorResult {
  sensorType: SensorType
  features?: MoxFeatures[]
  normalized?: Record<string, number[]>
}

export function runProcessor(file: OsmellFile): ProcessorResult {
  const type = file.manifest.sensor.sensorType
  if (type === "mox") return processMox(file)
  if (type === "miris" || type === "electrochemical") {
    return {
      sensorType: type,
      normalized: file.data,
    }
  }
  return { sensorType: "other" }
}

export function guessSensorType(header: string[]): SensorType {
  const knownMox = ["VOC", "Alcohol", "LPG", "CO", "NO2", "C2H5OH"]
  const hits = header.filter((h) => knownMox.includes(h))
  return hits.length >= 2 ? "mox" : "unknown"
}

export async function inferFromCsv(
  text: string,
): Promise<{ sensorType: SensorType; guessSamplingRateHz: number; channelIds: string[] }> {
  const parsed = parseCsv(text)
  return {
    sensorType: guessSensorType(parsed.channelIds),
    guessSamplingRateHz: parsed.guessSamplingRateHz || DEFAULT_SYNTHETIC_RATE_HZ,
    channelIds: parsed.channelIds,
  }
}
