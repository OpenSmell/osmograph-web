import { TIME_COLUMNS, type ParsedSample, type TimeColumn } from "./types"

export interface CsvParseResult {
  header: string[]
  timeColumn: TimeColumn
  samples: ParsedSample[]
  rowCount: number
  channelIds: string[]
  guessSamplingRateHz: number
  nonFinite: number
  unsorted: boolean
}

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

export function parseCsv(text: string): CsvParseResult {
  const rawRows = text.split(/\r?\n/)
  const rows = rawRows
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !r.startsWith("#"))

  if (rows.length === 0) {
    throw new Error("The CSV file is empty.")
  }

  const header = parseRow(rows[0]).map((h) => h.trim())
  if (header.length === 0) {
    throw new Error("The CSV has no columns.")
  }

  const timeCol = header.find((h) => (TIME_COLUMNS as readonly string[]).includes(h))
  if (!timeCol) {
    throw new Error(
      `No time column found. Expected one of: ${TIME_COLUMNS.join(", ")}.`,
    )
  }

  const timeIdx = header.indexOf(timeCol)
  const channelIds = header.filter((_, i) => i !== timeIdx)

  const samples: ParsedSample[] = []
  let nonFinite = 0
  let unsorted = false

  for (let r = 1; r < rows.length; r++) {
    const cells = parseRow(rows[r])
    if (cells.length !== header.length) continue

    const rawTime = Number(cells[timeIdx])
    if (!Number.isFinite(rawTime)) {
      nonFinite++
      continue
    }

    const values: Record<string, number> = {}
    let rowHasNonFinite = false
    for (const ch of channelIds) {
      const colIdx = header.indexOf(ch)
      if (colIdx < 0) continue
      const raw = Number(cells[colIdx])
      if (!Number.isFinite(raw)) {
        nonFinite++
        rowHasNonFinite = true
        continue
      }
      values[ch] = raw
    }
    if (rowHasNonFinite) continue

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
  const guessSamplingRateHz = medianGap ? 1000 / medianGap : 0

  return {
    header,
    timeColumn: timeCol as TimeColumn,
    samples,
    rowCount: samples.length,
    channelIds,
    guessSamplingRateHz,
    nonFinite,
    unsorted,
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
