"use client"

import * as React from "react"
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  computeQuality,
  ingestFile,
  groupsFromDataTransfer,
  groupsFromFileList,
  LOOSE_GROUP_NAME,
  runProcessor,
  type FileGroup,
  type MoxFeatures,
  type OsmellFile,
  type QualityReport,
} from "@/lib/osmell"
import { useSessions, makeSessionId } from "@/components/suite/session-context"
import {
  SessionDetail,
  downloadOsmell,
  formatDuration,
} from "@/components/suite/session-cards"

type ImportStatus = "idle" | "uploading" | "processing" | "ready" | "error"

type ImportResult =
  | {
      status: "ok"
      fileName: string
      substance: string
      file: OsmellFile
      report: QualityReport
      features: MoxFeatures[] | null
      warnings: string[]
    }
  | { status: "error"; fileName: string; substance: string; error: string }

type OkResult = Extract<ImportResult, { status: "ok" }>

const INGESTIBLE = /\.(csv|txt|osmell)$/i

async function processOsmell(
  f: File,
  substance: string,
): Promise<ImportResult> {
  try {
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
    const processed = runProcessor(parsed)
    return {
      status: "ok",
      fileName: f.name,
      substance,
      file: parsed,
      report,
      features: processed.features ?? null,
      warnings: [],
    }
  } catch (e) {
    return {
      status: "error",
      fileName: f.name,
      substance,
      error: e instanceof Error ? e.message : "Failed to parse file.",
    }
  }
}

async function processFile(f: File, substance: string): Promise<ImportResult> {
  if (f.name.toLowerCase().endsWith(".osmell")) {
    return processOsmell(f, substance)
  }
  const session = await ingestFile(f, substance)
  if (!session.ok || !session.file || !session.report) {
    return {
      status: "error",
      fileName: f.name,
      substance,
      error: session.error ?? "Failed to parse file.",
    }
  }
  return {
    status: "ok",
    fileName: f.name,
    substance,
    file: session.file,
    report: session.report,
    features: session.features,
    warnings: session.warnings,
  }
}

export function ImportView() {
  const { addSession } = useSessions()
  const [status, setStatus] = React.useState<ImportStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<ImportResult[]>([])
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)

  const ingestGroups = React.useCallback(
    async (groups: FileGroup[]) => {
      const tasks: { file: File; substance: string }[] = []
      for (const g of groups) {
        for (const f of g.files) {
          if (!INGESTIBLE.test(f.name)) continue
          tasks.push({
            file: f,
            substance: g.name === LOOSE_GROUP_NAME ? "" : g.name,
          })
        }
      }
      if (tasks.length === 0) {
        setError("No .csv, .txt, or .osmell files found in that selection.")
        setStatus("error")
        return
      }
      setStatus("uploading")
      setError(null)
      setResults([])
      setProgress({ done: 0, total: tasks.length })
      const out: ImportResult[] = []
      for (const t of tasks) {
        const r = await processFile(t.file, t.substance)
        if (r.status === "ok") {
          addSession({
            id: makeSessionId(),
            fileName: r.fileName,
            file: r.file,
            report: r.report,
            features: r.features,
            importedAt: Date.now(),
          })
        }
        out.push(r)
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
      }
      setResults(out)
      setProgress(null)
      setStatus("ready")
    },
    [addSession],
  )

  const handleFiles = React.useCallback(
    async (files: FileList | File[]) => ingestGroups(groupsFromFileList(files)),
    [ingestGroups],
  )

  const handleDrop = React.useCallback(
    async (dt: DataTransfer) => ingestGroups(await groupsFromDataTransfer(dt)),
    [ingestGroups],
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setResults([])
    setError(null)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ""
    if (folderInputRef.current) folderInputRef.current.value = ""
  }, [])

  const okResults = results.filter((r): r is OkResult => r.status === "ok")
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
          Drop CSVs or folders from your Osmograph, ESP32, or any MOX array — or existing{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.osmell</code> files. When you
          drop a folder, each sub-folder becomes a substance and every file is adopted, scored,
          and added to your library for review.
        </p>
      </div>

      {status === "idle" && (
        <UploadCard
          dragOver={dragOver}
          onDragOver={setDragOver}
          onBrowseFiles={() => inputRef.current?.click()}
          onBrowseFolders={() => folderInputRef.current?.click()}
          onDrop={(dt) => handleDrop(dt)}
        />
      )}

      {(status === "uploading" || status === "processing") && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border/60 bg-card py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">
            {progress
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
            <>
              <CollectionReview results={results} />
              <p className="text-xs text-muted-foreground">
                Full per-session detail lives in the Library — filter by quality badge or open the
                manifest to relabel.
              </p>
            </>
          )}
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              {okResults.length} added to your library
              {errResults.length > 0 ? `, ${errResults.length} skipped` : "."}
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
      <input
        ref={folderInputRef}
        type="file"
        accept=".csv,.txt,.osmell"
        multiple
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
    </div>
  )
}

