"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MoxFeatures } from "@/lib/osmell"

const FEATURE_LABELS = ["AMP", "RISE", "DECAY", "AUC", "END", "SAT", "SEL", "CH"]
const FEATURE_FULL = [
  "Amplitude",
  "Rise time",
  "Decay time",
  "Area under curve",
  "Endpoint Δ",
  "Saturation",
  "Selectivity",
  "Channels",
]

const SENSOR_COLORS = ["#4fc3f7", "#81c784", "#ffb74d", "#e57373", "#ba68c8", "#f06292"]
const GRID_LEVELS = [0.25, 0.5, 0.75, 1]

function fingerprintRaw(features: MoxFeatures[]): number[] {
  const amps: number[] = []
  const rises: number[] = []
  const decays: number[] = []
  const aucs: number[] = []
  const ends: number[] = []
  const sats: number[] = []

  for (const f of features) {
    if (f.dead) continue
    if (f.relativeAmplitude > 0) amps.push(f.relativeAmplitude)
    if (f.riseTimeMs !== null && f.riseTimeMs > 0) rises.push(f.riseTimeMs)
    if (f.decayTimeMs !== null && f.decayTimeMs > 0) decays.push(f.decayTimeMs)
    if (f.auc > 0) aucs.push(f.auc)
    ends.push(Math.abs(f.endpointDelta))
    if (f.saturationIndex > 0) sats.push(f.saturationIndex)
  }

  const active = features.filter((f) => !f.dead && f.relativeAmplitude > 0)
  const ratios: number[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const aj = active[j].relativeAmplitude
      if (aj > 0) ratios.push(Math.abs(active[i].relativeAmplitude / aj - 1))
    }
  }

  return [
    mean(amps),
    mean(rises),
    mean(decays),
    mean(aucs),
    mean(ends),
    mean(sats),
    mean(ratios),
    features.length > 0 ? active.length / features.length : 0,
  ]
}

function fingerprintVector(features: MoxFeatures[]): number[] {
  const vec = fingerprintRaw(features)
  const mx = Math.max(...vec, 1e-9)
  return vec.map((v) => v / mx)
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function SensorRadar({ features }: { features: MoxFeatures[] }) {
  const active = features.filter((f) => !f.dead)
  const n = active.length
  if (n === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No active channels
      </div>
    )
  }

  const maxAmp = Math.max(0, ...active.map((f) => f.relativeAmplitude))
  const values = active.map((f) => (maxAmp > 0 ? f.relativeAmplitude / maxAmp : 0))

  const SIZE = 240
  const C = SIZE / 2
  const R = (SIZE / 2) * 0.8

  const point = (index: number, radius: number) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / n
    return { x: C + radius * R * Math.cos(angle), y: C + radius * R * Math.sin(angle) }
  }

  const ringPath = (radius: number) =>
    Array.from({ length: n + 1 }, (_, i) => point(i % n, radius))
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ") + " Z"

  const dataPath =
    Array.from({ length: n + 1 }, (_, i) => point(i % n, values[i % n] ?? 0))
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ") + " Z"

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label="Sensor radar">
      {Array.from({ length: n }, (_, i) => {
        const p = point(i, 1)
        return (
          <line
            key={`spoke-${i}`}
            x1={C}
            y1={C}
            x2={p.x}
            y2={p.y}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )
      })}
      {GRID_LEVELS.map((level) => (
        <path
          key={level}
          d={ringPath(level)}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      <path d={dataPath} fill="var(--primary)" fillOpacity={0.18} stroke="var(--primary)" strokeWidth={2} />
      {active.map((f, i) => {
        const p = point(i, values[i] ?? 0)
        return (
          <circle
            key={f.channel}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill={SENSOR_COLORS[i % SENSOR_COLORS.length]}
          />
        )
      })}
      {active.map((f, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
        const p = point(i, 1.18)
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end"
        const dy = sin > 0.3 ? 16 : sin < -0.3 ? -6 : 4
        return (
          <text
            key={f.channel}
            x={p.x}
            y={p.y + dy}
            textAnchor={anchor}
            fontSize={11}
            fill={SENSOR_COLORS[i % SENSOR_COLORS.length]}
          >
            {f.channel}
          </text>
        )
      })}
    </svg>
  )
}

export function FingerprintCard({ features }: { features: MoxFeatures[] }) {
  const vec = fingerprintVector(features)
  const raw = fingerprintRaw(features)
  const bars = FEATURE_LABELS.map((label, i) => ({
    label,
    full: FEATURE_FULL[i],
    value: vec[i] ?? 0,
    raw: raw[i] ?? 0,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fingerprint</CardTitle>
        <CardDescription>
          Normalized response shape per sensor, plus the 8-dimensional feature signature
          used for cross-session matching.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="h-64">
          <SensorRadar features={features} />
        </div>

        <div className="flex flex-col justify-center gap-2.5">
          {bars.map((b) => (
            <div key={b.label} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0 text-right font-medium">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(2, Math.min(100, b.value * 100))}%` }}
                />
              </div>
              <span className="w-16 shrink-0 tabular-nums text-muted-foreground" title={b.full}>
                {formatRaw(b.label, b.raw)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function formatRaw(label: string, value: number): string {
  if (value <= 0) return "0"
  if (label === "AMP" || label === "END") return `${(value * 100).toFixed(0)}%`
  if (label === "SAT" || label === "CH" || label === "SEL") return value.toFixed(2)
  return Number.isFinite(value) ? value.toFixed(0) : "0"
}
