"use client"

import * as React from "react"
import { FlaskConical, Layers, Sparkles, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSessions } from "@/components/suite/session-context"

export function TrainView() {
  const { sessions } = useSessions()
  const exposures = sessions.filter((s) => s.file.manifest.session.role === "exposure")
  const labeled = exposures.filter((s) => s.file.manifest.session.label)

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
          desktop.
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
            <p className="text-3xl font-semibold">
              {new Set(labeled.map((s) => s.file.manifest.session.label)).size}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> Readiness
            </CardTitle>
            <CardDescription>Minimum for a meaningful split.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-2">
            <p className="text-3xl font-semibold">
              {labeled.length >= 6 ? "Ready" : labeled.length + "/6"}
            </p>
          </CardContent>
        </Card>
      </div>

      {labeled.length < 6 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Label your sessions in the Library (via the manifest) or import more
            recordings. Training unlocks at 6+ labeled exposures.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Training pipeline ships next: extract the 187-feature framework per
            session, split by label, fit the model, and report cross-validated
            accuracy. Coming in the next slice.
          </p>
        </div>
      )}
    </div>
  )
}
