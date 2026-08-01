"use client"

import * as React from "react"
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  computeQuality,
  parseCsv,
  processMox,
  type OsmellFile,
  type QualityReport,
  type MoxFeatures,
} from "@/lib/osmell"
import { useSessions, makeSessionId } from "@/components/suite/session-context"
import { SessionDetail, downloadOsmell } from "@/components/suite/session-cards"

type ImportStatus = "idle" | "uploading" | "processing" | "ready" | "error"

type ImportResult =
  | {
      status: "ok"
      fileName: string
      file: OsmellFile
      report: QualityReport
      features: MoxFeatures[] | null
    }
  | { status: "error"; fileName: string; error: string }

async function processFile(f: File): Promise<{ file: OsmellFile; report: QualityReport; mox: ReturnType<typeof processMox> }> {
  const text = await f.text()
  if (f.name.toLowerCase().endsWith(".osmell")) {
    const buf = await f.arrayBuffer()
    const { parseOsmell } = await import("@/lib/osmell")
    const parsed = await parseOsmell(buf)
    const report = computeQuality({
      file: parsed,
      sampleCount: parsed.time.length,
      guessSamplingRateHz: parsed.manifest.sensor.samplingRateHz ?? 10,
      unsorted: false,
      nonFinite: 0,
    })
    return { file: parsed, report, mox: processMox(parsed) }
  }
  const parsed = parseCsv(text)
  if (parsed.samples.length === 0) {
    throw new Error("No valid data rows found in the CSV.")
  }
  const channelIds = parsed.channelIds
  const manifest: OsmellFile["manifest"] = {
    osmell: { formatVersion: "1.0.0" },
    sensor: {
      sensorType: "mox",
      channels: channelIds.map((id) => ({ id, unit: "adc" })),
      samplingRateHz: parsed.guessSamplingRateHz || undefined,
      adcBits: 12,
      adcMax: 4095,
      timeColumn: parsed.timeColumn,
    },
    session: { role: "exposure", label: f.name.replace(/\.(csv|txt)$/i, "") },
    baseline: { source: "auto", r0Samples: 15 },
  }
  const data: Record<string, number[]> = {}
  for (const id of channelIds) {
    data[id] = parsed.samples.map((s) => s.values[id] ?? NaN)
  }
  const file: OsmellFile = {
    manifest,
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
  return { file, report, mox: processMox(file) }
}

export function ImportView() {
  const { addSession } = useSessions()
  const [status, setStatus] = React.useState<ImportStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<ImportResult[]>([])
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setStatus("uploading")
      setError(null)
      setResults([])
      setProgress({ done: 0, total: list.length })
      const out: ImportResult[] = []
      for (const f of list) {
        try {
          const { file, report, mox } = await processFile(f)
          addSession({
            id: makeSessionId(),
            fileName: f.name,
            file,
            report,
            features: mox.sensorType === "mox" ? mox.features : null,
            importedAt: Date.now(),
          })
          out.push({
            status: "ok",
            fileName: f.name,
            file,
            report,
            features: mox.sensorType === "mox" ? mox.features : null,
          })
        } catch (e) {
          out.push({
            status: "error",
            fileName: f.name,
            error: e instanceof Error ? e.message : "Failed to parse file.",
          })
        }
        setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p))
      }
      setResults(out)
      setProgress(null)
      setStatus("ready")
    },
    [addSession],
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setResults([])
    setError(null)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const okResults = results.filter((r): r is Extract<ImportResult, { status: "ok" }> => r.status === "ok")
  const errResults = results.filter((r): r is Extract<ImportResult, { status: "error" }> => r.status === "error")
  const single = okResults.length === 1 ? okResults[0] : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          <Sparkles className="size-3" /> Import
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Add recordings</h1>
        <p className="max-w-2xl text-muted-foreground">
          Drop CSVs from your Osmograph, ESP32, or any MOX array — or existing{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.osmell</code> files. You can
          add many at once. We detect channels, normalize against a baseline, score quality,
          and add every session to your library.
        </p>
      </div>

      {status === "idle" && (
        <UploadCard
          dragOver={dragOver}
          onDragOver={setDragOver}
          onSelect={() => inputRef.current?.click()}
          onDrop={(files) => handleFiles(files)}
        />
      )}

      {(status === "uploading" || status === "processing") && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border/60 bg-card py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">
            {status === "uploading"
              ? "Reading files…"
              : progress
                ? `Parsing and scoring ${progress.done} of ${progress.total}…`
                : "Parsing and scoring…"}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/40 bg-destructive/5 py-16">
          <XCircle className="size-8 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={reset}>
            <ArrowLeft className="size-4" /> Try another file
          </Button>
        </div>
      )}

      {status === "ready" && results.length > 0 && (
        <div className="flex flex-col gap-4">
          {single ? (
            <SessionDetail
              fileName={single.fileName}
              file={single.file}
              report={single.report}
              features={single.features}
              onDownload={() => downloadOsmell(single.file, single.fileName)}
            />
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4">
              <p className="text-sm font-medium">
                Imported {okResults.length} session{okResults.length === 1 ? "" : "s"}
                {errResults.length > 0 ? `, ${errResults.length} skipped` : ""}
              </p>
              <div className="flex flex-col gap-1.5">
                {results.map((r) =>
                  r.status === "ok" ? (
                    <div key={r.fileName} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      <span className="min-w-0 truncate">{r.fileName}</span>
                      <Badge variant={r.report.badge === "Excellent" ? "default" : "secondary"} className="shrink-0">
                        {r.report.total ?? "—"}/100 · {r.report.badge}
                      </Badge>
                    </div>
                  ) : (
                    <div key={r.fileName} className="flex items-center gap-2 text-sm">
                      <XCircle className="size-4 shrink-0 text-destructive" />
                      <span className="min-w-0 truncate">{r.fileName}</span>
                      <span className="shrink-0 truncate text-xs text-destructive">{r.error}</span>
                    </div>
                  ),
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Full per-session detail lives in the Library — filter by quality badge or open the manifest to relabel.
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              {okResults.length} added to your library{errResults.length > 0 ? `, ${errResults.length} skipped` : "."}
            </span>
            <Button variant="outline" size="sm" onClick={reset}>
              Import more
            </Button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.osmell"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
    </div>
  )
}

function UploadCard({
  dragOver,
  onDragOver,
  onSelect,
  onDrop,
}: {
  dragOver: boolean
  onDragOver: (over: boolean) => void
  onSelect: () => void
  onDrop: (files: FileList | File[]) => void
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(true)
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        onDragOver(false)
        onDrop(e.dataTransfer.files)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-20 text-center transition-colors ${
        dragOver
          ? "border-ring bg-accent/60"
          : "border-border bg-card hover:border-ring/50 hover:bg-accent/40"
      }`}
      onClick={onSelect}
    >
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
        <UploadCloud className="size-6" />
      </div>
      <div>
        <p className="text-sm font-medium">
          Drop your recordings here, or <span className="text-primary">browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          One file or many at once — <code>.csv</code>, <code>.txt</code>, or{" "}
          <code>.osmell</code>
        </p>
      </div>
    </div>
  )
}
