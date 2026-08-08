// First-principles structure pipeline: parse a SMILES string into a molecular
// formula and weight, estimate the normal boiling point by Joback group
// contribution (Joback & Reid 1987), and build a Chemical that runs through the
// same feasibility chain as a curated dictionary record.
//
// Everything here is deterministic and local — no dictionary hit, no network.
// Every derived property is flagged `estimated`; the chain and confidence layer
// surface that honestly.

import { scanSmiles, inferFunctionalGroups } from "./groups"
import { estimateVaporPressureFromBoilingPoint } from "./provisional"
import type { Chemical } from "./types"

const ATOMIC_WEIGHT: Record<string, number> = {
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, K: 39.098, Ca: 40.078, Fe: 55.845, Co: 58.933, Ni: 58.693,
  Cu: 63.546, Zn: 65.38, Br: 79.904, Se: 78.971, Ag: 107.87, Sn: 118.71,
  I: 126.9, Ba: 137.33, Hg: 200.59, Pb: 207.2,
}

const ISOTOPE_MASS: Record<string, number> = {
  "2": 2.014, "13": 13.003, "15": 15.000, "18": 17.999, "31": 30.974,
}

const VALENCE: Record<string, number> = {
  C: 4, N: 3, O: 2, S: 2, P: 3, B: 3, Si: 4, Se: 2, F: 1, Cl: 1, Br: 1, I: 1,
}

const METAL_OR_INERT = new Set([
  "Na", "K", "Mg", "Ca", "Li", "Fe", "Co", "Ni", "Cu", "Zn", "Ag", "Sn",
  "Ba", "Hg", "Mn", "Cr", "Ti", "Sr", "Rb", "Cs", "Cd", "Pb", "Au", "Pt",
])

export interface ParsedAtom {
  element: string
  aromatic: boolean
  charge: number
  explicitH: number
  isotope: string
  bonds: { to: number; order: 1 | 2 | 3 }[]
  implicitH: number
  inRing: boolean
}

export interface ParsedSmiles {
  smiles: string
  atoms: ParsedAtom[]
  formula: string
  mw: number
  counts: Record<string, number>
}

// ---- bracket atom parsing ----------------------------------------------

function parseBracket(inner: string): { element: string; aromatic: boolean; h: number; charge: number; isotope: string } | null {
  let rest = inner.replace(/@/g, "")
  let isotope = ""
  let m = rest.match(/^\d+/)
  if (m) {
    isotope = m[0]
    rest = rest.slice(m[0].length)
  }
  if (!/[A-Za-z]/.test(rest[0] ?? "")) return null

  let element: string
  let aromatic = false
  const c0 = rest[0]
  if (/[a-z]/.test(c0)) {
    if (rest.startsWith("se")) {
      element = "Se"
      rest = rest.slice(2)
    } else {
      element = c0.toUpperCase()
      rest = rest.slice(1)
    }
    aromatic = true
  } else {
    element = c0
    rest = rest.slice(1)
    if (rest[0] && /[a-z]/.test(rest[0])) {
      element += rest[0]
      rest = rest.slice(1)
    }
  }

  let h = 0
  m = rest.match(/^H(\d*)/)
  if (m) {
    h = m[1] ? parseInt(m[1], 10) : 1
    rest = rest.slice(m[0].length)
  }

  let charge = 0
  if (rest) {
    m = rest.match(/^([+-])(\d*)/)
    if (m) {
      charge = (m[1] === "-" ? -1 : 1) * (m[2] ? parseInt(m[2], 10) : 1)
      rest = rest.slice(m[0].length)
    } else {
      const pm = rest.match(/^(\++|-+)/)
      if (pm) {
        charge = pm[0][0] === "+" ? pm[0].length : -pm[0].length
        rest = rest.slice(pm[0].length)
      }
    }
  }
  if (rest) return null
  return { element, aromatic, h, charge, isotope }
}

// ---- formula / implicit hydrogen ----------------------------------------

