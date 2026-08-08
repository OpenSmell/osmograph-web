"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

declare global {
  interface Window {
    RDKit?: {
      get_mol: (smiles: string) => { get_svg: () => string; delete: () => void } | null
    }
    initRDKitModule?: (opts: { locateFile: (file: string) => string }) => Promise<Window["RDKit"]>
  }
}

// Renders a 2D structure from a SMILES string using the RDKit WASM build
// shipped in public/rdkit (copied from @rdkit/rdkit on postinstall). Loads the
// module lazily on first use and keeps the global instance for later renders.

export function StructureViewer({
  smiles,
  height = 200,
}: {
  smiles: string
  height?: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [status, setStatus] = React.useState<"loading" | "ready" | "unavailable" | "error">("loading")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const render = () => {
      if (cancelled || !ref.current || !window.RDKit) return
      try {
        const mol = window.RDKit.get_mol(smiles)
        if (!mol) {
          // RDKit rejected the string. The formula and estimated properties
          // come from our own parser, so degrade the 2D preview instead of
          // failing the whole card.
          setStatus("unavailable")
          setError(null)
          return
        }
        const svg = mol.get_svg()
        mol.delete()
        if (!svg || svg.length < 100) {
          setStatus("unavailable")
          setError(null)
          return
        }
        ref.current.innerHTML = svg
        const el = ref.current.querySelector("svg")
        if (el) {
          el.setAttribute("width", "100%")
          el.setAttribute("height", "100%")
          el.style.maxWidth = "100%"
          el.style.maxHeight = "100%"
        }
        setStatus("ready")
        setError(null)
      } catch (e: unknown) {
        setStatus("error")
        setError(e instanceof Error ? e.message : "Could not render the structure")
      }
    }

    if (window.RDKit) {
      render()
      return
    }

    const script = document.createElement("script")
    script.src = "/rdkit/RDKit_minimal.js"
    script.async = true
    script.onload = async () => {
      try {
        if (!window.initRDKitModule) throw new Error("RDKit module initialiser missing")
        const mod = await window.initRDKitModule({ locateFile: (f: string) => `/rdkit/${f}` })
        window.RDKit = mod
        render()
      } catch (e: unknown) {
        setStatus("error")
        setError(e instanceof Error ? e.message : "Failed to initialise the structure renderer")
      }
    }
    script.onerror = () => {
      setStatus("error")
      setError("Failed to load the structure renderer")
    }
    document.head.appendChild(script)

    return () => {
      cancelled = true
    }
  }, [smiles])

  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background"
      style={{ height }}
    >
      <div ref={ref} className="h-full w-full p-2" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Initialising structure renderer…
          </div>
        </div>
      )}
      {status === "unavailable" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <p className="max-w-[240px] text-center text-xs text-muted-foreground">
            2D structure preview unavailable for this SMILES — the formula and
            estimated properties below are still computed from it.
          </p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <p className="max-w-[240px] text-center text-xs text-muted-foreground">
            {error ?? "Could not render the structure"}
          </p>
        </div>
      )}
    </div>
  )
}
