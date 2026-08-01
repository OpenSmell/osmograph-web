"use client"

import * as React from "react"
import { FlaskConical, Layers, Sparkles, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSessions } from "@/components/suite/session-context"

// Why a per-class minimum and not a flat total? With ~7 features per channel
// (relative amplitude, direction, rise/decay time, AUC, R0, dead) across an
// array, the feature vector is high-dimensional while a MOX response is
// dominated by a handful of variance sources (analyte chemistry, batch
// sensitivity ±20%, humidity). Fewer than 5 sessions per label cannot hold out
// one per class in cross-validation without the model having seen every sample
// of that label — so accuracy becomes uninterpretable. The gate is the minimum
// at which a cross-validated split is even meaningful; it is not a guarantee
// of a good model. Below it, training would fit drift, not chemistry.
const MIN_PER_CLASS = 5
const MIN_CLASSES = 2

export function TrainView() {
  const { sessions } = useSessions()
  const exposures = sessions.filter((s) => s.file.manifest.session.role === "exposure")
  const labeled = exposures.filter((s) => s.file.manifest.session.label)

  const perClass = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const s of labeled) {
      const label = s.file.manifest.session.label
      if (!label) continue
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [labeled])

  const classes = perClass.length
  const deficient = perClass.filter(([, n]) => n < MIN_PER_CLASS)
  const ready = classes >= MIN_CLASSES && deficient.length === 0

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
            <CardDescription>Sessions with a non-empty label.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{labeled.length}</p>
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
            <p className="text-sm text-muted-foreground">
              Training pipeline ships next: extract the 187-feature framework per
              session, split by label, fit the model, and report cross-validated
              accuracy. Coming in the next slice.
            </p>
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

function cnBar(n: number): string {
  return n >= MIN_PER_CLASS ? "h-full rounded-full bg-emerald-500/80" : "h-full rounded-full bg-amber-500/80"
}

function cnCount(n: number): string {
  return n >= MIN_PER_CLASS ? "text-xs tabular-nums text-emerald-500" : "text-xs tabular-nums text-amber-500"
}
