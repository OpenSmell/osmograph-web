"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  FlaskConical,
  Info,
  Pin,
  Plus,
  Search,
  Send,
  X,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  SENSOR_COUNT_OPTIONS,
  COMPOUND_BY_ID,
  buildProvisionalChemical,
  describeBoundaries,
  lookupPubChem,
  lookupPubChemBoilingPoint,
  perceptsFor,
  perceptualSummary,
  relevantBoundaries,
  runChemicalVerdict,
  saveToUserDictionary,
  searchSubstances,
  resolveAndRun,
  type ChainStep,
  type ChainValue,
  type Chemical,
  type ConstituentVerdict,
  type EnrichedBoilingPoint,
  type EnrichedChemical,
  type FeasibilityVerdict,
  type Percept,
  type ResolvedEntity,
  type SearchCandidate,
  type SignalStrength,
  type Verdict,
} from "@/lib/smellability"
import type { SuiteSession } from "./session-context"

const EXAMPLES = [
  "banana",
  "cinnamon",
  "garlic",
  "gasoline",
  "spoiled milk",
  "hand sanitizer",
  "rotten egg",
  "ethanol",
]

const VERDICT_META: Record<Verdict, { label: string; text: string; chip: string }> = {
  green: {
    label: "Detectable",
    text: "text-emerald-500",
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  },
  yellow: {
    label: "Partially detectable",
    text: "text-amber-500",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  },
  red: {
    label: "Not detectable",
    text: "text-red-500",
    chip: "border-red-500/40 bg-red-500/10 text-red-500",
  },
}

const SIGNAL_META: Record<SignalStrength, { label: string; chip: string }> = {
  strong: { label: "Strong signal", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  moderate: { label: "Moderate signal", chip: "border-sky-500/40 bg-sky-500/10 text-sky-500" },
  weak: { label: "Weak signal", chip: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  none: { label: "No signal expected", chip: "border-red-500/40 bg-red-500/10 text-red-500" },
}

const SPEED_LABELS: Record<string, string> = {
  fast: "Fast response",
  medium: "Medium response",
  slow: "Slow response",
  unknown: "Response speed unknown",
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
}

function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  const meta = VERDICT_META[verdict]
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.chip, className)}>{meta.label}</span>
}

function SignalChip({ strength }: { strength: SignalStrength }) {
  const meta = SIGNAL_META[strength]
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.chip)}>{meta.label}</span>
}

function SourceDot({ source }: { source: "measured" | "estimated" | "unknown" }) {
  const cls =
    source === "measured"
      ? "bg-emerald-500"
      : source === "estimated"
        ? "bg-amber-500"
        : "bg-muted-foreground/50"
  const title =
    source === "measured"
      ? "Measured / curated value"
      : source === "estimated"
        ? "Estimated value"
        : "Unknown — not in the curated dictionary"
  return <span title={title} className={cn("inline-block size-1.5 rounded-full", cls)} />
}

function StepCard({
  step,
  index,
  open,
  onToggle,
}: {
  step: ChainStep
  index: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
            step.verdict === "green" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
            step.verdict === "yellow" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
            step.verdict === "red" && "border-red-500/40 bg-red-500/10 text-red-500",
          )}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{step.label}</p>
          <p className="truncate text-xs text-muted-foreground">{step.reason}</p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/60 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
          <div className="mt-3 flex flex-col gap-1.5">
            {step.values.map((v) => (
              <div key={v.label} className="flex items-center gap-2 text-xs">
                <SourceDot source={v.source} />
                <span className="w-48 shrink-0 text-muted-foreground">{v.label}</span>
                <span className="font-mono text-foreground">{v.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StepsList({ steps }: { steps: ChainStep[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <StepCard
          key={s.id}
          step={s}
          index={i + 1}
          open={openId === s.id}
          onToggle={() => setOpenId(openId === s.id ? null : s.id)}
        />
      ))}
    </div>
  )
}

function ConstituentRow({
  c,
  open,
  onToggle,
}: {
  c: ConstituentVerdict
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{c.name}</p>
            <span className="text-xs tabular-nums text-muted-foreground">
              {(c.weightFraction * 100).toFixed(0)}% of profile
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.max(2, c.weightFraction * 100)}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SignalChip strength={c.signalStrength} />
          <VerdictChip verdict={c.verdict} />
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="border-t border-border/60 p-4">
          <StepsList steps={c.steps} />
        </div>
      )}
    </div>
  )
}

const BENCH_SORT_RANKS = {
  verdict: { green: 0, yellow: 1, red: 2 } as Record<Verdict, number>,
  signal: { strong: 0, moderate: 1, weak: 2, none: 3 } as Record<SignalStrength, number>,
  speed: { fast: 0, medium: 1, slow: 2, unknown: 3 } as Record<string, number>,
  confidence: { high: 0, medium: 1, low: 2 } as Record<string, number>,
}