function valenceFor(element: string, charge: number): number {
  if (charge !== 0) {
    if (element === "N") return charge > 0 ? 4 : 3
    if (element === "O") return charge < 0 ? 1 : 2
    if (element === "S") return charge < 0 ? 1 : charge > 0 ? 3 : 2
    if (element === "C") return charge > 0 ? 3 : 4
    if (["F", "Cl", "Br", "I"].includes(element)) return charge < 0 ? 0 : 1
  }
  return VALENCE[element] ?? 0
}

function hillFormula(counts: Record<string, number>, hydrogens: number): string {
  const parts: string[] = []
  const order = (el: string) => (el === "C" ? 0 : el === "H" ? 1 : 2)
  const sorted = Object.keys(counts).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  for (const el of sorted) {
    const n = counts[el]
    parts.push(n === 1 ? el : `${el}${n}`)
  }
  if (hydrogens > 0 && !counts.H) {
    if (parts.length === 0 || parts[0].startsWith("C")) {
      parts.splice(counts.C ? 1 : 0, 0, hydrogens === 1 ? "H" : `H${hydrogens}`)
    } else {
      parts.unshift(hydrogens === 1 ? "H" : `H${hydrogens}`)
    }
  }
  return parts.join("")
}

// ---- ring membership via cycle detection --------------------------------

function ringAtomsOf(atomCount: number, edges: { u: number; v: number }[]): Set<number> {
  const ring = new Set<number>()
  const adj = Array.from({ length: atomCount }, () => new Map<number, number>())
  for (let e = 0; e < edges.length; e++) {
    adj[edges[e].u].set(edges[e].v, e)
    adj[edges[e].v].set(edges[e].u, e)
  }
  for (let e = 0; e < edges.length; e++) {
    const { u, v } = edges[e]
    // Shortest path from u to v avoiding this edge.
    const prev = new Map<number, number>()
    const queue: number[] = [u]
    const seen = new Set<number>([u])
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur === v) break
      for (const [nxt, eid] of adj[cur]) {
        if (eid === e) continue
        if (!seen.has(nxt)) {
          seen.add(nxt)
          prev.set(nxt, cur)
          queue.push(nxt)
        }
      }
    }
    if (!seen.has(v)) continue
    let cur: number | undefined = v
    while (cur !== undefined) {
      ring.add(cur)
      if (cur === u) break
      cur = prev.get(cur)
    }
  }
  return ring
}

// ---- Joback group contribution (Tb) -------------------------------------

const JOBAK_TB: Record<string, number> = {
  "CH3": 23.58, "CH2": 22.88, "CH": 21.74, "C": 18.25,
  "=CH2": 18.18, "=CH": 24.96, "=C<": 24.14, "=C=": 26.15,
  "≡CH": 9.2, "≡C−": 27.38,
  "ring CH2": 27.15, "ring CH": 21.78, "ring C": 21.32,
  "ring =CH−": 26.73, "ring =C<": 31.01,
  "ring −S−": 52.1, "ring −NH−": 58.53, "ring −N=": 57.55, "ring −O−": 31.22,
  "−OH": 92.88, "−O−": 22.42, "−CH=O": 61.2, "−C(=O)−": 76.75,
  "−COOH": 169.09, "−COO−": 81.1, "−NH2": 73.23, "−NH−": 50.17, "−N<": 11.74,
  "−N=": 74.6, "−CN": 125.66, "−NO2": 152.54, "−SH": 63.56, "−S−": 68.78,
  "−SO2−": 141.46, "F": -0.03, "Cl": 38.13, "Br": 66.86, "I": 93.84,
}

