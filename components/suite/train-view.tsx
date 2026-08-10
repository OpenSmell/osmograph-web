"use client"

import * as React from "react"
import { FlaskConical, Layers, Loader2, Sparkles, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSessions, type SuiteSession } from "@/components/suite/session-context"
import {
  featuresFromMox,
  featureNames,
  trainCrossValidated,
  type TrainResult,
} from "@/lib/ml"
import type { MoxFeatures } from "@/lib/osmell/processors"

// Why a per-class minimum and not a flat total? With ~7 features per channel
// (relative amplitude, direction, rise/decay time, AUC, endpoint delta,
// saturation index) across an array, the feature vector is high-dimensional
// while a MOX response is dominated by a handful of variance sources (analyte
// chemistry, batch sensitivity ±20%, humidity). Fewer than 5 sessions per
// label cannot hold out one per class in cross-validation without the model
// having seen every sample of that label — so accuracy becomes uninterpretable.
// The gate is the minimum at which a cross-validated split is even meaningful;
// it is not a guarantee of a good model. Below it, training would fit drift,
// not chemistry.
const MIN_PER_CLASS = 5
const MIN_CLASSES = 2

export function TrainView() {
  const { sessions } = useSessions()
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<TrainResult | null>(null)

  const exposures = sessions.filter((s) => s.file.manifest.session.role === "exposure")
  const labeled = exposures.filter((s) => s.file.manifest.session.label)
  // Only sessions with extracted channel features are trainable. Imported
  // recordings carry them; anything else is excluded from the model.
  const trainable = labeled.filter(
    (s): s is SuiteSession & { features: MoxFeatures[] } =>
      Array.isArray(s.features) && s.features.length > 0,
  )
  const skipped = labeled.length - trainable.length

  const perClass = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const s of trainable) {
      const label = s.file.manifest.session.label
      if (!label) continue
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [trainable])

  const classes = perClass.length
  const deficient = perClass.filter(([, n]) => n < MIN_PER_CLASS)
  const ready = classes >= MIN_CLASSES && deficient.length === 0

  const runTraining = React.useCallback(async () => {
    if (!ready || running) return
    setRunning(true)
    // Let the spinner paint before the (fast) numeric work.
    await new Promise((r) => setTimeout(r, 30))
    try {
      const samples = trainable.map((s) => ({
        label: s.file.manifest.session.label as string,
        features: featuresFromMox(s.features),
      }))
      setResult(trainCrossValidated(samples, MIN_PER_CLASS))
    } finally {
      setRunning(false)
    }
  }, [ready, running, trainable])

  const featureCount = result?.nFeatures ?? featureNames(trainable[0]?.features.length ?? 0).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          <FlaskConical className="size-3" /> Train
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Train a classifier</h1>
        <p className="max-w-2xl text-muted-foreground">
          Build a model that recognizes odors from your labeled sessions — the web
          counterpart to the RandomForest / LogisticRegression trainers in Osmograph
          desktop. Readiness is gated per label, not by a raw session count: a model
          needs enough exposures per class that cross-validation can hold one out and
          still learn from the rest.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4" /> Labeled exposures
            </CardTitle>
            <CardDescription>Trainable sessions with channel features.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{trainable.length}</p>
            {skipped > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {skipped} labeled without features excluded
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4" /> Distinct labels
            </CardTitle>
            <CardDescription>Classes your model could learn.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{classes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> Readiness
            </CardTitle>
            <CardDescription>
              {MIN_PER_CLASS}+ per class, {MIN_CLASSES}+ classes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-2">
            <p className="text-3xl font-semibold">{ready ? "Ready" : "Not yet"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        {perClass.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sessions per label
            </p>
            <div className="flex flex-col gap-1.5">
              {perClass.map(([label, n]) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cnBar(n)}
                      style={{ width: `${Math.min(100, (n / MIN_PER_CLASS) * 100)}%` }}
                    />
                  </div>
                  <span className={cnCount(n)}>
                    {n}/{MIN_PER_CLASS}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Label your sessions in the Library (via the manifest) or import more
              recordings. Training unlocks at {MIN_PER_CLASS}+ labeled exposures per
              class across {MIN_CLASSES}+ classes.
            </p>
          </div>
        )}

        {!ready && perClass.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            {classes < MIN_CLASSES ? (
              <>You need at least {MIN_CLASSES} distinct labels — currently {classes}.</>
            ) : (
              <>
                {deficient.map(([label, n]) => `${label} (${n}/${MIN_PER_CLASS})`).join(", ")}{" "}
                {deficient.length > 1 ? "are" : "is"} below the {MIN_PER_CLASS}-per-class
                minimum. Below it, cross-validation cannot hold a sample out without the
                model having memorized that label, so reported accuracy would be noise.
              </>
            )}
          </div>
        )}

        {ready ? (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold">Logistic regression (cross-validated)</p>
                  <p className="text-xs text-muted-foreground">
                    Softmax on channel kinetic features ({featureCount} per session),
                    standardized within each fold; r0 excluded so the model stays
                    device-agnostic. Runs entirely in your browser.
                  </p>
                </div>
                <Button size="sm" onClick={runTraining} disabled={running}>
                  {running ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Fitting…
                    </>
                  ) : (
                    "Train classifier"
                  )}
                </Button>
              </div>

              {result ? (
                result.error ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {result.error}
                  </p>
                ) : (
                  <Results result={result} />
                )
              ) : (
                <p className="rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  Fit the model to see cross-validated accuracy and the per-class
                  breakdown. The model is not persisted — it is an evaluation of what
                  your labeled sessions can support.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Until the per-class minimum is met, training is intentionally blocked — a
            model fit on too few exposures per label would report confident accuracy
            while actually classifying drift and batch variation.
          </p>
        )}
      </div>
    </div>
  )
}

