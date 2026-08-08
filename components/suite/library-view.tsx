"use client"

import * as React from "react"
import {
  Download,
  Inbox,
  Layers,
  Plus,
  ShieldCheck,
  Trash2,
  Wind,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  SessionDetail,
  ROLE_LABELS,
  formatTimeAgo,
  downloadOsmell,
} from "@/components/suite/session-cards"
import { useSessions, type SuiteSession } from "@/components/suite/session-context"
import { DESKTOP_APP_URL } from "@/lib/constants"

export function LibraryView({
  onImport,
  onVerdict,
}: {
  onImport: () => void
  onVerdict: (label: string) => void
}) {
  const { sessions, removeSession, clearSessions, selectedIds, toggleSelected, clearSelected } = useSessions()
  const [openId, setOpenId] = React.useState<string | null>(null)

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card py-24 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Your library is empty</p>
          <p className="text-xs text-muted-foreground">
            Record with the desktop app — it connects directly to your E-Nose rig
            for live, offline capture — then import a recording to start building
            your session library.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" onClick={onImport}>
            <Plus className="size-4" /> Import a recording
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">
              <Download className="size-4" /> Get the desktop app
            </a>
          </Button>
        </div>
      </div>
    )
  }

  const groups = groupByExperiment(sessions)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">
            {sessions.length} session{sessions.length === 1 ? "" : "s"} ·{" "}
            {Object.keys(groups).length} experiment{Object.keys(groups).length === 1 ? "" : "s"}
          </p>
        </div>
        {sessions.length > 0 && (
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <Badge variant="secondary">{selectedIds.length} selected for compare</Badge>
                <Button variant="ghost" size="sm" onClick={clearSelected}>
                  Clear selection
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={clearSessions}>
              <Trash2 className="size-4" /> Clear all
            </Button>
          </div>
        )}
      </div>

      {Object.entries(groups).map(([groupId, items]) => {
        const baseline = items.find((s) => s.file.manifest.session.role === "baseline")
        const exposures = items.filter((s) => s.file.manifest.session.role !== "baseline")
        return (
          <section key={groupId} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Layers className="size-3.5" />
              {baseline?.file.manifest.session.label ?? groupId}
              {baseline ? <Badge variant="outline">baseline linked</Badge> : null}
            </div>
            {items.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                open={openId === s.id}
                selected={selectedIds.includes(s.id)}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                onSelect={() => toggleSelected(s.id)}
                onRemove={() => removeSession(s.id)}
                onVerdict={() => {
                  const label = s.file.manifest.session.label
                  if (label) onVerdict(label)
                }}
              />
            ))}
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>{items.length} recording{items.length === 1 ? "" : "s"}</span>
              {exposures.length > 0 && <span>· {exposures.length} exposure{exposures.length === 1 ? "" : "s"}</span>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function groupByExperiment(sessions: SuiteSession[]): Record<string, SuiteSession[]> {
  const groups: Record<string, SuiteSession[]> = {}
  const sorted = [...sessions].sort((a, b) => a.importedAt - b.importedAt)
  for (const s of sorted) {
    const gid = s.file.manifest.session.groupId ?? s.id
    if (!groups[gid]) groups[gid] = []
    groups[gid].push(s)
  }
  return groups
}

function SessionRow({
  session,
  open,
  selected,
  onToggle,
  onSelect,
  onRemove,
  onVerdict,
}: {
  session: SuiteSession
  open: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onRemove: () => void
  onVerdict: () => void
}) {
  const { file, report, features } = session
  const role = file.manifest.session.role
  const label = file.manifest.session.label || "Untitled recording"
  const rawLabel = file.manifest.session.label

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:bg-accent/40 rounded-md px-1 -mx-1"
        >
          <Badge variant={role === "baseline" ? "secondary" : "outline"}>
            {ROLE_LABELS[role] ?? role}
          </Badge>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {session.fileName} · {formatTimeAgo(session.importedAt)}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={onSelect}
            title="Select for compare"
            aria-pressed={selected}
          >
            <span
              className={`flex size-3.5 items-center justify-center rounded-[4px] border transition-colors ${
                selected ? "border-primary bg-primary" : "border-border bg-background"
              }`}
            >
              {selected && <span className="size-1.5 rounded-full bg-background" />}
            </span>
          </Button>
          <Badge variant={report.badge === "Excellent" ? "default" : "secondary"}>
            <ShieldCheck className="size-3" /> {report.total ?? "—"}
          </Badge>
          {rawLabel && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={`Run smellability verdict for "${rawLabel}"`}
              onClick={onVerdict}
            >
              <Wind className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 p-4">
          <div className="mb-4">
            <Button size="sm" variant="outline" onClick={() => downloadOsmell(file, session.fileName)}>
              <Download className="size-4" /> Export .osmell
            </Button>
          </div>
          <SessionDetail
            fileName={session.fileName}
            file={file}
            report={report}
            features={features}
          />
        </div>
      )}
    </div>
  )
}
