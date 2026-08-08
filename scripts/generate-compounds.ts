// Generates lib/smellability/compounds-generated.ts — the machine-sourced
// extension of the curated compound dictionary.
//
// Nothing in the output is hand-typed. For every pinned name in cids.json the
// script:
//   1. resolves the name to a PubChem CID,
//   2. fetches authoritative properties (MW, SMILES, IUPAC name, formula),
//   3. fetches the experimental boiling point via pug_view,
//   4. merges odor descriptors + sources from opensmell-web/public/odor_search_index.json,
//   5. infers functional groups structurally from the SMILES,
//   6. back-computes vapour pressure via Clausius-Clapeyron + Trouton (flagged estimated),
//   7. emits a Chemical record whose sourceRefs trace every value to its source.
//
// The file is deterministic (sorted by CID) and reproducible: regenerating it
// from the same cids.json yields the same records for a given PubChem snapshot.
// Updating the dataset = editing cids.json + rerunning this + committing the
// regenerated file — the commit is a provenance snapshot, not hand-curation.
//
// Run: node --experimental-strip-types scripts/generate-compounds.ts

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { inferFunctionalGroups } from "../lib/smellability/groups.ts"
import { extractBoilingPointC } from "../lib/smellability/enrichment.ts"

// Clausius-Clapeyron from the normal boiling point with Trouton's-rule
// ΔH_vap — the same estimator as lib/smellability/provisional.ts
// (estimateVaporPressureFromBoilingPoint), inlined here so the generator has
// no import from modules that use extensionless bundler-style imports.
function estimateVaporPressureFromBoilingPoint(boilC: number): number {
  const R = 8.314
  const tBoilK = boilC + 273.15
  const deltaHVap = 88 * tBoilK
  return 101325 * Math.exp(-(deltaHVap / R) * (1 / 298.15 - 1 / tBoilK))
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_FILE = join(__dirname, "..", "lib", "smellability", "compounds-generated.ts")
const CACHE_FILE = join(__dirname, ".pubchem-cache.json")
const INDEX_FILE = join(__dirname, "..", "..", "opensmell-web", "public", "odor_search_index.json")

interface OdorEntry {
  cid: number
  name: string
  smiles: string
  descriptors: string[]
  sources: string[]
}

const PROPERTIES = "MolecularFormula,MolecularWeight,ConnectivitySMILES,IsomericSMILES,IUPACName"
const BP_TIMEOUT_MS = 12000
const CONCURRENCY = 4

let odorByCid = new Map<number, OdorEntry>()

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface Fetched {
  name: string
  cid: number
  iupacName?: string
  smiles?: string
  formula?: string
  molecularWeight?: number
  boilingPointC?: number
  bpNote?: string
  descriptors: string[]
  sources: string[]
  fetchedAt: string
}

async function fetchCompound(pinnedName: string): Promise<Fetched> {
  const fetchedAt = new Date().toISOString()
  const name = pinnedName.trim()

  const propJson = (await fetchJson(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/${PROPERTIES}/JSON`,
    15000,
  )) as { PropertyTable?: { Properties?: Record<string, unknown>[] } } | null
  const p = propJson?.PropertyTable?.Properties?.[0]

  let cid: number | null = p?.CID != null ? Number(p.CID) : null
  let smiles =
    (p?.SMILES as string | undefined) ??
    (p?.ConnectivitySMILES as string | undefined) ??
    (p?.CanonicalSMILES as string | undefined) ??
    (p?.IsomericSMILES as string | undefined)
  let iupac = p?.IUPACName as string | undefined

  if (!cid) {
    // Name resolution failed — try the cids endpoint as a fallback.
    const cidsJson = (await fetchJson(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`,
      15000,
    )) as { IdentifierList?: { CID?: number[] } } | null
    cid = cidsJson?.IdentifierList?.CID?.[0] ?? null
    if (cid) {
      const byCid = (await fetchJson(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/${PROPERTIES}/JSON`,
        15000,
      )) as { PropertyTable?: { Properties?: Record<string, unknown>[] } } | null
      const cp = byCid?.PropertyTable?.Properties?.[0]
      smiles =
        (cp?.SMILES as string | undefined) ??
        (cp?.ConnectivitySMILES as string | undefined) ??
        (cp?.CanonicalSMILES as string | undefined) ??
        (cp?.IsomericSMILES as string | undefined)
      iupac = cp?.IUPACName as string | undefined
    }
  }

  if (!cid) {
    throw new Error(`unresolved: ${name}`)
  }

  const formula = (p?.MolecularFormula as string | undefined) ?? undefined
  const molecularWeight = p?.MolecularWeight != null ? Number(p.MolecularWeight) : undefined

  let boilingPointC: number | undefined
  let bpNote = ""
  if (cid) {
    await sleep(200)
    const bpJson = (await fetchJson(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Boiling%20Point`,
      BP_TIMEOUT_MS,
    )) as { Record?: { Section?: unknown[] }; Fault?: { Message?: string } } | null
    if (bpJson && !bpJson.Fault && bpJson.Record) {
      const value = extractBoilingPointC(bpJson.Record.Section)
      if (value != null) {
        boilingPointC = value
        bpNote = "PubChem experimental (pug_view)"
      }
    }
  }

  const odor = odorByCid.get(cid)
  return {
    name,
    cid,
    iupacName: iupac,
    smiles,
    formula,
    molecularWeight,
    boilingPointC,
    bpNote,
    descriptors: odor?.descriptors ?? [],
    sources: odor?.sources ?? [],
    fetchedAt,
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      try {
        results[idx] = await fn(items[idx])
      } catch (e) {
        results[idx] = e instanceof Error ? e : new Error(String(e))
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function buildChemical(f: Fetched) {
  const smiles = f.smiles
  const groups = smiles ? inferFunctionalGroups(smiles) : []
  const lower = f.name.toLowerCase()
  const inorganicInert =
    /^(n2|o2|co2|ar|he|ne|kr|xe|rn)$/.test(lower) ||
    /^(n|o2?|co2|argon|helium|neon|krypton|xenon|radon|nitrogen|oxygen|carbon dioxide)$/.test(lower)
  const reducingGas = /^(h2|co|h2s|nh3|hydrogen|hydrogen sulfide|carbon monoxide|ammonia)$/.test(lower)
  const oxidizingGas = /^(o3|cl2|no2|no|chlorine|ozone|nitrogen dioxide|nitrogen monoxide|nitric oxide)$/.test(lower)
  const bp = f.boilingPointC
  const gas = bp != null && bp < 25
  const vp = bp != null ? estimateVaporPressureFromBoilingPoint(bp) : null
  const sourceRefs = [`PubChem CID ${f.cid}`]
  if (bp != null) sourceRefs.push("PubChem pug_view (experimental boiling point)")
  for (const s of f.sources) sourceRefs.push(`odor: ${s}`)

  return {
    id: `gen-${f.cid}`,
    name: f.iupacName ?? f.name,
    synonyms: [f.name],
    pubchemCid: f.cid,
    smiles,
    props: {
      molecularWeight: {
        value: f.molecularWeight ?? null,
        source: f.molecularWeight != null ? ("measured" as const) : ("unknown" as const),
        note: f.molecularWeight != null ? "PubChem" : undefined,
      },
      boilingPoint: bp != null
        ? { value: bp, source: "measured" as const, note: f.bpNote }
        : { value: null, source: "unknown" as const },
      vaporPressure25: vp != null
        ? {
            value: vp,
            source: "estimated" as const,
            note: "Clausius-Clapeyron + Trouton from PubChem boiling point",
          }
        : { value: null, source: "unknown" as const },
      functionalGroups: groups,
      redoxActive: groups.length > 0 || reducingGas || oxidizingGas,
      nonRedox: inorganicInert ? true : undefined,
      oxidizing: oxidizingGas ? true : undefined,
      gas: gas ? true : undefined,
      odorDescriptor: f.descriptors.length ? f.descriptors.join(", ") : undefined,
    },
    sourceRefs,
  }
}

function tsLiteral(x: unknown, indent: string): string {
  if (x === undefined) return "undefined"
  if (x === null) return "null"
  if (typeof x === "number") return String(x)
  if (typeof x === "boolean") return String(x)
  if (typeof x === "string") return JSON.stringify(x)
  if (Array.isArray(x)) {
    if (x.length === 0) return "[]"
    const inner = x.map((v) => tsLiteral(v, indent + "  ")).join(", ")
    return `[\n${indent}  ${inner},\n${indent}]`
  }
  const keys = Object.keys(x as Record<string, unknown>)
  const lines = keys
    .map((k) => {
      const v = (x as Record<string, unknown>)[k]
      if (v === undefined) return null
      return `${indent}  ${JSON.stringify(k)}: ${tsLiteral(v, indent + "  ")},`
    })
    .filter((l): l is string => l !== null)
  return `{\n${lines.join("\n")}\n${indent}}`
}

function emitFile(compounds: ReturnType<typeof buildChemical>[], generatedAt: string): string {
  const header = `// AUTO-GENERATED — do not edit by hand.
// Regenerate: node --experimental-strip-types scripts/generate-compounds.ts
// Data sources: PubChem (CID ${compounds.length} compounds) + OpenSmell odor_search_index.
// Generated: ${generatedAt}
import type { Chemical } from "./types"

export const GENERATED_AT = ${JSON.stringify(generatedAt)}

export const GENERATED_COMPOUNDS: Chemical[] = [
`
  const body = compounds.map((c, i) => {
    const text = tsLiteral(c, "  ")
    return `${i === 0 ? "" : "\n"}  ${text},`
  })
  return header + body.join("") + "\n]\n"
}

async function main() {
  const pinned = JSON.parse(readFileSync(join(__dirname, "cids.json"), "utf8")) as { names: string[] }

  if (existsSync(INDEX_FILE)) {
    const index = JSON.parse(readFileSync(INDEX_FILE, "utf8")) as OdorEntry[]
    odorByCid = new Map(index.map((e) => [e.cid, e]))
    console.log(`odor index: ${index.length} entries`)
  } else {
    console.warn(`odor index not found at ${INDEX_FILE} — descriptors will be empty`)
  }

  const cache: Record<string, Fetched> = {}
  if (existsSync(CACHE_FILE)) {
    Object.assign(cache, JSON.parse(readFileSync(CACHE_FILE, "utf8")))
    console.log(`cache: ${Object.keys(cache).length} entries`)
  }

  const pending = pinned.names.filter((n) => !cache[n])
  console.log(`pinned: ${pinned.names.length}, pending fetch: ${pending.length}`)

  const results = await mapPool(pending, CONCURRENCY, async (name) => {
    try {
      return await fetchCompound(name)
    } catch (e) {
      console.error(`FAIL ${name}: ${(e as Error).message}`)
      return null
    }
  })

  let failed = 0
  results.forEach((r, i) => {
    if (r && !(r instanceof Error)) {
      cache[pending[i]] = r
    } else {
      failed++
    }
  })
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))

  const compounds = Object.values(cache)
    .filter((f) => f.cid && f.smiles)
    .sort((a, b) => a.cid - b.cid)
    .map((f) => buildChemical(f))

  const withBp = compounds.filter((c) => c.props.boilingPoint.value != null).length
  console.log(
    `compounds written: ${compounds.length} (${withBp} with boiling point, ${compounds.length - withBp} without), failed: ${failed}`,
  )

  writeFileSync(OUT_FILE, emitFile(compounds, new Date().toISOString()))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
