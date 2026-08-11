import {
  TIME_COLUMN_ALIASES,
  DEFAULT_SYNTHETIC_RATE_HZ,
  CONTEXT_COLUMN_HINTS,
  type ParsedSample,
  type TimeSource,
} from "./types"

export interface CsvParseResult {
  header: string[]
  timeColumn: string | null
  timeSource: TimeSource
  syntheticRateHz: number
  samples: ParsedSample[]
  rowCount: number
  channelIds: string[]
  contextColumns: string[]
  unknownColumns: string[]
  skippedColumns: string[]
  guessSamplingRateHz: number
  nonFinite: number
  unsorted: boolean
  warnings: string[]
}

const MOX_CHANNEL_IDS = ["VOC", "Alcohol", "LPG", "CO", "NO2", "C2H5OH"]

function parseRow(raw: string): string[] {
  const cells: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === "," && !inQuotes) {
      cells.push(current)
      current = ""
    } else {
      current += c
    }
  }
  cells.push(current)
  return cells
}

export function detectTimeColumn(header: string[]): string | null {
  const lowered = header.map((h) => h.toLowerCase().trim())
  for (const alias of TIME_COLUMN_ALIASES) {
    const idx = lowered.indexOf(alias)
    if (idx >= 0) return header[idx]
  }
  return null
}

export function isContextColumn(name: string): boolean {
  const n = name.toLowerCase()
  return CONTEXT_COLUMN_HINTS.some((hint) => n.includes(hint))
}

export function parseCsv(text: string): CsvParseResult {
  const warnings: string[] = []
  const rawRows = text.split(/\r?\n/)
  const rows = rawRows
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !r.startsWith("#"))

  if (rows.length === 0) {
    throw new Error("The CSV file is empty.")
  }
  if (rows.length === 1) {
    throw new Error("The CSV has a header but no data rows.")
  }

  const header = parseRow(rows[0]).map((h) => h.trim())
  if (header.length === 0) {
    throw new Error("The CSV has no columns.")
  }

  const timeCol = detectTimeColumn(header)
  const timeSource: TimeSource = timeCol !== null ? "column" : "synthetic"
  const syntheticRateHz = timeSource === "synthetic" ? DEFAULT_SYNTHETIC_RATE_HZ : 0
  if (timeSource === "synthetic") {
    warnings.push(
      "No time column found (expected timestamp_ms or elapsed_ms); synthesized 10 Hz timing from row index. Add a timestamp column for accurate time-based features.",
    )
  }

  const timeIdx = timeCol !== null ? header.indexOf(timeCol) : -1
  const candidateCols = header.filter((_, i) => i !== timeIdx)
  const contextColumns = candidateCols.filter(isContextColumn)
  const sensorCandidates = candidateCols.filter((c) => !contextColumns.includes(c))
  if (contextColumns.length > 0) {
    warnings.push(
      `Detected context column(s) kept as metadata, not scored: ${contextColumns.join(", ")}.`,
    )
  }

  // First pass: decide which columns are numeric enough to be channels.
  const numericCount: Record<string, number> = {}
  for (const c of sensorCandidates) numericCount[c] = 0
  for (let r = 1; r < rows.length; r++) {
    const cells = parseRow(rows[r])
    for (const c of sensorCandidates) {
      const idx = header.indexOf(c)
      if (idx < cells.length && safeFloat(cells[idx]) !== null) numericCount[c]++
    }
  }
  const channelIds = sensorCandidates.filter((c) => numericCount[c] > 0)
  const skippedColumns = sensorCandidates.filter((c) => numericCount[c] === 0)
  if (skippedColumns.length > 0) {
    warnings.push(`Non-numeric column(s) skipped: ${skippedColumns.join(", ")}.`)
  }
  const unknownColumns = channelIds.filter((c) => !MOX_CHANNEL_IDS.includes(c))
  if (unknownColumns.length > 0) {
    warnings.push(
      `Column(s) not in the MOX set treated as sensor channels: ${unknownColumns.join(", ")}.`,
    )
  }

  const samples: ParsedSample[] = []
  let nonFinite = 0
  let unsorted = false

  for (let r = 1; r < rows.length; r++) {
    const cells = parseRow(rows[r])
    if (cells.length !== header.length) continue

    let rawTime: number
    if (timeSource === "column") {
      const t = safeFloat(cells[timeIdx])
      if (t === null) {
        nonFinite++
        continue
      }
      rawTime = t
    } else {
      rawTime = samples.length * 100
    }

    const values: Record<string, number | null> = {}
    let rowHasNonFinite = false
    for (const ch of channelIds) {
      const colIdx = header.indexOf(ch)
      if (colIdx < 0) continue
      const raw = safeFloat(cells[colIdx])
      if (raw === null) {
        nonFinite++
        rowHasNonFinite = true
        continue
      }
      values[ch] = raw
    }
    if (rowHasNonFinite) continue

    for (const col of contextColumns) {
      const colIdx = header.indexOf(col)
      if (colIdx < 0) continue
      values[col] = safeFloat(cells[colIdx])
    }

    samples.push({ time: rawTime, values })
  }

  for (let i = 1; i < samples.length; i++) {
    if (samples[i].time < samples[i - 1].time) {
      unsorted = true
      break
    }
  }

  if (unsorted) {
    samples.sort((a, b) => a.time - b.time)
  }

  const gaps = samples.slice(1).map((s, i) => s.time - samples[i].time)
  const medianGap = median(gaps.filter((g) => g > 0))
  const guessSamplingRateHz =
    timeSource === "synthetic"
      ? DEFAULT_SYNTHETIC_RATE_HZ
      : medianGap !== null
        ? 1000 / medianGap
        : DEFAULT_SYNTHETIC_RATE_HZ

  return {
    header,
    timeColumn: timeCol,
    timeSource,
    syntheticRateHz,
    samples,
    rowCount: samples.length,
    channelIds,
    contextColumns,
    unknownColumns,
    skippedColumns,
    guessSamplingRateHz,
    nonFinite,
    unsorted,
    warnings,
  }
}

function safeFloat(raw: string): number | null {
  if (raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
