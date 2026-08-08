import { COMPOUNDS, COMPOUND_BY_ID } from "./compounds"
import { COMPOSITES } from "./composites"
import { CLASS_TERMS } from "./constants"
import { isLikelySmiles, registerStructure, structureToChemical } from "./smiles"
import { readUserDictionary } from "./user-dictionary"
import type { Composite, ResolvedEntity, SearchCandidate } from "./types"

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
  // Substring matches must start at a word boundary so short queries don't
  // match inside unrelated words (e.g. "gold" must not match "marigold").
  const idx = f.indexOf(query)
  if (idx >= 0 && query.length >= 2 && (idx === 0 || f[idx - 1] === " ")) return 55
  const tokens = query.split(" ")
  if (tokens.length > 1 && tokens.every((t) => f.split(" ").includes(t))) return 65
  return 0
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

// A did-you-mean fallback only fires for unambiguous single-edit misspellings.
// Distance-2 tolerance pulled in unrelated names sharing a suffix/prefix
// (e.g. "curium" → "curcuma"/"curing", "cesium" → "helium", "copper" → "pepper"),
// and no structural rule could separate those from genuine two-edit typos.
const MAX_FUZZY_DISTANCE = 1

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

// Reverse lookup: typing a constituent (e.g. "citral", "skatole") surfaces the
// mixtures that contain it, so users can plan by the volatiles they care about.
// Exact constituent names get a strong but not top score; prefix matches are
// weaker to avoid crowding exact chemical hits with "ethanol is in everything".
function constituentLookup(
  c: Composite,
  query: string,
): { score: number; hit: string } | null {
  for (const k of c.constituents) {
    const chem = COMPOUND_BY_ID.get(k.chemicalId)
    if (!chem) continue
    for (const name of [chem.name, ...chem.synonyms]) {
      const n = norm(name)
      if (n === query) return { score: 65, hit: chem.name }
      if (query.length >= 4 && n.startsWith(query)) return { score: 45, hit: chem.name }
    }
  }
  return null
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

  const compositeIds = new Set<string>()
  for (const c of COMPOSITES) {
    const score = scoreComposite(c, q)
    if (score >= 40) {
      compositeIds.add(c.id)
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

  // Constituent reverse-lookup (see constituentLookup above).
  for (const c of COMPOSITES) {
    if (compositeIds.has(c.id)) continue
    const hit = constituentLookup(c, q)
    if (hit) {
      results.push({
        kind: "composite",
        id: c.id,
        name: c.name,
        displayName: c.name,
        matchHint: `contains ${hit.hit}`,
        score: hit.score,
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

  // Zero exact/partial matches: offer a did-you-mean fallback for near
  // misspellings (edit distance within the scaled tolerance).
  if (results.length === 0 && q.length >= 4) {
    const seen = new Set<string>()
    const offer = (
      entityId: string,
      displayName: string,
      kind: SearchCandidate["kind"],
      field: string,
      hint: string,
    ) => {
      const d = levenshtein(norm(field), q)
      if (d <= MAX_FUZZY_DISTANCE) {
        const key = `${kind}:${entityId}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ kind, id: entityId, name: field, displayName, matchHint: hint, score: 35 })
        }
      }
    }
    for (const c of COMPOUNDS) {
      offer(c.id, c.name, "chemical", c.name, `did you mean “${c.name}”?`)
      for (const s of c.synonyms) offer(c.id, c.name, "chemical", s, `did you mean “${c.name}”?`)
    }
    for (const c of COMPOSITES) {
      offer(c.id, c.name, "composite", c.name, `did you mean “${c.name}”?`)
      for (const s of c.synonyms) offer(c.id, c.name, "composite", s, `did you mean “${c.name}”?`)
    }
    for (const key of Object.keys(CLASS_TERMS)) {
      offer(`class:${key}`, CLASS_TERMS[key].label, "class", CLASS_TERMS[key].label, "did you mean this?")
    }
    results.sort((a, b) => b.score - a.score)
  }

  // A query that parses as a SMILES string is treated as a structure: parse it
  // into a first-principles Chemical (formula, MW, Joback boiling point, vapor
  // pressure) and register it so the chain can resolve it. Registered entries
  // are idempotent (hash-based ids), so repeated keystrokes don't accumulate.
  if (isLikelySmiles(q)) {
    const struct = structureToChemical(q)
    if (struct) {
      registerStructure(struct)
      results.push({
        kind: "chemical",
        id: struct.id,
        name: struct.name,
        displayName: struct.name,
        matchHint: "structure-parsed (SMILES) · estimated",
        score: 100,
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
