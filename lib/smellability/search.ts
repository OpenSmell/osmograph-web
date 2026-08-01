import { COMPOUNDS } from "./compounds"
import { COMPOSITES } from "./composites"
import { CLASS_TERMS } from "./constants"
import { readUserDictionary } from "./user-dictionary"
import type { ResolvedEntity, SearchCandidate } from "./types"

export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim()
}

function norm(s: string): string {
  return s.toLowerCase().trim()
}

function scoreField(field: string, query: string): number {
  const f = norm(field)
  if (f === query) return 100
  if (f.startsWith(query) && query.length >= 2) return 75
  if (f.includes(query) && query.length >= 2) return 55
  const tokens = query.split(" ")
  if (tokens.length > 1 && tokens.every((t) => f.includes(t))) return 65
  return 0
}

function scoreChemical(c: (typeof COMPOUNDS)[number], query: string): number {
  let best = scoreField(c.name, query)
  for (const s of c.synonyms) best = Math.max(best, scoreField(s, query))
  if (c.cas && norm(c.cas) === query) best = Math.max(best, 95)
  if (c.smiles && norm(c.smiles) === query) best = Math.max(best, 90)
  return best
}

function scoreComposite(c: (typeof COMPOSITES)[number], query: string): number {
  let best = scoreField(c.name, query)
  for (const s of c.synonyms) best = Math.max(best, scoreField(s, query))
  return best
}

export function searchSubstances(query: string, limit = 8): SearchCandidate[] {
  const q = normalizeQuery(query)
  if (q.length < 1) return []

  const results: SearchCandidate[] = []

  for (const c of COMPOUNDS) {
    const score = scoreChemical(c, q)
    if (score >= 40) {
      results.push({
        kind: "chemical",
        id: c.id,
        name: c.name,
        displayName: c.name,
        matchHint: c.cas ? `chemical · CAS ${c.cas}` : "chemical",
        score,
      })
    }
  }

  // User-resolved compounds join the search surface, clearly marked provisional.
  for (const c of readUserDictionary()) {
    const score = scoreChemical(c, q)
    if (score >= 40) {
      results.push({
        kind: "chemical",
        id: c.id,
        name: c.name,
        displayName: c.name,
        matchHint: "my dictionary · estimated",
        score: score - 5,
      })
    }
  }

  for (const c of COMPOSITES) {
    const score = scoreComposite(c, q)
    if (score >= 40) {
      results.push({
        kind: "composite",
        id: c.id,
        name: c.name,
        displayName: c.name,
        matchHint: `${c.kind} · mixture profile`,
        score,
      })
    }
  }

  for (const key of Object.keys(CLASS_TERMS)) {
    const term = CLASS_TERMS[key]
    const score = scoreField(term.label, q) || scoreField(key, q)
    if (score >= 40) {
      results.push({
        kind: "class",
        id: `class:${key}`,
        name: key,
        displayName: term.label,
        matchHint: "functional class",
        score,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

export function exactResolve(query: string): ResolvedEntity | null {
  const q = normalizeQuery(query)
  if (q.length < 1) return null
  const candidates = searchSubstances(query, 1)
  if (candidates.length === 0) return null
  const top = candidates[0]
  if (top.score >= 100) {
    return { kind: top.kind, id: top.id, name: top.name, displayName: top.displayName, matchHint: top.matchHint }
  }
  return null
}