function CollectionReview({ results }: { results: ImportResult[] }) {
  const ok = results.filter((r): r is OkResult => r.status === "ok")
  const err = results.filter((r): r is Extract<ImportResult, { status: "error" }> => r.status === "error")

  const bySubstance = new Map<string, OkResult[]>()
  for (const r of ok) {
    const key = r.substance || "Loose files"
    bySubstance.set(key, [...(bySubstance.get(key) ?? []), r])
  }

  return (
    <div className="flex flex-col gap-4">
      {[...bySubstance.entries()].map(([substance, items]) => (
        <div key={substance} className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-semibold">{substance}</p>
              <Badge variant="secondary" className="shrink-0">
                {items.length} session{items.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => items.forEach((r) => void downloadOsmell(r.file, r.fileName))}
            >
              <Download className="size-3.5" /> Convert all
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {items.map((r) => (
              <SessionRow key={r.fileName} result={r} />
            ))}
          </div>
        </div>
      ))}

      {err.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Skipped</p>
          {err.map((r) => (
            <div key={r.fileName} className="flex items-center gap-2 text-sm">
              <XCircle className="size-4 shrink-0 text-destructive" />
              <span className="min-w-0 truncate">{r.fileName}</span>
              <span className="shrink-0 truncate text-xs text-destructive">{r.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ result }: { result: OkResult }) {
  const { file, report } = result
  const rate = file.manifest.sensor.samplingRateHz
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 pb-1.5 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-3 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{result.fileName}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {file.manifest.sensor.channels.length} ch · {file.time.length.toLocaleString()} samples ·{" "}
          {formatDuration(file.time.length, rate ?? 0)}
        </span>
        <Badge variant={report.badge === "Excellent" ? "default" : "secondary"} className="shrink-0">
          {report.total ?? "—"}/100 · {report.badge}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => void downloadOsmell(file, result.fileName)}>
          <Download className="size-3.5" /> .osmell
        </Button>
      </div>
      {result.warnings.length > 0 && (
        <p className="truncate pl-7 text-xs text-muted-foreground">{result.warnings.join(" · ")}</p>
      )}
    </div>
  )
}

function UploadCard({
  dragOver,
  onDragOver,
  onBrowseFiles,
  onBrowseFolders,
  onDrop,
}: {
  dragOver: boolean
  onDragOver: (over: boolean) => void
  onBrowseFiles: () => void
  onBrowseFolders: () => void
  onDrop: (dt: DataTransfer) => void
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
        onDrop(e.dataTransfer)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-20 text-center transition-colors ${
        dragOver
          ? "border-ring bg-accent/60"
          : "border-border bg-card hover:border-ring/50 hover:bg-accent/40"
      }`}
      onClick={onBrowseFiles}
    >
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
        <UploadCloud className="size-6" />
      </div>
      <div>
        <p className="text-sm font-medium">
          Drop recordings or folders here, or <span className="text-primary">browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5">.csv</code>{" "}
          <code className="rounded bg-muted px-1 py-0.5">.txt</code>{" "}
          <code className="rounded bg-muted px-1 py-0.5">.osmell</code> — one, many, or a whole
          SmellNet-style folder tree
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            onBrowseFiles()
          }}
        >
          <UploadCloud className="size-3.5" /> Files
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            onBrowseFolders()
          }}
        >
          <FolderOpen className="size-3.5" /> Folder
        </Button>
      </div>
    </div>
  )
}
