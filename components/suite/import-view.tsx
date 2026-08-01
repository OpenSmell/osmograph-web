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

export function ImportView() {
  const { addSession } = useSessions()
  const [status, setStatus] = React.useState<ImportStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<OsmellFile | null>(null)
  const [report, setReport] = React.useState<QualityReport | null>(null)
  const [features, setFeatures] = React.useState<MoxFeatures[] | null>(null)
  const [filename, setFilename] = React.useState("")
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const f = list[0]
      setStatus("uploading")
      setError(null)
      try {
        const text = await f.text()
        setStatus("processing")
        if (f.name.toLowerCase().endsWith(".osmell")) {
          const buf = await f.arrayBuffer()
          const { parseOsmell } = await import("@/lib/osmell")
          const parsed = await parseOsmell(buf)
          const rep = computeQuality({
            file: parsed,
            sampleCount: parsed.time.length,
            guessSamplingRateHz: parsed.manifest.sensor.samplingRateHz ?? 10,
            unsorted: false,
            nonFinite: 0,
          })
          const mox = processMox(parsed)
          setFile(parsed)
          setFilename(f.name)
          setReport(rep)
          setFeatures(mox.sensorType === "mox" ? mox.features : null)
          addSession({
            id: makeSessionId(),
            fileName: f.name,
            file: parsed,
            report: rep,
            features: mox.sensorType === "mox" ? mox.features : null,
            importedAt: Date.now(),
          })
          setStatus("ready")
          return
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
        const osmellFile: OsmellFile = {
          manifest,
          time: parsed.samples.map((s) => s.time),
          data,
        }
        const rep = computeQuality({
          file: osmellFile,
          sampleCount: parsed.samples.length,
          guessSamplingRateHz: parsed.guessSamplingRateHz,
          unsorted: parsed.unsorted,
          nonFinite: parsed.nonFinite,
        })
        const mox = processMox(osmellFile)
        setFile(osmellFile)
        setFilename(f.name)
        setReport(rep)
        setFeatures(mox.sensorType === "mox" ? mox.features : null)
        addSession({
          id: makeSessionId(),
          fileName: f.name,
          file: osmellFile,
          report: rep,
          features: mox.sensorType === "mox" ? mox.features : null,
          importedAt: Date.now(),
        })
        setStatus("ready")
      } catch (e) {
        setStatus("error")
        setError(e instanceof Error ? e.message : "Failed to parse file.")
      }
    },
    [addSession],
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setFile(null)
    setReport(null)
    setFeatures(null)
    setError(null)
    setFilename("")
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          <Sparkles className="size-3" /> Import
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Add a recording</h1>
        <p className="max-w-2xl text-muted-foreground">
          Drop a CSV from your Osmograph, ESP32, or any MOX array — or an existing{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.osmell</code> file. We
          detect channels, normalize against a baseline, score quality, and add the
          session to your library.
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
            {status === "uploading" ? "Reading file…" : "Parsing and scoring…"}
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

      {status === "ready" && file && report && (
        <div className="flex flex-col gap-4">
          <SessionDetail
            fileName={filename}
            file={file}
            report={report}
            features={features}
            onDownload={() => downloadOsmell(file, filename)}
          />
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              Added to your library.
            </span>
            <Button variant="outline" size="sm" onClick={reset}>
              Import another
            </Button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.osmell"
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
          Drop your recording here, or <span className="text-primary">browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Accepts <code>.csv</code>, <code>.txt</code>, or an existing{" "}
          <code>.osmell</code> file
        </p>
      </div>
    </div>
  )
}
