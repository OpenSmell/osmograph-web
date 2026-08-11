import {
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

/** Detected time column with its assumed unit. */
interface TimeColumnInfo {
  name: string
  unit: "ms" | "s"
}

/**
 * Match a time column by name, tolerating whitespace, parentheses and common
 * unit suffixes. Returns `null` when no column looks like a time axis.
 */
function detectTimeColumnInfo(header: string[]): TimeColumnInfo | null {
  for (const raw of header) {
    const n = raw
      .toLowerCase()
      .trim()
      .replace(/[\(\[\]\)]/g, "")
      .replace(/\s+/g, "")
    if (/^(timestamp|elapsed)(_ms)?$/.test(n)) return { name: raw, unit: "ms" }
    if (/^(time)(_ms)?$/.test(n)) return { name: raw, unit: "ms" }
    if (/^(time)(_s|s)$/.test(n)) return { name: raw, unit: "s" }
    if (/^synthetic_index$/.test(n)) return { name: raw, unit: "ms" }
  }
  return null
}

export function detectTimeColumn(header: string[]): string | null {
  return detectTimeColumnInfo(header)?.name ?? null
}

export function isContextColumn(name: string): boolean {
  const n = name.toLowerCase()
  return CONTEXT_COLUMN_HINTS.some((hint) => n.includes(hint))
}

function detectDelimiter(sampleLine: string): string {
  const candidates = [",", ";", "\t", "|"]
  let best = ","
  let bestCount = -1
  for (const c of candidates) {
    const re = c === "\t" ? /\t/g : new RegExp(`\\${c}`, "g")
    const count = (sampleLine.match(re) ?? []).length
    if (count > bestCount) {
      bestCount = count
      best = c
    }
  }
  return best
}

function parseRow(raw: string, delim: string): string[] {
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
    } else if (c === delim && !inQuotes) {
      cells.push(current)
      current = ""
    } else {
      current += c
    }
  }
  cells.push(current)
  return cells
}

/**
 * Coerce a raw time cell to milliseconds. Handles plain numbers (ms), epoch
 * seconds, ISO/datetime strings and HH:MM:SS[.mmm] stopwatch-style values.
 */
function parseTimeValue(raw: string, unit: "ms" | "s"): number | null {
  const s = raw.trim()
  if (s === "") return null

  const n = Number(s)
  if (Number.isFinite(n)) {
    if (unit === "s") return n * 1000
    return n
  }

  const iso = Date.parse(s)
  if (Number.isFinite(iso)) return iso

  const clock = s.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?$/)
  if (clock) {
    const h = Number(clock[1])
    const min = Number(clock[2])
    const sec = Number(clock[3])
    if (min < 60 && sec < 60) {
      const fracRaw = clock[4] ?? ""
      const frac = fracRaw.length > 0 ? Number(fracRaw) / 10 ** fracRaw.length : 0
      return (h * 3600 + min * 60 + sec) * 1000 + frac * 1000
    }
  }

  return null
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

  const delim = detectDelimiter(rows[1])
  if (delim !== ",") {
    warnings.push(
      `Detected "${delim}"-delimited values; parsed accordingly. Convert to comma-delimited CSV for widest tool compatibility.`,
    )
  }

  const header = parseRow(rows[0], delim).map((h) => h.trim())
  if (header.length === 0) {
    throw new Error("The CSV has no columns.")
  }

  const timeInfo = detectTimeColumnInfo(header)
  let timeCol: string | null = timeInfo?.name ?? null
  const timeUnit: "ms" | "s" = timeInfo?.unit ?? "ms"
  let timeSource: TimeSource = timeCol !== null ? "column" : "synthetic"
  let syntheticRateHz = timeSource === "synthetic" ? DEFAULT_SYNTHETIC_RATE_HZ : 0
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
    const cells = parseRow(rows[r], delim)
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

  // A detected-but-unreadable time column must not reject the whole file.
  // Pre-scan: if no time cell parses, drop back to synthetic timing so every
  // data row is still adopted (with a warning teaching the expected format).
  if (timeSource === "column") {
    let parsed = 0
    let checked = 0
    for (let r = 1; r < rows.length && checked < 25; r++) {
      const cells = parseRow(rows[r], delim)
      if (cells.length !== header.length) continue
      checked++
      if (parseTimeValue(cells[timeIdx], timeUnit) !== null) parsed++
    }
    if (parsed === 0) {
      timeSource = "synthetic"
      syntheticRateHz = DEFAULT_SYNTHETIC_RATE_HZ
      warnings.push(
        `Column "${timeCol}" was not readable as time (expected ms, epoch seconds, ISO datetime or HH:MM:SS); synthesized 10 Hz timing instead.`,
      )
      timeCol = null
    }
  }

  for (let r = 1; r < rows.length; r++) {
    const cells = parseRow(rows[r], delim)
    if (cells.length !== header.length) continue

    let rawTime: number
    if (timeSource === "column") {
      const t = parseTimeValue(cells[timeIdx], timeUnit)
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

  // Numeric time that clearly sits in epoch-seconds range (≈2001–2036) is scaled to ms.
  if (timeSource === "column" && samples.length > 0) {
    const sortedTimes = samples.map((s) => s.time).sort((a, b) => a - b)
    const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)]
    if (medianTime >= 1_200_000_000 && medianTime <= 4_000_000_000) {
      for (const s of samples) s.time = s.time * 1000
      warnings.push("Time column read as epoch seconds and converted to milliseconds.")
    }
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
