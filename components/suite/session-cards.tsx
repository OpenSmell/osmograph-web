"use client"

import * as React from "react"
import {
  Activity,
  CheckCircle2,
  Download,
  FlaskConical,
  Info,
  Radio,
  Settings2,
  ShieldCheck,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FingerprintCard } from "@/components/suite/fingerprint-card"
import type { OsmellFile, QualityReport, MoxFeatures } from "@/lib/osmell"

export const ROLE_LABELS: Record<string, string> = {
  baseline: "Baseline",
  exposure: "Exposure",
  single: "Single recording",
}

export function formatHz(rate: number): string {
  if (!rate || !Number.isFinite(rate)) return "—"
  return `${rate.toFixed(1)} Hz`
}

export function formatDuration(samples: number, rate: number): string {
  if (samples < 2) return "—"
  const s = rate > 0 ? (samples - 1) / rate : 0
  if (s >= 60) return `${(s / 60).toFixed(1)} min`
  return `${s.toFixed(1)} s`
}

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export async function downloadOsmell(file: OsmellFile, fileName: string) {
  const { buildOsmell } = await import("@/lib/osmell")
  const blob = await buildOsmell(file)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${fileName.replace(/\.[^.]+$/, "")}.osmell`
  a.click()
  URL.revokeObjectURL(url)
}

export function StatCard({
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function QualityCard({ report }: { report: QualityReport }) {
  const subs = [
    { key: "continuity", label: "Continuity", weight: "15%" },
    { key: "dynamicRange", label: "Dynamic range", weight: "10%" },
    { key: "saturationFree", label: "Saturation-free", weight: "10%" },
    { key: "baselineStability", label: "Baseline stability", weight: "20%" },
    { key: "signalStrength", label: "Signal strength", weight: "20%" },
    { key: "recoveryCompleteness", label: "Recovery", weight: "15%" },
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
          const val = report.subscores[key]?.value ?? null
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {label}
                  <span className="ml-1 text-muted-foreground/60">{weight}</span>
                </span>
                <span className="font-medium">{val === null ? "—" : `${Math.round(val)}`}</span>
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
            Dead sensors excluded from scoring: {report.flags.deadSensors.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ChannelCard({
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
            <div key={f.channel} className="flex items-center justify-between text-sm">
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
                  <Badge variant="outline" className="text-muted-foreground">dead</Badge>
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

export function SessionNotes({ report }: { report: QualityReport }) {
  if (report.notes.length === 0) return null
  return (
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
  )
}

export function SessionDetail({
  fileName,
  file,
  report,
  features,
  onDownload,
}: {
  fileName: string
  file: OsmellFile
  report: QualityReport
  features: MoxFeatures[] | null
  onDownload?: () => void
}) {
  const role = file.manifest.session.role
  const rate = file.manifest.sensor.samplingRateHz

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" />
            {fileName}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {file.manifest.session.label || "Untitled recording"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{ROLE_LABELS[role] ?? role}</Badge>
          <Badge variant={report.badge === "Excellent" ? "default" : "secondary"}>
            <ShieldCheck className="size-3" /> {report.total ?? "—"}/100 · {report.badge}
          </Badge>
          {onDownload && (
            <Button size="sm" onClick={onDownload}>
              <Download className="size-4" /> Export .osmell
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Radio className="size-4" />} label="Channels" value={String(file.manifest.sensor.channels.length)} />
        <StatCard icon={<Activity className="size-4" />} label="Samples" value={file.time.length.toLocaleString()} />
        <StatCard icon={<Settings2 className="size-4" />} label="Rate" value={formatHz(rate ?? 0)} />
        <StatCard icon={<FlaskConical className="size-4" />} label="Duration" value={formatDuration(file.time.length, rate ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <QualityCard report={report} />
        {features && features.length > 0 ? <ChannelCard features={features} report={report} /> : null}
      </div>

      {features && features.length > 0 ? <FingerprintCard features={features} /> : null}

      <SessionNotes report={report} />
    </div>
  )
}
