import type {
  ChannelStats,
  OsmellFile,
  SensorType,
} from "./types"
import { baselineForChannel, channelStats, normalizedSeries } from "./normalize"
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
    const decayTimeMs: number | null = null

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
    })
  }

  return { sensorType: "mox", features, normalized }
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
    guessSamplingRateHz: parsed.guessSamplingRateHz,
    channelIds: parsed.channelIds,
  }
}
