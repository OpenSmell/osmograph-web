// Structural functional-group inference from a SMILES string.
//
// This is a deliberately conservative heuristic, not a full SMILES parser. It
// recognizes the same vocabulary the feasibility chain and ontology already
// use (see the curated dictionary in compounds.ts), so a provisional
// (live-fetched) chemical can run through the same steps as a curated one.
// When it cannot confidently assign a group it stays silent — the provisional
// chemical is flagged estimated and the chain's unknown state is honest rather
// than guessed.

interface AtomNode {
  el: string
  aromatic: boolean
  start: number
  len: number
  edges: { to: number; bond: 1 | 2 | 3; edge: number; dpos?: number }[]
}

interface ScanResult {
  atoms: AtomNode[]
  ringPairs: [number, number][]
}

// Lightweight SMILES scan. Aromatic rings arrive in two notations: lowercase
// `c1ccccc1` (the form the curated dictionary uses) and Kekulé `C1=CC=CC=C1`
// (the form PubChem's property endpoint actually returns — uppercase carbons
// with alternating `=` bonds). We need to recognise both so a live-fetched
// provisional chemical can be assigned the same groups as a curated one.
function scanSmiles(smiles: string): ScanResult {
  const atoms: AtomNode[] = []
  const digitToAtoms = new Map<number, number[]>()
  const edgeRecords: { from: number; to: number; bond: 1 | 2 | 3; dpos?: number }[] = []
  const stack: number[] = []
  let last = -1
  let pendingBond: 1 | 2 | 3 = 1
  let pendingDpos: number | undefined

  const pushEdge = (from: number, to: number, bond: 1 | 2 | 3, dpos?: number) => {
    const edge = edgeRecords.length
    edgeRecords.push({ from, to, bond, dpos })
    atoms[from].edges.push({ to, bond, edge, dpos })
    atoms[to].edges.push({ to: from, bond, edge, dpos })
  }

  let i = 0
  while (i < smiles.length) {
    const ch = smiles[i]
    if (ch === "(") {
      stack.push(last)
      i++
      pendingBond = 1
      pendingDpos = undefined
      continue
    }
    if (ch === ")") {
      last = stack.pop() ?? -1
      i++
      pendingBond = 1
      pendingDpos = undefined
      continue
    }
    if (ch === "=") {
      pendingBond = 2
      pendingDpos = i
      i++
      continue
    }
    if (ch === "#") {
      pendingBond = 3
      pendingDpos = undefined
      i++
      continue
    }
    if (ch === "-" || ch === "/" || ch === "\\") {
      pendingBond = 1
      pendingDpos = undefined
      i++
      continue
    }
    if (ch === "%") {
      const d = parseInt(smiles.slice(i + 1, i + 3), 10)
      if (last >= 0) {
        const arr = digitToAtoms.get(d) ?? []
        arr.push(last)
        digitToAtoms.set(d, arr)
      }
      i += 3
      continue
    }
    if (/[0-9]/.test(ch)) {
      const d = parseInt(ch, 10)
      if (last >= 0) {
        const arr = digitToAtoms.get(d) ?? []
        arr.push(last)
        digitToAtoms.set(d, arr)
      }
      i++
      continue
    }
    if (ch === "[") {
      const end = smiles.indexOf("]", i)
      const idx = atoms.length
      atoms.push({
        el: smiles.slice(i, end + 1),
        aromatic: /^\[[a-z]/.test(smiles.slice(i, end + 1)),
        start: i,
        len: end + 1 - i,
        edges: [],
      })
      if (last >= 0) pushEdge(last, idx, pendingBond, pendingDpos)
      last = idx
      pendingBond = 1
      pendingDpos = undefined
      i = end + 1
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let el = ch
      let j = i + 1
      if ((ch === "C" && smiles[j] === "l") || (ch === "B" && smiles[j] === "r")) {
        el += smiles[j]
        j++
      }
      const idx = atoms.length
      atoms.push({ el, aromatic: /[cnosp]/.test(el), start: i, len: j - i, edges: [] })
      if (last >= 0) pushEdge(last, idx, pendingBond, pendingDpos)
      last = idx
      pendingBond = 1
      pendingDpos = undefined
      i = j
      continue
    }
    i++
  }

  // Ring closures: an atom written `C1` and a later `C1` (or `=C1`) close the
  // same ring. Pair them up; the closure bond is single in Kekulé notation.
  const ringPairs: [number, number][] = []
  for (const [d, occ] of digitToAtoms) {
    if (occ.length !== 2) continue
    const [x, y] = occ
    ringPairs.push([x, y])
    pushEdge(x, y, 1)
  }

  return { atoms, ringPairs }
}

function findPathBetween(
  from: number,
  to: number,
  atoms: AtomNode[],
  skipEdge: number,
): number[] | null {
  const visited = new Set<number>([from])
  const prev = new Map<number, number>()
  const queue: number[] = [from]
  while (queue.length > 0) {
    const cur = queue.pop()!
    if (cur === to) break
    for (const e of atoms[cur].edges) {
      if (e.edge === skipEdge) continue
      if (!visited.has(e.to)) {
        visited.add(e.to)
        prev.set(e.to, cur)
        queue.push(e.to)
      }
    }
  }
  if (!visited.has(to)) return null
  const path: number[] = []
  let cur: number | undefined = to
  while (cur !== undefined) {
    path.push(cur)
    if (cur === from) break
    cur = prev.get(cur)
  }
  return path.reverse()
}

function edgeBondBetween(a: number, b: number, atoms: AtomNode[]): { bond: 1 | 2 | 3; dpos?: number } | null {
  const edge = atoms[a].edges.find((e) => e.to === b)
  return edge ? { bond: edge.bond, dpos: edge.dpos } : null
}

// A Kekulé ring is an alternating cycle: for a six-membered ring exactly three
// of the ring bonds are double and none are adjacent. Five-membered furan /
// thiophene / pyrrole rings have one hetero atom and two separated doubles.
function isKekuleAromaticRing(path: number[], atoms: AtomNode[]): boolean {
  if (path.length !== 6 && path.length !== 5) return false

  const els = path.map((idx) => atoms[idx].el)
  if (path.length === 6) {
    if (!els.every((el) => el === "C")) return false
  } else {
    const carbons = els.filter((el) => el === "C").length
    const heteros = els.filter((el) => /^[NOSnos]$/.test(el)).length
    if (carbons !== 4 || heteros !== 1) return false
  }

  const bonds: (1 | 2 | 3)[] = []
  for (let k = 0; k < path.length; k++) {
    const a = path[k]
    const b = path[(k + 1) % path.length]
    const edge = edgeBondBetween(a, b, atoms)
    if (!edge) return false
    bonds.push(edge.bond)
  }

  const doubles = bonds.map((b, k) => (b === 2 ? k : -1)).filter((k) => k >= 0)
  const want = path.length === 6 ? 3 : 2
  if (doubles.length !== want) return false
  for (const d of doubles) {
    const prev = (d - 1 + bonds.length) % bonds.length
    const next = (d + 1) % bonds.length
    if (bonds[prev] === 2 || bonds[next] === 2) return false
  }
  return true
}

// Returns `{ normalized, phenol }`: `normalized` is the SMILES with any Kekulé
// aromatic rings rewritten to lowercase aromatic notation (so the regex
// heuristics below see the same form as curated SMILES), and `phenol` is a
// structural check that an O-H sits on an aromatic ring carbon — deliberately
// connectivity-based so that a methoxy group (Ar-O-CH3) is never mistaken for
// a phenol (Ar-OH), which a text pattern like `/Oc1/` cannot tell apart.
function analyze(smiles: string): { normalized: string; phenol: boolean; furan: boolean } {
  const { atoms, ringPairs } = scanSmiles(smiles)

  const ringAtoms = new Set<number>()
  const ringHetero = new Set<string>()
  const hasLowercaseAromatic = atoms.some((a) => a.aromatic)
  const droppedEquals = new Set<number>()

  if (hasLowercaseAromatic) {
    atoms.forEach((a, idx) => {
      if (a.aromatic) ringAtoms.add(idx)
    })
  } else {
    for (const [x, y] of ringPairs) {
      const closureEdge = atoms[x].edges.find((e) => e.to === y)
      if (!closureEdge) continue
      const path = findPathBetween(x, y, atoms, closureEdge.edge)
      if (!path) continue
      if (!isKekuleAromaticRing(path, atoms)) continue
      path.forEach((idx) => ringAtoms.add(idx))
      for (const idx of path) {
        if (/^[NOSnos]$/.test(atoms[idx].el)) ringHetero.add(atoms[idx].el)
      }
      for (let k = 0; k < path.length; k++) {
        const edge = edgeBondBetween(path[k], path[(k + 1) % path.length], atoms)
        if (edge && edge.bond === 2 && edge.dpos !== undefined) droppedEquals.add(edge.dpos)
      }
    }
  }

  const phenol = (() => {
    for (let idx = 0; idx < atoms.length; idx++) {
      const a = atoms[idx]
      if (a.el !== "O") continue
      const singles = a.edges.filter((e) => e.bond === 1)
      if (singles.length !== 1) continue
      if (ringAtoms.has(singles[0].to)) return true
    }
    return false
  })()

  if (ringAtoms.size === 0) return { normalized: smiles, phenol, furan: false }

  let out = ""
  for (let pos = 0; pos < smiles.length; pos++) {
    if (droppedEquals.has(pos)) continue
    let replaced = false
    for (const idx of ringAtoms) {
      const a = atoms[idx]
      if (a.el === "C" && pos === a.start) {
        out += "c"
        replaced = true
        break
      }
    }
    if (!replaced) out += smiles[pos]
  }
  return { normalized: out, phenol, furan: ringHetero.has("O") || ringHetero.has("o") }
}

export function kekuleToAromatic(smiles: string): string {
  return analyze(smiles).normalized
}

export function inferFunctionalGroups(smiles: string | undefined): string[] {
  if (!smiles) return []
  const { normalized: s, phenol, furan } = analyze(smiles.trim())

  const groups = new Set<string>()

  const hasAromatic = /c[123456789]/.test(s)
  if (hasAromatic) groups.add("aromatic")

  // Hetero-only small molecules that the chain treats specially.
  if (/^S$/.test(s)) {
    groups.add("sulfur")
    return Array.from(groups)
  }
  if (/^N$/.test(s)) {
    groups.add("amine")
    return Array.from(groups)
  }

  const isAcid = /C\(=O\)O/.test(s)
  if (isAcid) groups.add("carboxylic acid")

  const isEster = /[Cc]O[Cc]\(=O\)/.test(s)
  if (isEster) groups.add("ester")

  const isKetone = !isAcid && !isEster && /[Cc]C\(=O\)[Cc]/.test(s)
  if (isKetone) {
    groups.add("ketone")
    if (/(=O).*\(C\)=O|\(=O\).*=O|\(C\)=O/.test(s)) groups.add("diketone")
  }

  const isAldehyde =
    !isAcid && (/C=O$/.test(s) || /^O=C(\/|\[|[Cc])/.test(s) || /\(C=O\)$/.test(s) || /[cC]\(C=O\)/.test(s) || /\)C=O/.test(s))
  if (isAldehyde) groups.add("aldehyde")

  if (hasAromatic && phenol) groups.add("phenol")

  if (!hasAromatic && (/[Cc]O$/.test(s) || /\([CcH]\)O$/.test(s)) && !isAcid && !isEster) {
    groups.add("alcohol")
  }

  // Ether: an O bonded to two carbons — COc (anisole/methoxy), CCOC, COC.
  // Exclude acids/esters where the same O belongs to the carbonyl. A phenol's
  // O-H is single-carbon-bonded so it never matches these patterns; the
  // structural `phenol` check above is what separates Ar-OH from Ar-O-CH3.
  if (/CO[cC]|CCO[cC]|O[Cc][CcH]|\)O[Cc]/.test(s) && !isEster && !isAcid) {
    groups.add("ether")
  }

  if (/\[NH[0-9]\]|\(N\)|[Cc]N[Cc]|N[Cc]/.test(s)) groups.add("amine")

  const isThiol = /\[SH\]|S[Cc]?H|H[Ss]/.test(s) || /^[Cc][Ss]$/.test(s)
  if (isThiol) groups.add("thiol")
  if (/[Ss][Cc]|S[Ss]|\(S\)/.test(s)) groups.add("thioether")
  if (isThiol || /[Ss][Cc]|S[Ss]|\(S\)/.test(s)) groups.add("sulfur")

  // Alkene: a carbon-carbon double bond. Kekulé ring bonds are already removed
  // by normalization, so this only fires on real alkenes (cinnamaldehyde's
  // styryl C=C, eugenol's allyl, myrcene, ...).
  if (/[Cc]\d*=[Cc]\d*/.test(s)) groups.add("alkene")

  // Furan ring: a five-membered O heterocycle — either the aromatic `o1cccc1`
  // form or a Kekulé `C1=COC=C1` ring normalised to a digit-less `o` in the ring.
  if (furan || /o[123456789]/.test(s)) groups.add("furan")

  // Alkane: only C/H/ring/bond characters, no hetero atoms, no double bonds, no aromatic.
  if (/^[CcH0-9\/\\()\[\]%]+$/.test(s) && !/=/.test(s) && !hasAromatic) groups.add("alkane")

  // Terpene is not reliably inferable from SMILES alone; leave it to keyword/odor matching.
  return Array.from(groups)
}
