"use client"

import * as React from "react"
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Download,
  FlaskConical,
  Info,
  Loader2,
  Radio,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  computeQuality,
  parseCsv,
  processMox,
  type OsmellFile,
  type QualityReport,
  type MoxFeatures,
} from "@/lib/osmell"

type ImportStatus =
  | "idle"
  | "uploading"
  | "processing"
  | "ready"
  | "error"

const ROLE_LABELS: Record<string, string> = {
  baseline: "Baseline",
  exposure: "Exposure",
  single: "Single recording",
}

function formatHz(rate: number): string {
  if (!rate || !Number.isFinite(rate)) return "—"
  return `${rate.toFixed(1)} Hz`
}

function formatDuration(samples: number, rate: number): string {
  if (samples < 2) return "—"
  const s = rate > 0 ? (samples - 1) / rate : 0
  if (s >= 60) return `${(s / 60).toFixed(1)} min`
  return `${s.toFixed(1)} s`
}

export default function MoxStudio() {
  const [status, setStatus] = React.useState<ImportStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<OsmellFile | null>(null)
  const [report, setReport] = React.useState<QualityReport | null>(null)
  const [features, setFeatures] = React.useState<MoxFeatures[] | null>(null)
  const [filename, setFilename] = React.useState("")
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFiles = React.useCallback(async (files: FileList | File[]) => {
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
        setFile(parsed)
        setFilename(f.name)
        const rep = computeQuality({
          file: parsed,
          sampleCount: parsed.time.length,
          guessSamplingRateHz: parsed.manifest.sensor.samplingRateHz ?? 10,
          unsorted: false,
          nonFinite: 0,
        })
        setReport(rep)
        const mox = processMox(parsed)
        setFeatures(mox.sensorType === "mox" ? mox.features : null)
        setStatus("ready")
        return
      }
      const parsed = parseCsv(text)
      if (parsed.samples.length === 0) {
        throw new Error("No valid data rows found in the CSV.")
      }
      const channelIds = parsed.channelIds.filter((id) => id !== parsed.timeColumn)
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
      setFile(osmellFile)
      setFilename(f.name)
      const rep = computeQuality({
        file: osmellFile,
        sampleCount: parsed.samples.length,
        guessSamplingRateHz: parsed.guessSamplingRateHz,
        unsorted: parsed.unsorted,
        nonFinite: parsed.nonFinite,
      })
      setReport(rep)
      const mox = processMox(osmellFile)
      setFeatures(mox.sensorType === "mox" ? mox.features : null)
      setStatus("ready")
    } catch (e) {
      setStatus("error")
      setError(e instanceof Error ? e.message : "Failed to parse file.")
    }
  }, [])

  const reset = React.useCallback(() => {
    setStatus("idle")
    setFile(null)
    setReport(null)
    setFeatures(null)
    setError(null)
    setFilename("")
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const downloadOsmell = React.useCallback(async () => {
    if (!file) return
    const { buildOsmell } = await import("@/lib/osmell")
    const blob = await buildOsmell(file)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${filename.replace(/\.[^.]+$/, "")}.osmell`
    a.click()
    URL.revokeObjectURL(url)
  }, [file, filename])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="hex-icon text-foreground" />
            <span className="text-sm font-semibold tracking-tight">OpenSmell</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">Studio</span>
          </div>
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button variant="ghost" size="sm">mox.opensmell.xyz</Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10 flex flex-col gap-3">
          <Badge variant="secondary" className="w-fit">
            <Sparkles className="size-3" /> MOX sensor analytics
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight">
            Turn raw e-nose data into a session you can share.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Upload a CSV from your Osmograph, ESP32, or any MOX array. We
            detect channels, normalize against a baseline, score data quality,
            and export a compact <code className="rounded bg-muted px-1 py-0.5 text-xs">.osmell</code> file.
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
          <ResultPanel
            filename={filename}
            file={file}
            report={report}
            features={features}
            onDownload={downloadOsmell}
            onReset={reset}
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.osmell"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </main>
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

function ResultPanel({
  filename,
  file,
  report,
  features,
  onDownload,
  onReset,
}: {
  filename: string
  file: OsmellFile
  report: QualityReport
  features: MoxFeatures[] | null
  onDownload: () => void
  onReset: () => void
}) {
  const role = file.manifest.session.role
  const rate = file.manifest.sensor.samplingRateHz
  const durationS =
    rate && rate > 0 ? file.time.length / rate : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" />
            {filename}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {file.manifest.session.label || "Untitled recording"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {ROLE_LABELS[role] ?? role}
          </Badge>
          <Badge variant={report.badge === "Excellent" ? "default" : "secondary"}>
            <ShieldCheck className="size-3" /> {report.total ?? "—"}/100 · {report.badge}
          </Badge>
          <Button size="sm" onClick={onDownload}>
            <Download className="size-4" /> Export .osmell
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<Radio className="size-4" />}
          label="Channels"
          value={String(file.manifest.sensor.channels.length)}
        />
        <StatCard
          icon={<Activity className="size-4" />}
          label="Samples"
          value={file.time.length.toLocaleString()}
        />
        <StatCard
          icon={<Settings2 className="size-4" />}
          label="Rate"
          value={formatHz(rate ?? 0)}
        />
        <StatCard
          icon={<FlaskConical className="size-4" />}
          label="Duration"
          value={formatDuration(file.time.length, rate ?? 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <QualityCard report={report} />
        {features && features.length > 0 ? (
          <ChannelCard features={features} report={report} />
        ) : null}
      </div>

      {report.notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4" /> Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              {report.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="hex-icon mt-1.5 shrink-0 text-muted-foreground/60" />
                  {n}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {durationS === 0 && (
        <p className="text-xs text-muted-foreground">
          Duration estimate unavailable — declare <code>samplingRateHz</code> in
          the manifest for an accurate figure.
        </p>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function QualityCard({ report }: { report: QualityReport }) {
  const subs = [
    { key: "continuity", label: "Continuity", weight: "20%" },
    { key: "dynamicRange", label: "Dynamic range", weight: "15%" },
    { key: "saturationFree", label: "Saturation-free", weight: "15%" },
    { key: "baselineStability", label: "Baseline stability", weight: "20%" },
    { key: "signalStrength", label: "Signal strength", weight: "20%" },
    { key: "durationAdequacy", label: "Duration", weight: "10%" },
  ] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data quality</CardTitle>
        <CardDescription>
          Scored against the OSMELL spec (§7) — verifiable from the file itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {subs.map(({ key, label, weight }) => {
          const sub = report.subscores[key]
          const val = sub?.value ?? null
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {label}
                  <span className="ml-1 text-muted-foreground/60">{weight}</span>
                </span>
                <span className="font-medium">
                  {val === null ? "—" : `${Math.round(val)}`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, val ?? 0))}%` }}
                />
              </div>
            </div>
          )
        })}
        {report.flags.deadSensors.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Dead sensors excluded from scoring:{" "}
            {report.flags.deadSensors.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ChannelCard({
  features,
  report,
}: {
  features: MoxFeatures[]
  report: QualityReport
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Channel response</CardTitle>
        <CardDescription>
          Normalized relative change (R − R0)/R0 per channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-border pb-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>Channel</span>
          <span>R0</span>
          <span>Amplitude</span>
          <span>Direction</span>
        </div>
        {features.map((f) => {
          const dead = report.flags.deadSensors.includes(f.channel)
          return (
            <div
              key={f.channel}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-medium">{f.channel}</span>
              <span className="tabular-nums text-muted-foreground">
                {Number.isFinite(f.r0) ? Math.round(f.r0) : "—"}
              </span>
              <span className="tabular-nums">
                {Number.isFinite(f.relativeAmplitude)
                  ? `${(f.relativeAmplitude * 100).toFixed(1)}%`
                  : "—"}
              </span>
              <span>
                {dead ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    dead
                  </Badge>
                ) : f.direction === 1 ? (
                  <span className="text-emerald-500">▲</span>
                ) : (
                  <span className="text-rose-500">▼</span>
                )}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
