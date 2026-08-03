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
import {
  baselineForChannel,
  channelStats,
  mean,
  median,
  normalizedSeries,
} from "./normalize"

export interface QualityInput {
  file: OsmellFile
  sampleCount: number
  guessSamplingRateHz: number
  unsorted: boolean
  nonFinite: number
}

const WEIGHTS: Record<string, number> = {
  continuity: 0.15,
  dynamicRange: 0.10,
  saturationFree: 0.10,
  baselineStability: 0.20,
  signalStrength: 0.20,
  recoveryCompleteness: 0.15,
  durationAdequacy: 0.10,
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v))
}

function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v)
}

export function computeQuality(input: QualityInput): QualityReport {
  const { file, sampleCount, guessSamplingRateHz, unsorted, nonFinite } = input
  const sensor = file.manifest.sensor
  const adcDeclared = sensor.adcMax !== undefined
  const adcMax = sensor.adcMax ?? DEFAULT_ADC_MAX
  const rateDeclared = sensor.samplingRateHz !== undefined
  const samplingRateHz = sensor.samplingRateHz ?? guessSamplingRateHz
  const channelIds = sensor.channels.map((c) => c.id)
  const role = file.manifest.session?.role ?? "single"
  const baselineSource = file.manifest.baseline?.source ?? "none"

  const flags: QualityFlags = {
    deadSensors: [],
    unsortedRows: unsorted,
    nonFiniteSamples: nonFinite,
    usedDefaultAdcMax: !adcDeclared,
    usedMedianSamplingRate: !rateDeclared,
    noBaseline: baselineSource === "none",
    emptyRecording: sampleCount === 0,
  }

  const reasons: Record<string, string> = {}
  const notes: string[] = []

  // --- Continuity C (spec 7.1.1) ---
  let continuity: SubScore
  const gaps: number[] = []
  for (let i = 0; i < file.time.length - 1; i++) {
    gaps.push(file.time[i + 1] - file.time[i])
  }
  const positiveGaps = gaps.filter((g) => g > 0)
  if (sampleCount < 2) {
    continuity = { value: 100, reason: "ok" }
  } else {
    let nominal: number | null
    if (rateDeclared) {
      nominal = samplingRateHz > 0 ? 1000 / samplingRateHz : null
    } else {
      nominal = positiveGaps.length > 0 ? median(positiveGaps) : null
      if (nominal !== null) {
        notes.push(
          "samplingRateHz not declared; nominal period taken as the median gap.",
        )
      }
      flags.usedMedianSamplingRate = true
    }
    if (nominal !== null && nominal > 0 && Number.isFinite(nominal)) {
      const tol = GAP_TOLERANCE * nominal
      let regular = 0
      for (const g of gaps) {
        if (Math.abs(g - nominal) <= tol) regular++
      }
      const total = gaps.length
      continuity = {
        value: total === 0 ? 100 : (regular / total) * 100,
        reason: regular < total ? "irregular_gaps" : "ok",
      }
    } else {
      continuity = { value: 50, reason: "irregular_gaps" }
    }
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

  const live = stats.filter((s) => !s.dead)

  // --- Dynamic range D (spec 7.1.2) ---
  const dynamicValue =
    live.length === 0
      ? 0
      : 100 *
        mean(
          live.map((s) =>
            clamp((s.span / adcMax) * (1 / MIN_SPAN_FRACTION), 0, 1),
          ),
        )
  const dynamicRange: SubScore = {
    value: dynamicValue,
    reason: dynamicValue < 50 ? "low_span" : "ok",
  }
  if (dynamicRange.reason === "low_span") {
    reasons.dynamicRange = "channel_span_below_10_percent_of_adc_range"
  }

  // --- Saturation-free S (spec 7.1.3) ---
  const satScores: number[] = []
  for (const s of stats) {
    const values = file.data[s.id] ?? []
    let clipped = 0
    for (const v of values) {
      if (adcDeclared ? v >= adcMax || v <= 0 : v <= 0) clipped++
    }
    s.clipped = clipped
    satScores.push(
      values.length === 0 ? 100 : 100 * (1 - clipped / values.length),
    )
  }
  const saturationFree: SubScore = { value: mean(satScores), reason: "ok" }

  // --- Baseline stability B (spec 7.1.4) ---
  let baselineStability: SubScore
  if (baselineSource === "none") {
    baselineStability = { value: 0, reason: "no_baseline" }
  } else {
    const cvs: number[] = []
    for (const s of stats) {
      const values = file.data[s.id] ?? []
      cvs.push(baselineForChannel(file, s.id, values).cv)
    }
    const finiteCvs = cvs.filter(isFiniteNumber)
    const cvWindow = finiteCvs.length > 0 ? mean(finiteCvs) : NaN
    const rawB = 100 * clamp(1 - cvWindow / NOISE_CV_LIMIT, 0, 1)
    if (baselineSource === "auto") {
      baselineStability = { value: Math.min(rawB, 50), reason: "auto_r0" }
    } else {
      baselineStability = {
        value: rawB,
        reason: cvWindow >= NOISE_CV_LIMIT ? "r0_window_cv_too_high" : "ok",
      }
    }
  }

  // --- Signal strength G + Recovery completeness R (spec 7.1.5 / 7.1.6) ---
  const exposureWithR0 = role === "exposure" && baselineSource !== "none"
  let signalStrength: SubScore
  let recovery: SubScore
  if (!exposureWithR0) {
    signalStrength = { value: null, reason: "no_exposure_signal" }
    recovery = { value: null, reason: "no_exposure_signal" }
  } else {
    const bestG: number[] = []
    const recoveryScores: number[] = []
    for (const s of live) {
      const values = file.data[s.id] ?? []
      const base = baselineForChannel(file, s.id, values)
      const norm = normalizedSeries(values, base.r0).filter(isFiniteNumber)
      const noise = Math.max(base.cv, 1e-6)
      if (norm.length === 0) {
        bestG.push(0)
        recoveryScores.push(0)
        continue
      }
      const peak = Math.max(...norm.map((v) => Math.abs(v)))
      bestG.push(clamp(peak / noise / SNR_TARGET, 0, 1) * 100)
      const finalWin = median(norm.slice(-15))
      const recovered = 1 - clamp(Math.abs(finalWin) / Math.max(peak, 1e-6), 0, 1)
      recoveryScores.push(100 * recovered)
    }
    signalStrength = {
      value: bestG.length > 0 ? Math.max(...bestG) : 0,
      reason: "ok",
    }
    recovery = {
      value: recoveryScores.length > 0 ? mean(recoveryScores) : 0,
      reason: "ok",
    }
  }

  // --- Duration adequacy T (spec 7.1.7) ---
  const tSeconds =
    samplingRateHz > 0 ? (sampleCount - 1) / samplingRateHz : 0
  const durationAdequacy: SubScore = {
    value: 100 * clamp(tSeconds / FULL_SCORE_DURATION_S, 0, 1),
    reason: tSeconds < FULL_SCORE_DURATION_S ? "too_short" : "ok",
  }

  const subs = {
    continuity,
    dynamicRange,
    saturationFree,
    baselineStability,
    signalStrength,
    recoveryCompleteness: recovery,
    durationAdequacy,
  }

  let weighted = 0
  let sumW = 0
  for (const [k, sub] of Object.entries(subs)) {
    if (sub.value === null) continue
    weighted += WEIGHTS[k] * sub.value
    sumW += WEIGHTS[k]
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

  if (flags.deadSensors.length)
    notes.push(`Dead sensors (cv < 0.001): ${flags.deadSensors.join(", ")}`)
  if (flags.nonFiniteSamples)
    notes.push(`${flags.nonFiniteSamples} non-finite values skipped.`)
  if (flags.unsortedRows) notes.push("Rows were out of order and were sorted.")
  if (!rateDeclared)
    notes.push("Sampling rate inferred from median gap; verify against hardware.")
  if (!adcDeclared)
    notes.push(
      "adcMax not declared; upper-rail clipping not checked (lower rail only).",
    )
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
