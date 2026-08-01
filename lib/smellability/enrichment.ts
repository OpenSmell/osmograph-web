export interface EnrichedChemical {
  name: string
  molecularFormula?: string
  molecularWeight?: number
  iupacName?: string
  smiles?: string
  source: "pubchem"
  fetchedAt: string
}

const PUB_PROPERTIES = "MolecularFormula,MolecularWeight,IUPACName,IsomericSMILES"
const CACHE_KEY = "osmell-pubchem-cache"
const CACHE_MAX = 200
const MIN_INTERVAL_MS = 300

let lastRequestAt = 0

function readCache(): Record<string, EnrichedChemical> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, EnrichedChemical>
  } catch {
    return {}
  }
}

function writeCache(c: Record<string, EnrichedChemical>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* storage full or unavailable — fail silently */
  }
}

function throttle() {
  const now = Date.now()
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now)
  if (wait > 0) {
    lastRequestAt = now + wait
    return new Promise<void>((resolve) => setTimeout(resolve, wait))
  }
  lastRequestAt = now
  return Promise.resolve()
}

export async function lookupPubChem(query: string): Promise<EnrichedChemical | null> {
  const q = query.trim()
  if (q.length < 2) return null

  const cache = readCache()
  const key = q.toLowerCase()
  if (cache[key]) return cache[key]

  await throttle()

  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/${PUB_PROPERTIES}/JSON`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { PropertyTable?: { Properties?: Record<string, unknown>[] } }
    const p = json?.PropertyTable?.Properties?.[0]
    if (!p) return null

    const result: EnrichedChemical = {
      name: (p.IUPACName as string | undefined) ?? q,
      molecularFormula: p.MolecularFormula as string | undefined,
      molecularWeight: p.MolecularWeight != null ? Number(p.MolecularWeight) : undefined,
      iupacName: p.IUPACName as string | undefined,
      smiles: (p.SMILES as string | undefined) ?? (p.IsomericSMILES as string | undefined),
      source: "pubchem",
      fetchedAt: new Date().toISOString(),
    }

    const next: Record<string, EnrichedChemical> = { ...cache, [key]: result }
    const keys = Object.keys(next)
    if (keys.length > CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete next[k]
    }
    writeCache(next)
    return result
  } catch {
    return null
  }
}

export interface EnrichedBoilingPoint {
  valueC: number
  source: "measured"
  note: string
}

const BP_TIMEOUT_MS = 8000

export function parseBoilingPoint(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  // pug_view often reports "281.6±35.0 °C" — the value before the ± range is
  // the reported boiling point, not the uncertainty.
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:±[^°\d]*\d+(?:\.\d+)?)?\s*°?\s*C/i)
  if (m) return Number(m[1])
  return null
}

export async function lookupPubChemBoilingPoint(query: string): Promise<EnrichedBoilingPoint | null> {
  const q = query.trim()
  if (q.length < 2) return null

  // pug_view requires a CID, not a name — resolve it via the fast property endpoint first.
  const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/CanonicalSMILES/JSON`
  await throttle()
  let cid: string | null = null
  try {
    const res = await fetch(propUrl)
    if (!res.ok) return null
    const json = (await res.json()) as { PropertyTable?: { Properties?: Record<string, unknown>[] } }
    const p = json?.PropertyTable?.Properties?.[0]
    cid = p?.CID != null ? String(p.CID) : null
  } catch {
    return null
  }
  if (!cid) return null

  await throttle()
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Boiling%20Point`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BP_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as {
      Record?: { Section?: unknown[] }
      Fault?: { Message?: string }
    }
    if (json.Fault || !json.Record) return null

    const valueC = extractBoilingPointC(json.Record.Section)
    if (valueC == null) return null
    return { valueC, source: "measured", note: "PubChem experimental property" }
  } catch {
    return null
  }
}

export function extractBoilingPointC(sections: unknown[] | undefined): number | null {
  const hits: number[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>
      const heading = obj.TOCHeading
      if (heading === "Boiling Point") {
        const found = extractValues(obj)
        hits.push(...found)
      }
      for (const key of Object.keys(obj)) {
        if (key === "TOCHeading") continue
        walk(obj[key])
      }
    }
  }
  walk(sections)

  // Prefer the first numeric °C value; several records list duplicates of the same number.
  for (const h of hits) {
    if (h != null && h > -200 && h < 600) return h
  }
  return null
}

function extractValues(node: Record<string, unknown>): number[] {
  const out: number[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const item of n) walk(item)
      return
    }
    if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>
      const value = obj.Value
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const v = value as Record<string, unknown>
        const swm = v.StringWithMarkup
        if (Array.isArray(swm)) {
          for (const el of swm) {
            const parsed = parseBoilingPoint((el as Record<string, unknown>)?.String)
            if (parsed != null) out.push(parsed)
          }
          return
        }
        const num = v.Number
        if (Array.isArray(num)) {
          for (const el of num) {
            const parsed = typeof el === "number" ? el : parseBoilingPoint(String(el))
            if (parsed != null) out.push(parsed)
          }
          return
        }
        if (typeof v.String === "string") {
          const parsed = parseBoilingPoint(v.String)
          if (parsed != null) out.push(parsed)
          return
        }
      }
      if (typeof obj.StringWithMarkup === "string") {
        const parsed = parseBoilingPoint(obj.StringWithMarkup)
        if (parsed != null) out.push(parsed)
        return
      }
      for (const key of Object.keys(obj)) walk(obj[key])
    }
  }
  walk(node)
  return out
}