function jobackGroups(atoms: ParsedAtom[]): string[] {
  const groups: string[] = []
  const used = new Set<number>()

  const singleBondsTo = (i: number) => atoms[i].bonds.filter((b) => b.order === 1)
  const hasDoubleToO = (i: number) => atoms[i].bonds.some((b) => b.order === 2 && atoms[b.to].element === "O")

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    if (used.has(i)) continue
    const el = a.element

    if (el === "C") {
      const triple = a.bonds.filter((b) => b.order === 3)
      const doubles = a.bonds.filter((b) => b.order === 2)
      const nbrO = singleBondsTo(i).filter((b) => atoms[b.to].element === "O")

      if (triple.length > 0) {
        const isNitrile = triple.some((b) => atoms[b.to].element === "N")
        if (isNitrile) {
          groups.push("−CN")
          used.add(triple.find((b) => atoms[b.to].element === "N")!.to)
        } else {
          groups.push(a.implicitH >= 1 ? "≡CH" : "≡C−")
        }
        continue
      }
      if (doubles.length >= 2 && !hasDoubleToO(i)) {
        groups.push("=C=")
        continue
      }
      if (hasDoubleToO(i)) {
        // Carbonyl carbon.
        if (nbrO.length > 0) {
          const o = atoms[nbrO[0].to]
          const oDeg = o.bonds.length
          if (oDeg >= 2) {
            groups.push("−COO−")
          } else {
            groups.push("−COOH")
          }
          used.add(nbrO[0].to)
        } else {
          groups.push(a.implicitH >= 1 ? "−CH=O" : "−C(=O)−")
        }
        continue
      }
      if (doubles.length === 1) {
        if (a.inRing) groups.push(a.implicitH >= 1 ? "ring =CH−" : "ring =C<")
        else groups.push(a.implicitH >= 2 ? "=CH2" : a.implicitH >= 1 ? "=CH" : "=C<")
        continue
      }
      if (a.aromatic) {
        // Lowercase aromatic notation (the form the curated dictionary uses):
        // map to Joback's aromatic ring groups rather than aliphatic ones.
        groups.push(a.implicitH >= 1 ? "ring =CH−" : "ring =C<")
        continue
      }
      if (a.inRing) {
        groups.push(a.implicitH >= 2 ? "ring CH2" : a.implicitH >= 1 ? "ring CH" : "ring C")
      } else {
        groups.push(a.implicitH >= 3 ? "CH3" : a.implicitH >= 2 ? "CH2" : a.implicitH >= 1 ? "CH" : "C")
      }
      continue
    }

    if (el === "N") {
      const doubleO = a.bonds.filter((b) => b.order === 2 && atoms[b.to].element === "O")
      const singleO = a.bonds.filter((b) => b.order === 1 && atoms[b.to].element === "O")
      if (doubleO.length >= 1 && singleO.length >= 1 && a.implicitH === 0) {
        groups.push("−NO2")
        for (const b of a.bonds) if (atoms[b.to].element === "O") used.add(b.to)
        continue
      }
      if (a.aromatic) {
        groups.push("ring −N=")
        continue
      }
      if (a.bonds.some((b) => b.order === 2)) {
        groups.push("−N=")
        continue
      }
      const deg = a.bonds.length
      if (a.inRing) groups.push(a.implicitH >= 1 ? "ring −NH−" : "−N<")
      else if (deg <= 1) groups.push("−NH2")
      else if (deg === 2) groups.push(a.implicitH >= 1 ? "−NH−" : "−N<")
      else groups.push("−N<")
      continue
    }

    if (el === "O") {
      if (a.aromatic) {
        groups.push("ring −O−")
        continue
      }
      if (used.has(i)) continue
      // A double-bonded oxygen is a carbonyl oxygen — its contribution is
      // already counted on the carbonyl carbon. Counting it again as −OH would
      // over-shoot every ketone/aldehyde/ester by ~93 K.
      if (a.bonds.some((b) => b.order === 2)) continue
      if (a.bonds.length === 1) groups.push("−OH")
      else if (a.bonds.length === 2) groups.push("−O−")
      continue
    }

    if (el === "S") {
      if (a.aromatic) {
        groups.push("ring −S−")
        continue
      }
      const doubleO = a.bonds.filter((b) => b.order === 2 && atoms[b.to].element === "O").length
      if (doubleO >= 2) {
        groups.push("−SO2−")
        for (const b of a.bonds) if (atoms[b.to].element === "O") used.add(b.to)
        continue
      }
      if (a.bonds.length === 1) groups.push("−SH")
      else groups.push("−S−")
      continue
    }

    if (["F", "Cl", "Br", "I"].includes(el)) {
      groups.push(el)
      continue
    }
  }
  return groups
}