function Results({ result }: { result: TrainResult }) {
  const accPct = (result.cvAccuracy * 100).toFixed(1)
  const trainPct = (result.trainAccuracy * 100).toFixed(1)
  const basePct = (result.baseline * 100).toFixed(1)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Cross-validated accuracy" value={`${accPct}%`} sub={`${result.nSamples} sessions, ${result.folds} folds`} />
        <Metric label="Training accuracy" value={`${trainPct}%`} sub="fit on all sessions" />
        <Metric label="Baseline (majority)" value={`${basePct}%`} sub="accuracy of predicting the most common label" />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Per-class ({result.nFeatures} features)
        </p>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 text-right font-medium">Sessions</th>
                <th className="px-3 py-2 text-right font-medium">Correct</th>
                <th className="px-3 py-2 text-right font-medium">Precision</th>
                <th className="px-3 py-2 text-right font-medium">Recall</th>
              </tr>
            </thead>
            <tbody>
              {result.classes.map((c) => {
                const r = result.perClass[c]
                return (
                  <tr key={c} className="border-b border-border/40 last:border-b-0">
                    <td className="px-3 py-1.5 font-medium">{c}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.n}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.correct}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.precision)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.recall)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {result.classes.length <= 8 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Confusion (rows true, columns predicted)
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium" />
                  {result.classes.map((c) => (
                    <th key={c} className="px-2 py-2 text-right font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.classes.map((truth, ti) => (
                  <tr key={truth} className="border-b border-border/40 last:border-b-0">
                    <td className="px-3 py-1.5 font-medium">{truth}</td>
                    {result.confusion[ti].map((v, pi) => (
                      <td
                        key={pi}
                        className={`px-2 py-1.5 text-right tabular-nums ${
                          pi === ti ? "text-emerald-500" : "text-rose-500/80"
                        }`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function fmt(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

function cnBar(n: number): string {
  return n >= MIN_PER_CLASS ? "h-full rounded-full bg-emerald-500/80" : "h-full rounded-full bg-amber-500/80"
}

function cnCount(n: number): string {
  return n >= MIN_PER_CLASS ? "text-xs tabular-nums text-emerald-500" : "text-xs tabular-nums text-amber-500"
}
