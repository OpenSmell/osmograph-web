"use client"

import { Atom, FlaskConical } from "lucide-react"
import type { Chemical } from "@/lib/smellability"
import { StructureViewer } from "./structure-viewer"

function fmtPa(pa: number | null): string {
  if (pa == null) return "unknown"
  if (pa >= 100000) return `${(pa / 1000).toFixed(0)} kPa`
  if (pa >= 1000) return `${(pa / 1000).toFixed(2)} kPa`
  return `${pa.toFixed(0)} Pa`
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-foreground">{value}</span>
      {note && <span className="sr-only">{note}</span>}
    </div>
  )
}

// A parsed structure record (provenance === "structure"): the molecule the user
// pasted, with every derived property flagged estimated and its method named.
export function StructureCard({ chemical }: { chemical: Chemical }) {
  const mw = chemical.props.molecularWeight.value
  const bp = chemical.props.boilingPoint.value
  const vp = chemical.props.vaporPressure25.value
  const groups = chemical.props.functionalGroups

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Atom className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Structure-parsed (SMILES)
        </span>
      </div>
      <div className="p-4">
        <StructureViewer smiles={chemical.smiles ?? ""} height={190} />
        <div className="mt-3 flex flex-col gap-2">
          <Row label="Formula" value={chemical.name.replace(/ \(structure\)$/, "")} />
          <Row label="Molecular weight" value={mw != null ? `${mw.toFixed(1)} g/mol` : "unknown"} />
          <Row label="Boiling point (Joback)" value={bp != null ? `${bp.toFixed(1)} °C` : "unknown"} />
          <Row label="Vapor pressure @ 25 °C" value={fmtPa(vp)} />
          {groups.length > 0 && <Row label="Functional groups" value={groups.join(", ")} />}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Counted atom-by-atom from the SMILES you entered. Boiling point estimated by Joback group contribution
            (1987); vapor pressure via Clausius–Clapeyron + Trouton&apos;s rule. Estimates, not measurements — amber dots
            throughout the chain reflect that.
          </p>
        </div>
      </div>
    </div>
  )
}