// ---- public API ---------------------------------------------------------

export function parseSmiles(smiles: string): ParsedSmiles | null {
  const s = smiles.trim()
  if (!s) return null
  const scan = scanSmiles(s)
  if (scan.atoms.length === 0) return null

  const atoms: (ParsedAtom | null)[] = scan.atoms.map((n) => {
    let element: string
    let aromatic = n.aromatic
    let charge = 0
    let explicitH = -1
    let isotope = ""
    if (n.el.startsWith("[")) {
      const inner = n.el.slice(1, -1)
      const b = parseBracket(inner)
      if (!b) return null
      element = b.element
      aromatic = b.aromatic
      charge = b.charge
      explicitH = b.h
      isotope = b.isotope
    } else {
      element = n.el.length === 1 ? n.el.toUpperCase() : n.el
    }
    if (!ATOMIC_WEIGHT[element]) return null
    return {
      element,
      aromatic,
      charge,
      explicitH,
      isotope,
      bonds: n.edges.map((e) => ({ to: e.to, order: e.bond })),
      implicitH: 0,
      inRing: false,
    }
  })
  if (atoms.some((a) => a === null)) return null
  const parsedAtoms = atoms as ParsedAtom[]

  // Implicit hydrogens.
  for (let i = 0; i < parsedAtoms.length; i++) {
    const a = parsedAtoms[i]
    if (a.explicitH >= 0) {
      a.implicitH = a.explicitH
    } else if (METAL_OR_INERT.has(a.element) || a.element === "H") {
      a.implicitH = 0
    } else if (a.aromatic) {
      if (a.element === "C") {
        a.implicitH = Math.max(0, 3 - a.bonds.length)
      } else {
        a.implicitH = 0
      }
    } else {
      const used = a.bonds.reduce((s, b) => s + b.order, 0)
      a.implicitH = Math.max(0, valenceFor(a.element, a.charge) - used)
    }
  }

  // Ring membership.
  const edges: { u: number; v: number }[] = []
  const seenEdge = new Set<string>()
  for (let i = 0; i < parsedAtoms.length; i++) {
    for (const b of parsedAtoms[i].bonds) {
      const key = i < b.to ? `${i}:${b.to}` : `${b.to}:${i}`
      if (seenEdge.has(key)) continue
      seenEdge.add(key)
      edges.push({ u: i, v: b.to })
    }
  }
  const ring = ringAtomsOf(parsedAtoms.length, edges)
  for (let i = 0; i < parsedAtoms.length; i++) parsedAtoms[i].inRing = ring.has(i)

  // Counts.
  const counts: Record<string, number> = {}
  let hydrogens = 0
  let mw = 0
  for (const a of parsedAtoms) {
    if (a.element === "H") continue
    counts[a.element] = (counts[a.element] ?? 0) + 1
    hydrogens += a.implicitH
    const mass = ATOMIC_WEIGHT[a.element]
    const iso = ISOTOPE_MASS[a.isotope]
    mw += (iso ?? mass) + a.implicitH * ATOMIC_WEIGHT.H
  }
  if (hydrogens > 0) counts.H = hydrogens

  return {
    smiles: s,
    atoms: parsedAtoms,
    formula: hillFormula(counts, hydrogens),
    mw: Math.round(mw * 100) / 100,
    counts,
  }
}

