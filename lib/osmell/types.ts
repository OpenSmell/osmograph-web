export const OSMELL_FORMAT_VERSION = "1.0.0"

export const TIME_COLUMNS = ["timestamp_ms", "elapsed_ms"] as const
/** Broader accepted time-column names for tolerant CSV import (matched case-insensitively). */
export const TIME_COLUMN_ALIASES = [
  "timestamp_ms",
  "elapsed_ms",
  "timestamp",
  "elapsed",
  "time_ms",
  "time_s",
  "time",
  "synthetic_index",
] as const
/** Timing assumed for CSVs with no time column (recorded as `timeSource: "synthetic"`). */
export const DEFAULT_SYNTHETIC_RATE_HZ = 10.0
/** Environmental columns preserved as metadata, never scored as sensor channels. */
export const CONTEXT_COLUMN_HINTS = [
  "temperature",
  "pressure",
  "humidity",
  "gas_res",
  "resistance",
  "altitude",
] as const

export type TimeColumn = (typeof TIME_COLUMNS)[number] | (typeof TIME_COLUMN_ALIASES)[number]
export type TimeSource = "column" | "synthetic"

export const SENSOR_TYPES = ["mox", "miris", "electrochemical", "other", "unknown"] as const
export type SensorType = (typeof SENSOR_TYPES)[number]

export const SESSION_ROLES = ["baseline", "exposure", "single"] as const
export type SessionRole = (typeof SESSION_ROLES)[number]

export const BASELINE_SOURCES = ["explicit", "auto", "none"] as const
export type BaselineSource = (typeof BASELINE_SOURCES)[number]

export interface ChannelDescriptor {
  id: string
  unit: string
  target?: string
}

export interface DeviceDescriptor {
  model?: string
  serial?: string
  firmware?: string
}

export interface CalibrationDescriptor {
  a: number
  b: number
  referenceSubstance?: string
  referencePpm?: number
  date?: string
  method?: string
}

export interface SensorDescriptor {
  sensorType: SensorType
  device?: DeviceDescriptor
  channels: ChannelDescriptor[]
  samplingRateHz?: number
  adcBits?: number
  adcMax?: number
  timeColumn: string
  calibration?: Record<string, CalibrationDescriptor>
}

export interface SessionDescriptor {
  role: SessionRole
  label?: string
  groupId?: string
  recordedAt?: string
  durationMs?: number
  notes?: string
}

export interface BaselineDescriptor {
  source: BaselineSource
  file?: string
  r0Samples?: number
}

export interface IngestProvenance {
  sourceFile?: string
  timeSource?: TimeSource
  syntheticRateHz?: number | null
  timeColumn?: string | null
  contextColumns?: string[]
  unknownColumns?: string[]
  skippedColumns?: string[]
  warnings?: string[]
  context?: Record<string, (number | null)[]>
}

export interface OsmellManifest {
  osmell: {
    formatVersion: string
    specUrl?: string
  }
  sensor: SensorDescriptor
  session: SessionDescriptor
  baseline?: BaselineDescriptor
  software?: {
    recorder?: string
    importer?: string
  }
  extra?: {
    ingest?: IngestProvenance
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SessionEvent {
  label: string
  startMs: number
  endMs?: number
  note?: string
}

export interface OsmellFile {
  manifest: OsmellManifest
  time: number[]
  data: Record<string, number[]>
  events?: SessionEvent[]
}

export interface ParsedSample {
  time: number
  values: Record<string, number | null>
}

export interface ChannelStats {
  id: string
  min: number
  max: number
  mean: number
  std: number
  r0: number
  cv: number
  dead: boolean
  span: number
  clipped: number
  nonFinite: number
}

export interface QualityFlags {
  deadSensors: string[]
  unsortedRows: boolean
  nonFiniteSamples: number
  usedDefaultAdcMax: boolean
  usedMedianSamplingRate: boolean
  noBaseline: boolean
  emptyRecording: boolean
}

export type QualityReasonCode =
  | "no_baseline"
  | "r0_window_cv_too_high"
  | "no_exposure_signal"
  | "irregular_gaps"
  | "low_span"
  | "clipping"
  | "too_short"
  | "auto_r0"
  | "ok"

export interface SubScore {
  value: number | null
  reason?: QualityReasonCode
}

export interface QualityReport {
  format: "opensmell-quality"
  version: "1"
  computedAt: string
  total: number | null
  badge: "Excellent" | "Good" | "Fair" | "Poor" | "Unknown"
  subscores: {
    continuity: SubScore
    dynamicRange: SubScore
    saturationFree: SubScore
    baselineStability: SubScore
    signalStrength: SubScore
    recoveryCompleteness: SubScore
    durationAdequacy: SubScore
  }
  flags: QualityFlags
  reasons: Record<string, string>
  notes: string[]
}

export const DEFAULT_ADC_MAX = 4095
export const DEFAULT_R0_SAMPLES = 15
export const DEAD_CV_THRESHOLD = 0.001
export const NOISE_CV_LIMIT = 0.05
export const SNR_TARGET = 10
export const FULL_SCORE_DURATION_S = 60
export const MIN_SPAN_FRACTION = 0.1
export const GAP_TOLERANCE = 0.1
