"use client"

import * as React from "react"
import {
  GitCompareArrows,
  GitCompare,
  Info,
} from "lucide-react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSessions } from "@/components/suite/session-context"
import { normalizedSeries, baselineForChannel } from "@/lib/osmell"

const CHART_COLORS = [
  "#4f8df7",
  "#4ade80",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
]

export function CompareView() {
  const { sessions, selectedIds } = useSessions()
  const [channel, setChannel] = React.useState<string>("")
  const selected = sessions.filter((s) => selectedIds.includes(s.id))

  const channels = selected[0]?.file.manifest.sensor.channels.map((c) => c.id) ?? []
  const activeChannel = channel || channels[0] || ""

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card py-24 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
          <GitCompare className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Nothing to compare yet</p>
          <p className="text-xs text-muted-foreground">
            Import some sessions first, then select them in the Library.
          </p>
        </div>
      </div>
    )
  }

  const data = buildOverlayData(selected, activeChannel)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          <GitCompareArrows className="size-3" /> Compare
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Overlay normalized responses</h1>
        <p className="max-w-2xl text-muted-foreground">
          Each selected session is normalized to its own R0 and plotted on a shared
          relative-time axis, so responses are comparable across devices and days.
        </p>
      </div>

      {selected.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <GitCompare className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No sessions selected. Open the Library and tick the checkboxes on the
            sessions you want to compare.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {selected.map((s) => (
                <Badge key={s.id} variant="outline">
                  {s.file.manifest.session.label || s.fileName}
                </Badge>
              ))}
            </div>
            <Select value={activeChannel} onValueChange={setChannel}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="h-96 rounded-xl border border-border/60 bg-card p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="t"
                  label={{ value: "relative time (s)", position: "insideBottom", offset: -4, fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  label={{ value: "(R − R0)/R0", angle: -90, position: "insideLeft", fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {selected.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.file.manifest.session.label || s.fileName}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              R0 comes from each session&apos;s baseline when present; otherwise auto-R0
              uses the first 15 samples. Time is relative to each session&apos;s first
              sample.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function buildOverlayData(
  sessions: ReturnType<typeof useSessions>["sessions"],
  channel: string,
): Record<string, number>[] {
  if (sessions.length === 0) return []
  const maxLen = Math.max(...sessions.map((s) => s.file.time.length))
  const out: Record<string, number>[] = []
  for (let i = 0; i < maxLen; i++) {
    const row: Record<string, number> = { t: i / 10 }
    for (const s of sessions) {
      const values = s.file.data[channel] ?? []
      const r0 = baselineForChannel(s.file, channel, values).r0
      const norm = normalizedSeries(values, r0)
      const v = norm[i]
      row[s.id] = Number.isFinite(v) ? v : NaN
    }
    out.push(row)
  }
  return out
}