export function estimateBoilingPointJoback(parsed: ParsedSmiles): { valueC: number; groups: string[] } | null {
  const groups = jobackGroups(parsed.atoms)
  let sum = 0
  for (const g of groups) {
    const v = JOBAK_TB[g]
    if (v == null) return null
    sum += v
  }
  const tbK = 198.2 + sum
  if (tbK <= 273.15) return null
  return { valueC: Math.round((tbK - 273.15) * 10) / 10, groups }
}

function hashString(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export function structureToChemical(smiles: string): Chemical | null {
  const parsed = parseSmiles(smiles)
  if (!parsed) return null
  const heavy = parsed.atoms.filter((a) => a.element !== "H").length
  if (heavy === 0) return null

  const id = `struct-${hashString(smiles)}`
  const groups = inferFunctionalGroups(smiles)
  const redoxActive = groups.length > 0
  const hasCarbon = parsed.atoms.some((a) => a.element === "C")
  const joback = estimateBoilingPointJoback(parsed)
  const vp = joback ? estimateVaporPressureFromBoilingPoint(joback.valueC) : null

  return {
    id,
    name: `${parsed.formula} (structure)`,
    synonyms: [smiles],
    smiles,
    provenance: "structure",
    props: {
      molecularWeight: {
        value: parsed.mw,
        source: "estimated",
        note: `Counted from the SMILES formula ${parsed.formula}`,
      },
      boilingPoint: joback
        ? { value: joback.valueC, source: "estimated", note: "Joback group contribution (1987)" }
        : { value: null, source: "unknown" },
      vaporPressure25: vp
        ? {
            value: vp,
            source: "estimated",
            note: "Clausius–Clapeyron + Trouton from the Joback boiling point",
          }
        : { value: null, source: "unknown" },
      functionalGroups: groups,
      redoxActive,
      nonRedox: !hasCarbon && !redoxActive ? true : undefined,
    },
    sourceRefs: [
      "Structure-parsed (SMILES): formula counted atom-by-atom; boiling point by Joback group contribution; vapor pressure by Clausius–Clapeyron + Trouton.",
    ],
  }
}

const structRegistry = new Map<string, Chemical>()

export function registerStructure(c: Chemical): void {
  structRegistry.set(c.id, c)
}

export function resolveStructure(id: string): Chemical | null {
  return structRegistry.get(id) ?? null
}

const STRUCTURE_CHARS = /^[A-Za-z0-9@=#/\\()[\].%+-]+$/
const LETTER_ONLY_BLOCKLIST = new Set([
  "no", "co", "so", "be", "al", "at", "of", "in", "on", "an", "as", "or",
  "to", "is", "it", "he", "me", "we", "us", "ok", "am", "go", "la", "ma",
  "ca", "bi", "ce", "si", "ba", "na", "mg", "cl", "br", "se", "ne", "ar",
  "kr", "xe", "rn", "li", "be", "b", "c", "n", "o", "f", "p", "s", "k", "v",
  "y", "i", "w", "u",
])

// Conservative detector: only accept a query as a structure when it parses to
// a real molecule AND carries enough structural signal that it is unlikely to
// be an everyday word ("banana", "citrus", "vanilla" all fail element parsing).
export function isLikelySmiles(query: string): boolean {
  const s = query.trim()
  if (s.length < 2 || s.length > 200) return false
  if (!STRUCTURE_CHARS.test(s)) return false
  if (!/[A-Za-z]/.test(s)) return false

  const lettersOnly = /^[A-Za-z]+$/.test(s)
  if (lettersOnly && s.length < 3) return false
  if (lettersOnly && LETTER_ONLY_BLOCKLIST.has(s.toLowerCase())) return false
  if (lettersOnly && !/[\d]/.test(s)) {
    const hasStructureHint = /[=#()[\].]/.test(s) || /[A-Za-z]{2,}/.test(s)
    if (!hasStructureHint && s.length < 4) return false
  }

  const parsed = parseSmiles(s)
  if (!parsed) return false
  const heavy = parsed.atoms.filter((a) => a.element !== "H").length
  if (heavy < 2) return false
  return true
}
