import {
  DEFAULT_ADC_MAX,
  FULL_SCORE_DURATION_S,
  GAP_TOLERANCE,
  MIN_SPAN_FRACTION,
  NOISE_CV_LIMIT,
  SNR_TARGET,
  type ChannelStats,
  type OsmellFile,
  type QualityFlags,
  type QualityReport,
  type SubScore,
} from "./types"
import { baselineForChannel, channelStats, mean, normalizedSeries } from "./normalize"

export interface QualityInput {
  file: OsmellFile
  sampleCount: number
  guessSamplingRateHz: number
  unsorted: boolean
  nonFinite: number
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v))
}

export function computeQuality(input: QualityInput): QualityReport {
  const { file, sampleCount, guessSamplingRateHz, unsorted, nonFinite } = input
  const sensor = file.manifest.sensor
  const adcMax = sensor.adcMax ?? DEFAULT_ADC_MAX
  const usedDefaultAdcMax = sensor.adcMax === undefined
  const samplingRateHz = sensor.samplingRateHz ?? guessSamplingRateHz
  const usedMedianSamplingRate = sensor.samplingRateHz === undefined
  const nominalPeriodMs = samplingRateHz > 0 ? 1000 / samplingRateHz : NaN
  const channelIds = sensor.channels.map((c) => c.id)
  const role = file.manifest.session.role
  const baselineSource = file.manifest.baseline?.source ?? "none"

  const flags: QualityFlags = {
    deadSensors: [],
    unsortedRows: unsorted,
    nonFiniteSamples: nonFinite,
    usedDefaultAdcMax,
    usedMedianSamplingRate,
    noBaseline: baselineSource === "none",
    emptyRecording: sampleCount === 0,
  }

  const reasons: Record<string, string> = {}

  // --- Continuity ---
  let continuity: SubScore
  if (sampleCount < 2) {
    continuity = { value: 100, reason: "ok" }
  } else if (Number.isFinite(nominalPeriodMs) && nominalPeriodMs > 0) {
    const times = file.time
    const tol = GAP_TOLERANCE * nominalPeriodMs
    let regular = 0
    const total = times.length - 1
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1]
      if (Math.abs(gap - nominalPeriodMs) <= tol) regular++
    }
    continuity = {
      value: total === 0 ? 100 : (regular / total) * 100,
      reason: regular < total ? "irregular_gaps" : "ok",
    }
  } else {
    continuity = { value: 50, reason: "irregular_gaps" }
    reasons.continuity = "no_sampling_rate_declared"
  }

  // --- Per-channel stats with R0 ---
  const stats: ChannelStats[] = channelIds.map((id) => {
    const values = file.data[id] ?? []
    const r0 = baselineForChannel(file, id, values).r0
    const st = channelStats(values, r0)
    st.id = id
    if (st.dead) flags.deadSensors.push(id)
    return st
  })

  // --- Dynamic range ---
  const live = stats.filter((s) => !s.dead)
  const dynamicValue =
    live.length === 0 ? 0 : 100 * mean(live.map((s) => clamp((s.span / adcMax) * (1 / MIN_SPAN_FRACTION), 0, 1)))
  const dynamicRange: SubScore = {
    value: dynamicValue,
    reason: dynamicValue < 50 ? "low_span" : "ok",
  }
  if (dynamicRange.reason === "low_span") {
    reasons.dynamicRange = "channel_span_below_10_percent_of_adc_range"
  }

  // --- Saturation-free ---
  const satScores = stats.map((s) => {
    const values = file.data[s.id] ?? []
    const clipped = values.filter((v) => v >= adcMax || v <= 0).length
    s.clipped = clipped
    return 1 - (values.length === 0 ? 1 : clipped / values.length)
  })
  const saturationFree: SubScore = {
    value: 100 * mean(satScores),
    reason: "ok",
  }

  // --- Baseline stability ---
  let baselineStability: SubScore
  if (baselineSource === "none") {
    baselineStability = { value: 0, reason: "no_baseline" }
  } else {
    const windowCvs = stats.map((s) => {
      const values = file.data[s.id] ?? []
      const base = baselineForChannel(file, s.id, values)
      return base.cv
    })
    const cvWindow = mean(windowCvs.filter((v) => Number.isFinite(v)))
    baselineStability = {
      value: 100 * clamp(1 - cvWindow / NOISE_CV_LIMIT, 0, 1),
      reason: cvWindow >= NOISE_CV_LIMIT ? "r0_window_cv_too_high" : "ok",
    }
  }

  // --- Signal strength (exposure only) ---
  let signalStrength: SubScore
  if (role !== "exposure" || baselineSource === "none") {
    signalStrength = { value: null, reason: "no_exposure_signal" }
  } else {
    const bestG = stats.map((s) => {
      const values = file.data[s.id] ?? []
      const r0 = baselineForChannel(file, s.id, values).r0
      const norm = normalizedSeries(values, r0).filter((v) => Number.isFinite(v))
      if (norm.length === 0) return 0
      const peak = Math.max(...norm.map((v) => Math.abs(v)))
      const base = baselineForChannel(file, s.id, values)
      const noise = Math.max(base.cv, 1e-6)
      const snr = peak / noise
      return clamp(snr / SNR_TARGET, 0, 1)
    })
    signalStrength = {
      value: 100 * Math.max(...bestG),
      reason: "ok",
    }
  }

  // --- Duration adequacy ---
  const durationS = samplingRateHz > 0 ? sampleCount / samplingRateHz : 0
  const durationAdequacy: SubScore = {
    value: 100 * clamp(durationS / FULL_SCORE_DURATION_S, 0, 1),
    reason: durationS < FULL_SCORE_DURATION_S ? "too_short" : "ok",
  }

  const subs = {
    continuity,
    dynamicRange,
    saturationFree,
    baselineStability,
    signalStrength,
    durationAdequacy,
  }

  const weights: Record<string, number> = {
    continuity: 0.2,
    dynamicRange: 0.15,
    saturationFree: 0.15,
    baselineStability: 0.2,
    signalStrength: 0.2,
    durationAdequacy: 0.1,
  }

  let weighted = 0
  let sumW = 0
  for (const [k, sub] of Object.entries(subs)) {
    if (sub.value === null) continue
    weighted += weights[k] * sub.value
    sumW += weights[k]
  }

  const total = sumW > 0 ? Math.round(weighted / sumW) : null
  const badge =
    total === null
      ? "Unknown"
      : total >= 90
        ? "Excellent"
        : total >= 75
          ? "Good"
          : total >= 50
            ? "Fair"
            : "Poor"

  const notes: string[] = []
  if (flags.deadSensors.length)
    notes.push(`Dead sensors (cv < 0.001): ${flags.deadSensors.join(", ")}`)
  if (flags.nonFiniteSamples)
    notes.push(`${flags.nonFiniteSamples} non-finite values skipped.`)
  if (flags.unsortedRows) notes.push("Rows were out of order and were sorted.")
  if (flags.usedMedianSamplingRate)
    notes.push("Sampling rate inferred from median gap; verify against hardware.")
  if (flags.usedDefaultAdcMax)
    notes.push("adcMax not declared; assumed 4095 for clipping checks.")
  if (flags.noBaseline)
    notes.push("No baseline; auto-R0 applied and baseline stability scores zero.")

  return {
    format: "opensmell-quality",
    version: "1",
    computedAt: new Date().toISOString(),
    total,
    badge,
    subscores: subs,
    flags,
    reasons,
    notes,
  }
}