type BenchSortKey = "name" | "verdict" | "signal" | "speed" | "confidence"

function benchRank(v: FeasibilityVerdict, key: BenchSortKey): string | number {
  switch (key) {
    case "name":
      return v.entityName.toLowerCase()
    case "verdict":
      return BENCH_SORT_RANKS.verdict[v.verdict]
    case "signal":
      return BENCH_SORT_RANKS.signal[v.signalStrength]
    case "speed":
      return BENCH_SORT_RANKS.speed[v.responseSpeed]
    case "confidence":
      return BENCH_SORT_RANKS.confidence[v.confidence]
  }
}

function keyFacts(v: FeasibilityVerdict): ChainValue[] {
  const identity = v.steps.find((s) => s.id === "identity")
  const signal = v.steps.find((s) => s.id === "signal")
  return [...(identity?.values ?? []), ...(signal?.values ?? [])].slice(0, 6)
}

function LiveResultCard({
  verdict,
  percepts,
  enriched,
  bp,
  saved,
  pinned,
  resolving,
  onSave,
  onPin,
  onContribute,
  onClear,
}: {
  verdict: FeasibilityVerdict
  percepts: Percept[]
  enriched: EnrichedChemical | null
  bp: EnrichedBoilingPoint | null
  saved: boolean
  pinned: boolean
  resolving: boolean
  onSave: () => void
  onPin: () => void
  onContribute: () => void
  onClear: () => void
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5",
        verdict.verdict === "green" ? "border-emerald-500/30" : verdict.verdict === "yellow" ? "border-amber-500/30" : "border-red-500/30",
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
        <Info className="size-3.5 shrink-0" />
        <span className="flex-1">
          Provisional — resolved live from PubChem. Amber dots mark estimated properties; we never fabricate missing data.
        </span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500">
            <FlaskConical className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{verdict.entityName}</h2>
              <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                provisional
              </Badge>
              <Badge variant="outline">{verdict.kind}</Badge>
            </div>
            <p className={cn("mt-0.5 text-sm font-medium", VERDICT_META[verdict.verdict].text)}>
              {VERDICT_META[verdict.verdict].label}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {verdict.entityName} is <span className="capitalize">{verdict.signalStrength}</span> — expected{" "}
              {SPEED_LABELS[verdict.responseSpeed]?.toLowerCase()}. {bp ? `Boiling point ${bp.valueC} °C via PubChem.` : "No boiling point found on PubChem — vapor pressure unknown."}
            </p>
            {percepts.length > 0 && (
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {perceptualSummary(verdict, percepts)}
              </p>
            )}
            {enriched?.molecularFormula && (
              <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                {enriched.molecularFormula}
                {enriched.molecularWeight ? ` · ${enriched.molecularWeight.toFixed(1)} g/mol` : ""} · PubChem
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SignalChip strength={verdict.signalStrength} />
          <Badge variant="secondary">{SPEED_LABELS[verdict.responseSpeed] ?? verdict.responseSpeed}</Badge>
          <Badge variant="secondary">{CONFIDENCE_LABELS[verdict.confidence] ?? verdict.confidence}</Badge>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="size-4" /> Clear
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <StepsList steps={verdict.steps} />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border/60 bg-card">
            <div className="border-b border-border/60 px-4 py-2.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provenance</span>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <SourceDot source="estimated" />
                <span className="text-muted-foreground">Vapor pressure estimated from boiling point (Clausius–Clapeyron + Trouton)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <SourceDot source="estimated" />
                <span className="text-muted-foreground">Functional groups inferred structurally from PubChem SMILES</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <SourceDot source="measured" />
                <span className="text-muted-foreground">Molecular weight &amp; boiling point from PubChem</span>
              </div>
            </div>
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onPin} disabled={pinned}>
                {pinned ? (
                  <>
                    <Pin className="size-4" /> On bench
                  </>
                ) : (
                  <>
                    <Pin className="size-4" /> Pin to bench
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={onContribute}>
                <Send className="size-4" /> Contribute
              </Button>
            </div>
            <Button size="sm" onClick={onSave} disabled={saved}>
              {saved ? (
                <>
                  <CheckCircle2 className="size-4" /> Saved to my dictionary
                </>
              ) : (
                <>
                  <Plus className="size-4" /> Add to my dictionary
                </>
              )}
            </Button>
            {saved && (
              <p className="text-xs text-muted-foreground">
                Now searchable as <span className="font-medium text-foreground">my dictionary · estimated</span>. It is a
                tier-2 provisional entry — flagged, never presented as curated.
              </p>
            )}
          </div>
        </div>
      </div>

      {verdict.notes.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/60 p-3">
          {verdict.notes.map((n, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {n}
            </p>
          ))}
        </div>
      )}

      {resolving && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground" />
          Resolving via PubChem…
        </div>
      )}
    </div>
  )
}

export function SmellabilityView({
  sessions,
  prefill,
}: {
  sessions: SuiteSession[]
  prefill?: string | null
}) {
  const [query, setQuery] = React.useState("")
  const [candidates, setCandidates] = React.useState<SearchCandidate[]>([])
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [selected, setSelected] = React.useState<ResolvedEntity | null>(null)
  const [sensorCount, setSensorCount] = React.useState(6)
  const [expandedConstituent, setExpandedConstituent] = React.useState<string | null>(null)
  const [methodOpen, setMethodOpen] = React.useState(false)
  const [contribOpen, setContribOpen] = React.useState(false)
  const [contribText, setContribText] = React.useState("")
  const [contribSaved, setContribSaved] = React.useState(false)
  const [resolving, setResolving] = React.useState(false)
  const [enriched, setEnriched] = React.useState<EnrichedChemical | null>(null)
  const [resolveFailed, setResolveFailed] = React.useState(false)

  const [liveResolving, setLiveResolving] = React.useState(false)
  const [liveChemical, setLiveChemical] = React.useState<Chemical | null>(null)
  const [liveEnriched, setLiveEnriched] = React.useState<EnrichedChemical | null>(null)
  const [liveBp, setLiveBp] = React.useState<EnrichedBoilingPoint | null>(null)
  const [liveResolveFailed, setLiveResolveFailed] = React.useState(false)
  const [liveSaved, setLiveSaved] = React.useState(false)

  const handledPrefill = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!prefill) {
      handledPrefill.current = null
      return
    }
    if (handledPrefill.current === prefill) return
    handledPrefill.current = prefill
    void (async () => {
      setQuery(prefill)
      const results = searchSubstances(prefill, 1)
      if (results.length > 0) {
        pick(results[0])
      } else {
        setSelected(null)
        setCandidates([])
        setShowSuggestions(false)
        void resolveLive(prefill)
      }
    })()
  }, [prefill])

  const [bench, setBench] = React.useState<FeasibilityVerdict[]>([])
  const [benchLoaded, setBenchLoaded] = React.useState(false)
  const [benchSort, setBenchSort] = React.useState<{ key: BenchSortKey; dir: 1 | -1 }>({ key: "verdict", dir: 1 })
  const [compareIds, setCompareIds] = React.useState<string[]>([])
  const [benchFocus, setBenchFocus] = React.useState<FeasibilityVerdict | null>(null)

  const librarySubstances = React.useMemo(
    () =>
      sessions
        .map((s) => s.file.manifest.session.label)
        .filter((l): l is string => !!l && l.trim().length > 0),
    [sessions],
  )

  const verdict = React.useMemo(() => {
    if (!selected) return null
    return resolveAndRun(selected.id, selected.kind, { sensorCount, librarySubstances })
  }, [selected, sensorCount, librarySubstances])

  const percepts = React.useMemo(() => {
    if (!verdict) return []
    if (verdict.kind === "chemical") {
      const c = COMPOUND_BY_ID.get(verdict.entityId)
      return c ? perceptsFor(c) : []
    }
    if (verdict.kind === "composite") {
      const dominant = [...verdict.constituents].sort((a, b) => b.weightFraction - a.weightFraction)[0]
      const c = dominant ? COMPOUND_BY_ID.get(dominant.chemicalId) : null
      return c ? perceptsFor(c) : []
    }
    return []
  }, [verdict])

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem("osmell-bench")
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            setBench(
              parsed.filter((b): b is FeasibilityVerdict => !!b && typeof b === "object" && !!b.entityId && !!b.entityName),
            )
          }
        }
      } catch {
        /* corrupt or unavailable — start empty */
      }
      setBenchLoaded(true)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  React.useEffect(() => {
    if (!benchLoaded) return
    try {
      localStorage.setItem("osmell-bench", JSON.stringify(bench))
    } catch {
      /* storage full or unavailable — ignore */
    }
  }, [bench, benchLoaded])

  const liveVerdict = React.useMemo(() => {
    if (!liveChemical) return null
    return runChemicalVerdict(liveChemical, { sensorCount, librarySubstances })
  }, [liveChemical, sensorCount, librarySubstances])

  const livePercepts = React.useMemo(() => (liveChemical ? perceptsFor(liveChemical) : []), [liveChemical])

  const sortedBench = React.useMemo(() => {
    const dir = benchSort.dir
    return [...bench].sort((a, b) => {
      const x = benchRank(a, benchSort.key)
      const y = benchRank(b, benchSort.key)
      if (x < y) return -1 * dir
      if (x > y) return 1 * dir
      return a.entityName.localeCompare(b.entityName)
    })
  }, [bench, benchSort])

  const compareItems = React.useMemo(
    () => compareIds.map((id) => bench.find((b) => b.entityId === id)).filter((b): b is FeasibilityVerdict => !!b),
    [compareIds, bench],
  )

  function handleQuery(value: string) {
    setQuery(value)
    const trimmed = value.trim()
    if (trimmed.length >= 2) {
      setCandidates(searchSubstances(trimmed))
      setShowSuggestions(true)
    } else {
      setCandidates([])
      setShowSuggestions(false)
    }
  }

  function pick(c: SearchCandidate) {
    setSelected({ kind: c.kind, id: c.id, name: c.name, displayName: c.displayName, matchHint: c.matchHint })
    setQuery(c.displayName)
    setCandidates([])
    setShowSuggestions(false)
    setLiveChemical(null)
    setLiveEnriched(null)
    setLiveBp(null)
    setLiveResolveFailed(false)
    setLiveSaved(false)
    setBenchFocus(null)
  }

  function runExample(example: string) {
    setQuery(example)
    const results = searchSubstances(example, 1)
    if (results.length > 0) pick(results[0])
  }

  function clearResult() {
    setSelected(null)
    setQuery("")
    setCandidates([])
    setShowSuggestions(false)
    setLiveChemical(null)
    setLiveEnriched(null)
    setLiveBp(null)
    setLiveResolveFailed(false)
    setLiveSaved(false)
    setBenchFocus(null)
  }

  function exportReport() {
    const v = verdict ?? liveVerdict
    if (!v) return
    const blob = new Blob([JSON.stringify(v, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `smellability-${v.entityName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function saveContribution() {
    const trimmed = contribText.trim()
    if (!trimmed) return
    const entry = enriched
      ? `${trimmed} (resolved: ${enriched.molecularFormula ?? ""}${enriched.molecularWeight ? `, ${enriched.molecularWeight.toFixed(1)} g/mol` : ""})`
      : trimmed
    try {
      const existing = JSON.parse(localStorage.getItem("osmell-contributions") ?? "[]") as string[]
      existing.push(entry)
      localStorage.setItem("osmell-contributions", JSON.stringify(existing))
    } catch {
      localStorage.setItem("osmell-contributions", JSON.stringify([entry]))
    }
    setContribText("")
    setContribSaved(true)
  }

  async function resolveContribution() {
    const trimmed = contribText.trim()
    if (!trimmed) return
    setResolving(true)
    setResolveFailed(false)
    setEnriched(null)
    const result = await lookupPubChem(trimmed)
    setResolving(false)
    if (result) {
      setEnriched(result)
    } else {
      setResolveFailed(true)
    }
  }

  async function resolveLive(name: string) {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    setLiveResolving(true)
    setLiveResolveFailed(false)
    setLiveSaved(false)
    setLiveChemical(null)
    setLiveEnriched(null)
    setLiveBp(null)
    const enriched = await lookupPubChem(trimmed)
    if (!enriched) {
      setLiveResolving(false)
      setLiveResolveFailed(true)
      return
    }
    const bp = await lookupPubChemBoilingPoint(trimmed)
    const chemical = buildProvisionalChemical(enriched, bp)
    setLiveEnriched(enriched)
    setLiveBp(bp)
    setLiveChemical(chemical)
    setLiveResolving(false)
  }

  function saveLiveToDictionary() {
    if (!liveChemical) return
    const ok = saveToUserDictionary(liveChemical)
    if (ok) setLiveSaved(true)
  }

  function contributeLive() {
    setContribText(liveEnriched?.name ?? query.trim())
    setEnriched(liveEnriched)
    setContribSaved(false)
    setContribOpen(true)
  }

  function isPinned(entityId: string): boolean {
    return bench.some((b) => b.entityId === entityId)
  }

  function toggleBench(v: FeasibilityVerdict) {
    setBench((prev) => {
      if (prev.some((b) => b.entityId === v.entityId)) {
        return prev.filter((b) => b.entityId !== v.entityId)
      }
      return [...prev, v].slice(-12)
    })
    setBenchFocus(null)
  }

  function removeBench(entityId: string) {
    setBench((prev) => prev.filter((b) => b.entityId !== entityId))
    setCompareIds((prev) => prev.filter((id) => id !== entityId))
    setBenchFocus((prev) => (prev?.entityId === entityId ? null : prev))
  }

  function toggleCompare(entityId: string) {
    setCompareIds((prev) => {
      if (prev.includes(entityId)) return prev.filter((id) => id !== entityId)
      if (prev.length >= 4) return prev
      return [...prev, entityId]
    })
  }

  function cycleBenchSort(key: BenchSortKey) {
    setBenchSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 1 ? -1 : 1 }
      return { key, dir: 1 }
    })
  }

  function sortIcon(key: BenchSortKey) {
    if (benchSort.key !== key) return <ArrowUpDown className="size-3 opacity-50" />
    return benchSort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Smellability</h1>
          <p className="text-sm text-muted-foreground">
            Will your MOX array detect it — and can it tell it apart from what you already record?
          </p>
        </div>
        {(verdict || liveVerdict) && (
          <Button variant="outline" size="sm" onClick={exportReport}>
            <Download className="size-4" /> Export report
          </Button>
        )}
      </div>

      <Card className="border-border/60">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => handleQuery(e.target.value)}
              onFocus={() => query.trim().length >= 2 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Try a substance — a compound, a food, a product, a smell…"
              className="h-12 pl-10 pr-10 text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && candidates.length > 0) pick(candidates[0])
              }}
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("")
                  setCandidates([])
                  setShowSuggestions(false)
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
            {showSuggestions && query.trim().length >= 2 && (
              <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg">
                {candidates.length === 0 && (
                  <p className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
                    No dictionary match for <span className="font-medium text-foreground">“{query.trim()}”</span> — resolve it
                    live, or queue a curation request.
                  </p>
                )}
                {candidates.map((c) => (
                  <button
                    key={`${c.kind}:${c.id}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.displayName}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{c.matchHint}</span>
                  </button>
                ))}
                {candidates.length >= 8 && (
                  <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
                    Narrow it down, or resolve it live below.
                  </p>
                )}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setShowSuggestions(false)
                    setLiveResolveFailed(false)
                    void resolveLive(query)
                  }}
                  className="flex w-full items-center gap-2 border-t border-border/60 px-4 py-2.5 text-left text-xs font-medium text-amber-500 transition-colors hover:bg-accent/60"
                >
                  {liveResolving ? (
                    <>
                      <span className="size-3 animate-spin rounded-full border-2 border-border border-t-amber-500" />
                      Resolving <span className="truncate font-mono text-foreground">{query.trim()}</span> via PubChem…
                    </>
                  ) : (
                    <>
                      <FlaskConical className="size-3.5 shrink-0" />
                      Not in the dictionary — resolve <span className="truncate font-mono text-foreground">{query.trim()}</span>{" "}
                      live via PubChem
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => runExample(ex)}
                className="rounded-full border border-border/60 px-2.5 py-0.5 transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
            <button
              onClick={() => setContribOpen(true)}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2.5 py-0.5 transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="size-3" /> request one
            </button>
          </div>
        </CardContent>
      </Card>

      {!verdict && !liveVerdict && !liveResolving && (
        <Card className="border-dashed border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-lg border border-border/60 bg-background">
              <FlaskConical className="size-6 text-muted-foreground" />
            </div>
            <div className="flex max-w-md flex-col gap-1">
              <p className="text-sm font-medium">No substance selected yet</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Type anything — a chemical like <span className="font-mono">ethanol</span>, an everyday thing like{" "}
                <span className="font-mono">banana</span>, or a product like <span className="font-mono">hand sanitizer</span>. The
                engine resolves it to its volatile chemistry and grades detectability through a physics chain. Not in the
                dictionary? It resolves anything PubChem knows — live, and honestly flagged as provisional.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {liveResolving && (
        <Card className="border-amber-500/30">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <span className="size-5 animate-spin rounded-full border-2 border-border border-t-amber-500" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                Resolving <span className="font-mono">“{query.trim()}”</span> via PubChem…
              </p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Fetching structure and boiling point. A cold lookup can take ~10 seconds; warm ones are cached locally.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {liveResolveFailed && (
        <Card className="border-red-500/30">
          <CardContent className="flex flex-col gap-2 py-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10">
                <XCircle className="size-6 text-red-500" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">PubChem couldn&apos;t resolve that</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  “{query.trim()}” returned no structure. Try a common name or chemical formula, or queue a curation request —
                  we&apos;ll research it manually.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setContribOpen(true)}>
                  <Send className="size-4" /> Request curation
                </Button>
                <Button variant="ghost" size="sm" onClick={clearResult}>
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {liveVerdict && (
        <LiveResultCard
          verdict={liveVerdict}
          percepts={livePercepts}
          enriched={liveEnriched}
          bp={liveBp}
          saved={liveSaved}
          pinned={isPinned(liveVerdict.entityId)}
          resolving={liveResolving}
          onSave={saveLiveToDictionary}
          onPin={() => toggleBench(liveVerdict)}
          onContribute={contributeLive}
          onClear={clearResult}
        />
      )}

      {verdict && !liveVerdict && (
        <>
          <div className={cn("rounded-xl border bg-card p-5", VERDICT_META[verdict.verdict].chip === VERDICT_META.green.chip ? "border-emerald-500/30" : VERDICT_META[verdict.verdict].chip === VERDICT_META.yellow.chip ? "border-amber-500/30" : "border-red-500/30")}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <div
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-lg border",
                    verdict.verdict === "green" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
                    verdict.verdict === "yellow" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
                    verdict.verdict === "red" && "border-red-500/40 bg-red-500/10 text-red-500",
                  )}
                >
                  {verdict.verdict === "green" ? (
                    <CheckCircle2 className="size-6" />
                  ) : verdict.verdict === "yellow" ? (
                    <AlertTriangle className="size-6" />
                  ) : (
                    <XCircle className="size-6" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">{verdict.entityName}</h2>
                    <Badge variant="outline">{verdict.kind}</Badge>
                  </div>
                  <p className={cn("mt-0.5 text-sm font-medium", VERDICT_META[verdict.verdict].text)}>
                    {VERDICT_META[verdict.verdict].label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {verdict.entityName} is <span className="capitalize">{verdict.signalStrength}</span> — expected{" "}
                    {SPEED_LABELS[verdict.responseSpeed]?.toLowerCase()}.
                  </p>
                  {percepts.length > 0 && (
                    <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                      {perceptualSummary(verdict, percepts)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SignalChip strength={verdict.signalStrength} />
                <Badge variant="secondary">{SPEED_LABELS[verdict.responseSpeed] ?? verdict.responseSpeed}</Badge>
                <Badge variant="secondary">{CONFIDENCE_LABELS[verdict.confidence] ?? verdict.confidence}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleBench(verdict)}
                  disabled={isPinned(verdict.entityId)}
                >
                  <Pin className={cn("size-4", isPinned(verdict.entityId) && "fill-current")} />
                  {isPinned(verdict.entityId) ? "On bench" : "Pin to bench"}
                </Button>
                <Button variant="ghost" size="sm" onClick={clearResult}>
                  <X className="size-4" /> Clear
                </Button>
              </div>
            </div>
            {verdict.notes.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/60 p-3">
                {verdict.notes.map((n, i) => (
                  <p key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {n}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-6">
              {verdict.kind === "chemical" || verdict.kind === "class" ? (
                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Feasibility chain
                    </h3>
                  </div>
                  <StepsList steps={verdict.steps} />
                </section>
              ) : (
                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Volatile profile
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {verdict.constituents.length} constituents · click to inspect
                    </span>
                  </div>
                  {verdict.constituents.map((c) => (
                    <ConstituentRow
                      key={c.chemicalId}
                      c={c}
                      open={expandedConstituent === c.chemicalId}
                      onToggle={() =>
                        setExpandedConstituent(expandedConstituent === c.chemicalId ? null : c.chemicalId)
                      }
                    />
                  ))}
                </section>
              )}

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recommended protocol</CardTitle>
                  <CardDescription className="text-xs">
                    Baseline-guided recording keeps your library comparable.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-xs text-muted-foreground">Exposure</span>
                    <p className="flex-1 text-sm leading-relaxed">{verdict.exposureGuidance}</p>
                  </div>
                  <Separator />
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-xs text-muted-foreground">Dilution</span>
                    <p className="flex-1 text-sm leading-relaxed">{verdict.dilutionGuidance}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-6">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Array & cross-sensitivity</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">Sensors on your array</label>
                    <Select value={String(sensorCount)} onValueChange={(v) => setSensorCount(Number(v))}>
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SENSOR_COUNT_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} sensors
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {verdict.crossCheck && (
                    <>
                      <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-2">
                        <span className="text-xs text-muted-foreground">Resolvable substances</span>
                        <span className="text-sm font-semibold tabular-nums">
                          ≈ {verdict.crossCheck.maxDistinguishable.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{verdict.crossCheck.note}</p>
                      {verdict.crossCheck.confusable.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-amber-500">Possible overlap in your library</span>
                          <div className="flex flex-wrap gap-1.5">
                            {verdict.crossCheck.confusable.map((label) => (
                              <Badge key={label} variant="outline" className="border-amber-500/40 text-amber-500">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {librarySubstances.length} labeled session{librarySubstances.length === 1 ? "" : "s"} in your library feed
                    this check.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">What MOX can &amp; can&apos;t tell you</CardTitle>
                  <CardDescription className="text-xs">
                    MOX is the black-and-white TV of olfaction — you read the hat, never the hat&apos;s true colour.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-emerald-500">The array can say</span>
                    <ul className="flex flex-col gap-1.5">
                      {describeBoundaries().can.map((b) => (
                        <li key={b.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500/70" />
                          <span>{b.statement}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-red-400">Beyond MOX — and it stays grey</span>
                    <ul className="flex flex-col gap-1.5">
                      {describeBoundaries().cannot.map((b) => {
                        const active = relevantBoundaries(verdict).includes(b.id)
                        return (
                          <li
                            key={b.id}
                            className={cn(
                              "flex items-start gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground",
                              active && "border border-red-500/30 bg-red-500/5 text-foreground",
                            )}
                          >
                            <XCircle className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-red-500" : "text-muted-foreground/50")} />
                            <span>
                              {b.statement}
                              {active && <span className="ml-1 font-medium text-red-500">— applies to this result</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    These limits are why verdicts say <em>what kind of thing it is</em> and how strongly it will respond —
                    never the exact molecule or a calibrated ppm.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <button
                    onClick={() => setMethodOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <BookOpen className="size-4" /> How this verdict is computed
                    </span>
                    <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", methodOpen && "rotate-180")} />
                  </button>
                  {methodOpen && (
                    <div className="mt-3 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
                      <p>Every substance resolves to its volatile chemistry, then runs a 4-step chain:</p>
                      <ol className="flex list-decimal flex-col gap-1.5 pl-4">
                        <li>
                          <b className="text-foreground">Volatility</b> — vapor pressure at 25 °C (Antoine, else
                          Clausius–Clapeyron + Trouton).
                        </li>
                        <li>
                          <b className="text-foreground">Headspace concentration</b> — saturated mole fraction
                          (p_vap / P_atm), compared to the ~1 ppm MOX floor.
                        </li>
                        <li>
                          <b className="text-foreground">MOX reactivity</b> — redox-active functional groups oxidized
                          at ~350 °C; non-redox gases are hard stops.
                        </li>
                        <li>
                          <b className="text-foreground">Array capacity</b> — how many substances your sensor count can
                          resolve, plus overlap with your library.
                        </li>
                      </ol>
                      <p>
                        Mixtures (foods, products) aggregate per-constituent grades weighted by abundance. Estimated
                        properties are flagged with a dot — we never fabricate missing data.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Bench</h3>
            <p className="text-xs text-muted-foreground">
              Pin verdicts from any result, then compare detectability side by side. Tick 2–4 rows to compare.
            </p>
          </div>
          {bench.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {compareIds.length >= 2 ? (
                <Badge variant="secondary">comparing {compareIds.length}</Badge>
              ) : (
                <span>select 2–4 to compare</span>
              )}
            </div>
          )}
        </div>

        {bench.length === 0 ? (
          <Card className="border-dashed border-border/60">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                <Pin className="size-5 text-muted-foreground" />
              </div>
              <div className="flex max-w-md flex-col gap-1">
                <p className="text-sm font-medium">Bench is empty</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Use <span className="font-medium text-foreground">Pin to bench</span> on any verdict — curated or live —
                  to keep it here. The bench persists across visits.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60">
            <CardContent className="p-0">
              <div className="hidden items-center gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:flex">
                <span className="w-4 shrink-0" />
                <button className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground" onClick={() => cycleBenchSort("name")}>
                  Substance {sortIcon("name")}
                </button>
                <button className="w-24 shrink-0 text-left hover:text-foreground" onClick={() => cycleBenchSort("verdict")}>
                  Verdict {sortIcon("verdict")}
                </button>
                <button className="w-32 shrink-0 text-left hover:text-foreground" onClick={() => cycleBenchSort("signal")}>
                  Signal {sortIcon("signal")}
                </button>
                <button className="w-28 shrink-0 text-left hover:text-foreground" onClick={() => cycleBenchSort("speed")}>
                  Speed {sortIcon("speed")}
                </button>
                <button className="w-28 shrink-0 text-left hover:text-foreground" onClick={() => cycleBenchSort("confidence")}>
                  Confidence {sortIcon("confidence")}
                </button>
                <span className="w-8 shrink-0" />
              </div>
              <div className="flex flex-col">
                {sortedBench.map((v) => (
                  <div
                    key={v.entityId}
                    className={cn(
                      "flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0",
                      benchFocus?.entityId === v.entityId && "bg-accent/40",
                    )}
                  >
                    <Checkbox
                      className="shrink-0"
                      checked={compareIds.includes(v.entityId)}
                      onCheckedChange={() => toggleCompare(v.entityId)}
                      aria-label={`Compare ${v.entityName}`}
                      disabled={!compareIds.includes(v.entityId) && compareIds.length >= 4}
                    />
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setBenchFocus(benchFocus?.entityId === v.entityId ? null : v)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{v.entityName}</span>
                        <span className="block text-xs text-muted-foreground">{v.kind}</span>
                      </span>
                    </button>
                    <span className="w-24 shrink-0">
                      <VerdictChip verdict={v.verdict} />
                    </span>
                    <span className="w-32 shrink-0">
                      <SignalChip strength={v.signalStrength} />
                    </span>
                    <span className="hidden w-28 shrink-0 text-xs text-muted-foreground md:block">
                      {SPEED_LABELS[v.responseSpeed] ?? v.responseSpeed}
                    </span>
                    <span className="hidden w-28 shrink-0 text-xs text-muted-foreground md:block">
                      {CONFIDENCE_LABELS[v.confidence] ?? v.confidence}
                    </span>
                    <button
                      className="w-8 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => removeBench(v.entityId)}
                      aria-label={`Remove ${v.entityName} from bench`}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              {bench.length === 0 && (
                <p className="px-4 py-4 text-xs text-muted-foreground">Nothing on the bench.</p>
              )}
            </CardContent>
          </Card>
        )}

        {benchFocus && (
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">{benchFocus.entityName}</CardTitle>
                  <CardDescription className="text-xs">Snapshotted verdict from the bench.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeBench(benchFocus.entityId)}>
                  <X className="size-4" /> Remove
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <VerdictChip verdict={benchFocus.verdict} />
                <SignalChip strength={benchFocus.signalStrength} />
                <Badge variant="secondary">{SPEED_LABELS[benchFocus.responseSpeed] ?? benchFocus.responseSpeed}</Badge>
                <Badge variant="secondary">{CONFIDENCE_LABELS[benchFocus.confidence] ?? benchFocus.confidence}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/60 p-3">
                  {keyFacts(benchFocus).map((f) => (
                    <div key={f.label} className="flex items-center gap-2 text-xs">
                      <SourceDot source={f.source} />
                      <span className="w-40 shrink-0 text-muted-foreground">{f.label}</span>
                      <span className="font-mono text-foreground">{f.value}</span>
                    </div>
                  ))}
                </div>
                <StepsList steps={benchFocus.steps} />
              </div>
            </CardContent>
          </Card>
        )}

        {compareItems.length >= 2 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Side by side</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCompareIds([])
                  setBenchFocus(null)
                }}
              >
                <X className="size-4" /> Clear compare
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {compareItems.map((v) => (
                <div key={v.entityId} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold" title={v.entityName}>
                        {v.entityName}
                      </p>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{v.kind}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <VerdictChip verdict={v.verdict} />
                      <SignalChip strength={v.signalStrength} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {SPEED_LABELS[v.responseSpeed] ?? v.responseSpeed} · {CONFIDENCE_LABELS[v.confidence] ?? v.confidence}
                    </p>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-1.5">
                    {keyFacts(v).map((f) => (
                      <div key={f.label} className="flex items-center gap-2 text-[11px]">
                        <SourceDot source={f.source} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.label}</span>
                        <span className="shrink-0 font-mono text-foreground">{f.value}</span>
                      </div>
                    ))}
                  </div>
                  <StepsList steps={v.steps} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <Dialog open={contribOpen} onOpenChange={setContribOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a substance</DialogTitle>
            <DialogDescription>
              Not in the dictionary? Tell us what you want to test — a compound, food, or product. Your request joins a
              queue that shapes what we curate next.
            </DialogDescription>
          </DialogHeader>
          {contribSaved ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                <CheckCircle2 className="size-5 text-emerald-500" />
              </div>
              <p className="text-sm font-medium">Queued locally</p>
              <p className="text-xs text-muted-foreground">
                Your request is saved in this browser. Curated additions will grow the shared dictionary.
              </p>
            </div>
          ) : (
            <>
              <Textarea
                value={contribText}
                onChange={(e) => {
                  setContribText(e.target.value)
                  setEnriched(null)
                  setResolveFailed(false)
                }}
                placeholder={'e.g. "fresh cut grass", "truffle oil", "acetone", "off-gassing new car"…'}
                className="min-h-24"
              />
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={!contribText.trim() || resolving}
                  onClick={resolveContribution}
                >
                  {resolving ? (
                    <>
                      <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground" /> Resolving…
                    </>
                  ) : (
                    <>
                      <BookOpen className="size-4" /> Try a PubChem lookup
                    </>
                  )}
                </Button>
                {enriched && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    <span className="font-medium text-foreground">{enriched.name}</span>
                    {enriched.molecularFormula && <span className="font-mono">{enriched.molecularFormula}</span>}
                    {enriched.molecularWeight && (
                      <span className="text-muted-foreground">{enriched.molecularWeight.toFixed(1)} g/mol</span>
                    )}
                    <span className="text-muted-foreground">via PubChem</span>
                  </div>
                )}
                {resolveFailed && (
                  <p className="text-xs text-amber-500">
                    No PubChem match — we&apos;ll still queue your request for manual curation.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button onClick={saveContribution} disabled={!contribText.trim()}>
                  <Send className="size-4" /> Queue request
                </Button>
              </DialogFooter>
            </>
          )}
          <DialogClose asChild>
            <Button variant="ghost" className="absolute right-4 top-4 size-8">
              <X className="size-4" />
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  )
}
