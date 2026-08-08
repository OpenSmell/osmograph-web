"use client"

import * as React from "react"
import {
  Download,
  FlaskConical,
  FolderOpen,
  GitCompareArrows,
  Library,
  MonitorDown,
  Plus,
  Sparkles,
  UploadCloud,
  Wind,
  X,
} from "lucide-react"
import { SessionProvider, useSessions } from "@/components/suite/session-context"
import { LibraryView } from "@/components/suite/library-view"
import { ImportView } from "@/components/suite/import-view"
import { CompareView } from "@/components/suite/compare-view"
import { TrainView } from "@/components/suite/train-view"
import { SmellabilityView } from "@/components/suite/smellability-view"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import ThemeToggle from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { DESKTOP_APP_URL } from "@/lib/constants"

type View = "library" | "import" | "compare" | "train" | "smellability"

const NAV: { id: View; label: string; icon: React.ElementType; hint: string }[] = [
  { id: "library", label: "Library", icon: Library, hint: "All sessions, grouped by experiment" },
  { id: "smellability", label: "Smellability", icon: Wind, hint: "Is it detectable on your array?" },
  { id: "import", label: "Import", icon: UploadCloud, hint: "CSV / .osmell in, scored sessions out" },
  { id: "compare", label: "Compare", icon: GitCompareArrows, hint: "Overlay normalized responses" },
  { id: "train", label: "Train", icon: FlaskConical, hint: "Classifiers on labeled sessions" },
]

function DesktopAppBox() {
  const [open, setOpen] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    try {
      setDismissed(localStorage.getItem("osmell-desktop-cta-dismissed") === "1")
    } catch {
      /* storage unavailable — keep the CTA visible */
    }
    setLoaded(true)
  }, [])

  const dismiss = () => {
    setDismissed(true)
    setOpen(false)
    try {
      localStorage.setItem("osmell-desktop-cta-dismissed", "1")
    } catch {
      /* storage unavailable — this session only */
    }
  }

  if (!loaded || dismissed) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Get the desktop app"
        aria-label="Get the desktop app"
        className="fixed bottom-20 right-4 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition-colors hover:text-foreground md:bottom-6 md:right-6"
      >
        <Download className="size-5" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-20 right-4 z-40 w-72 max-w-[calc(100vw-2rem)] md:bottom-6 md:right-6">
      <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <MonitorDown className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">OpenSmell Desktop</span>
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Connect your E-Nose rig, record live sessions, and analyze offline — training and cross-sensitivity maps stay
          on your machine.
        </p>
        <Button asChild size="sm" className="mt-3 w-full gap-1.5">
          <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">
            <Download className="size-3.5" /> Get the desktop app
          </a>
        </Button>
      </div>
    </div>
  )
}

function Shell() {
  const [view, setView] = React.useState<View>("library")
  const [verdictPrefill, setVerdictPrefill] = React.useState<string | null>(null)
  const { sessions } = useSessions()

  const navigate = (next: View) => {
    setVerdictPrefill(null)
    setView(next)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="hex-icon text-foreground" />
            <span className="text-sm font-semibold tracking-tight">OpenSmell</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">mox</span>
            <Badge variant="secondary" className="ml-2 hidden sm:inline-flex">
              <Sparkles className="size-3" /> beta
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5" />
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 flex-col gap-1 border-r border-border/60 p-4 md:flex">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors",
                  view === item.id
                    ? "border-border bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4" /> {item.label}
                </span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </button>
            )
          })}
          <div className="mt-auto flex flex-col gap-2 border-t border-border/60 pt-4">
            <Button
              size="sm"
              className="w-full"
              onClick={() => navigate("import")}
            >
              <Plus className="size-4" /> New import
            </Button>
          </div>
        </aside>

        {/* Mobile nav */}
        <div className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-background/90 backdrop-blur md:hidden">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]",
                  view === item.id ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </button>
            )
          })}
        </div>

        <main className="min-w-0 flex-1 px-6 py-8 pb-24 md:pb-8">
          {view === "library" && (
            <LibraryView
              onImport={() => navigate("import")}
              onVerdict={(label) => {
                setVerdictPrefill(label)
                setView("smellability")
              }}
            />
          )}
          {view === "import" && <ImportView />}
          {view === "compare" && <CompareView />}
          {view === "train" && <TrainView />}
          {view === "smellability" && <SmellabilityView sessions={sessions} prefill={verdictPrefill} />}
        </main>
      </div>

      <DesktopAppBox />
    </div>
  )
}

export function SuiteShell() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  )
}
