import JSZip from "jszip"
import type {
  OsmellFile,
  OsmellManifest,
  SessionEvent,
} from "./types"
import { parseCsv } from "./csv"

export async function parseOsmell(buffer: ArrayBuffer): Promise<OsmellFile> {
  const zip = await JSZip.loadAsync(buffer)
  const manifestEntry = zip.file("manifest.json")
  const dataEntry = zip.file("data.csv")

  if (!manifestEntry || !dataEntry) {
    throw new Error(
      "Not a valid .osmell file: missing manifest.json or data.csv.",
    )
  }

  const manifest: OsmellManifest = JSON.parse(
    await manifestEntry.async("string"),
  )

  const csv = parseCsv(await dataEntry.async("string"))

  if (csv.samples.length === 0) {
    throw new Error("The .osmell data.csv is empty.")
  }

  const expected = new Set(manifest.sensor.channels.map((c) => c.id))
  for (const id of csv.channelIds) {
    if (!expected.has(id)) {
      throw new Error(`data.csv has column "${id}" not declared in the manifest.`)
    }
  }
  for (const c of manifest.sensor.channels) {
    if (!csv.channelIds.includes(c.id)) {
      throw new Error(`Manifest channel "${c.id}" is missing from data.csv.`)
    }
  }

  const time: number[] = csv.samples.map((s) => s.time)
  const data: Record<string, number[]> = {}
  for (const id of csv.channelIds) {
    data[id] = csv.samples.map((s) => s.values[id] ?? NaN)
  }

  let events: SessionEvent[] | undefined
  const eventsEntry = zip.file("events.json")
  if (eventsEntry) {
    const raw = await eventsEntry.async("string")
    events = JSON.parse(raw)
  }

  return { manifest, time, data, events }
}

export function csvFromFile(file: OsmellFile): string {
  const channelIds = file.manifest.sensor.channels.map((c) => c.id)
  const timeColumn = file.manifest.sensor.timeColumn
  const lines: string[] = [[timeColumn, ...channelIds].join(",")]
  for (let i = 0; i < file.time.length; i++) {
    const row = [String(file.time[i])]
    for (const id of channelIds) {
      const v = file.data[id]?.[i]
      row.push(Number.isFinite(v) ? String(v) : "")
    }
    lines.push(row.join(","))
  }
  return lines.join("\n") + "\n"
}

export async function buildOsmell(
  file: OsmellFile,
): Promise<Blob> {
  const zip = new JSZip()
  zip.file("manifest.json", JSON.stringify(file.manifest, null, 2))
  zip.file("data.csv", csvFromFile(file))
  if (file.events) {
    zip.file("events.json", JSON.stringify(file.events, null, 2))
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.opensmell.osmell",
  })
  return blob
}

export function defaultFileName(
  file: OsmellFile,
  role = file.manifest.session.role,
): string {
  const label = file.manifest.session.label?.replace(/[^a-z0-9_\-]+/gi, "-") ?? "recording"
  const date = (file.manifest.session.recordedAt ?? new Date().toISOString())
    .slice(0, 10)
  return `${label}_${role}_${date}.osmell`
}
