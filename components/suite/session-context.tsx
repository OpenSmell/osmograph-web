"use client"

import * as React from "react"
import type { OsmellFile, QualityReport, MoxFeatures } from "@/lib/osmell"

export interface SuiteSession {
  id: string
  fileName: string
  file: OsmellFile
  report: QualityReport
  features: MoxFeatures[] | null
  importedAt: number
}

interface SessionContextValue {
  sessions: SuiteSession[]
  addSession: (session: SuiteSession) => void
  removeSession: (id: string) => void
  clearSessions: () => void
  selectedIds: string[]
  toggleSelected: (id: string) => void
  clearSelected: () => void
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = React.useState<SuiteSession[]>([])
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])

  const addSession = React.useCallback((session: SuiteSession) => {
    setSessions((prev) => [session, ...prev])
  }, [])

  const removeSession = React.useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setSelectedIds((prev) => prev.filter((s) => s !== id))
  }, [])

  const clearSessions = React.useCallback(() => {
    setSessions([])
    setSelectedIds([])
  }, [])

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    )
  }, [])

  const clearSelected = React.useCallback(() => setSelectedIds([]), [])

  return (
    <SessionContext.Provider
      value={{
        sessions,
        addSession,
        removeSession,
        clearSessions,
        selectedIds,
        toggleSelected,
        clearSelected,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSessions(): SessionContextValue {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSessions must be used within SessionProvider")
  return ctx
}

export function makeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
