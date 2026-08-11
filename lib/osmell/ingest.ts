import type { File as JsFile } from "buffer"
import type {
  OsmellFile,
  QualityReport,
} from "./types"
import { parseCsv } from "./csv"
import { computeQuality } from "./quality"
import { guessSensorType, processMox } from "./processors"
import type { MoxFeatures, MoxProcessorResult } from "./processors"

export interface IngestedSession {
  source: string
  substance: string
  label: string
  ok: boolean
  file: OsmellFile | null
  report: QualityReport | null
  features: MoxFeatures[] | null
  warnings: string[]
  error: string | null
}

export interface FileGroup {
  name: string
  files: File[]
}

/** Group name used when files have no parent directory (flat file picker / non-webkit drop). */
export const LOOSE_GROUP_NAME = "__loose__"

export function buildFileFromCsv(
  text: string,
  source: string,
  label: string,
  substance: string,
  role: "single" | "exposure" | "baseline" = "single",
): { file: OsmellFile; report: QualityReport; mox: MoxProcessorResult | null } {
  const parsed = parseCsv(text)
  if (parsed.rowCount === 0) throw new Error("No usable data rows found.")
  if (parsed.channelIds.length === 0) throw new Error("No numeric sensor columns found.")

  const data: Record<string, number[]> = {}
  for (const id of parsed.channelIds) {
    data[id] = parsed.samples.map((s) => s.values[id] ?? NaN)
  }

  const durationMs =
    parsed.samples.length > 1
      ? parsed.samples[parsed.samples.length - 1].time - parsed.samples[0].time
      : 0

  const file: OsmellFile = {
    manifest: {
      osmell: { formatVersion: "1.0.0" },
      sensor: {
        sensorType: guessSensorType(parsed.channelIds),
        channels: parsed.channelIds.map((id) => ({ id, unit: "adc" })),
        samplingRateHz: parsed.guessSamplingRateHz || undefined,
        timeColumn: parsed.timeColumn ?? "synthetic_index",
      },
      session: {
        role,
        label,
        groupId: substance,
        durationMs,
        notes: parsed.warnings.length > 0 ? parsed.warnings.join("; ") : undefined,
      },
      software: { importer: "opensmell-ingest" },
      extra: {
        ingest: {
          sourceFile: source,
          timeSource: parsed.timeSource,
          syntheticRateHz: parsed.syntheticRateHz || null,
          timeColumn: parsed.timeColumn,
          contextColumns: parsed.contextColumns,
          unknownColumns: parsed.unknownColumns,
          skippedColumns: parsed.skippedColumns,
          warnings: parsed.warnings,
          context: Object.fromEntries(
            parsed.contextColumns.map((col) => [
              col,
              parsed.samples.map((s) => s.values[col] ?? null),
            ]),
          ),
        },
      },
    },
    time: parsed.samples.map((s) => s.time),
    data,
  }

  const report = computeQuality({
    file,
    sampleCount: parsed.samples.length,
    guessSamplingRateHz: parsed.guessSamplingRateHz,
    unsorted: parsed.unsorted,
    nonFinite: parsed.nonFinite,
  })

  const mox =
    file.manifest.sensor.sensorType === "mox" ? processMox(file) : null

  return { file, report, mox }
}

export async function ingestFile(
  file: File,
  substance: string,
  role: "single" | "exposure" | "baseline" = "single",
): Promise<IngestedSession> {
  const label = file.name.replace(/\.(csv|txt)$/i, "")
  const session: IngestedSession = {
    source: file.name,
    substance,
    label,
    ok: false,
    file: null,
    report: null,
    features: null,
    warnings: [],
    error: null,
  }
  try {
    const text = await file.text()
    const built = buildFileFromCsv(text, file.name, label, substance, role)
    session.ok = true
    session.file = built.file
    session.report = built.report
    session.features = built.mox ? built.mox.features : null
    session.warnings = built.file.manifest.extra?.ingest?.warnings ?? []
  } catch (e) {
    session.error = e instanceof Error ? e.message : "Failed to parse file."
  }
  return session
}

async function collectEntries(
  entry: FileSystemEntry,
  out: FileSystemFileEntry[],
): Promise<void> {
  if (entry.isFile) {
    out.push(entry as FileSystemFileEntry)
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    for (const e of batch) await collectEntries(e, out)
  } while (batch.length > 0)
}

export async function groupsFromDataTransfer(
  dt: DataTransfer,
): Promise<FileGroup[]> {
  const items = Array.from(dt.items ?? [])
  const entries = items
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e))

  if (entries.length === 0) {
    return [{ name: LOOSE_GROUP_NAME, files: Array.from(dt.files) }]
  }

  const all: FileSystemFileEntry[] = []
  for (const e of entries) await collectEntries(e, all)

  const byDir = new Map<string, File[]>()
  const loose: File[] = []
  for (const entry of all) {
    const file = await new Promise<File>((resolve, reject) =>
      entry.file(resolve, reject),
    )
    const dir =
      entry.fullPath.split("/").filter(Boolean).slice(0, -1).pop() ?? ""
    if (dir) {
      byDir.set(dir, [...(byDir.get(dir) ?? []), file])
    } else {
      loose.push(file)
    }
  }
  const groups: FileGroup[] = [...byDir.entries()].map(([name, files]) => ({
    name,
    files,
  }))
  if (loose.length > 0) groups.push({ name: LOOSE_GROUP_NAME, files: loose })
  return groups
}

export function groupsFromFileList(files: FileList | File[]): FileGroup[] {
  const list = Array.from(files)
  const byDir = new Map<string, File[]>()
  const loose: File[] = []
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
    if (rel) {
      const dir = rel.split("/").slice(0, -1).filter(Boolean).pop() ?? ""
      if (dir) byDir.set(dir, [...(byDir.get(dir) ?? []), f])
      else loose.push(f)
    } else {
      loose.push(f)
    }
  }
  const groups: FileGroup[] = [...byDir.entries()].map(([name, files]) => ({
    name,
    files,
  }))
  if (loose.length > 0) groups.push({ name: LOOSE_GROUP_NAME, files: loose })
  return groups
}

export type { JsFile }
