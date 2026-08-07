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
    if (ch === ".") {
      // Disconnected fragment (e.g. `[S-].[K+]` salts): no bond is formed
      // with the previous atom, so the "last" pointer must reset.
      last = -1
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
  // same ring. The closure bond is single in Kekulé notation. A digit may be
  // reused for a later ring (e.g. dibenzofuran `c1ccc2c(c1)oc1ccccc12`), so
  // occurrences pair up sequentially: 1st-2nd, 3rd-4th, and so on.
  const ringPairs: [number, number][] = []
  for (const [, occ] of digitToAtoms) {
    for (let k = 1; k < occ.length; k += 2) {
      const x = occ[k - 1]
      const y = occ[k]
      ringPairs.push([x, y])
      pushEdge(x, y, 1)
    }
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

// Ring composition: six-membered rings are carbon-only (or up to two ring
// nitrogens — pyridine / pyrazine arrive in this form from PubChem); five-
// membered rings are one N/O/S hetero plus four carbons (furan, pyrrole,
// thiophene).
function ringCompositionOk(path: number[], atoms: AtomNode[]): boolean {
  const els = path.map((idx) => atoms[idx].el)
  if (path.length === 6) {
    const carbons = els.filter((el) => el === "C").length
    const nitrogens = els.filter((el) => el === "N").length
    return carbons + nitrogens === 6 && nitrogens <= 2
  }
  if (path.length === 5) {
    const carbons = els.filter((el) => el === "C").length
    const heteros = els.filter((el) => /^[NOSnos]$/.test(el)).length
    return carbons === 4 && heteros === 1
  }
  return false
}

function ringDoubleInfo(path: number[], atoms: AtomNode[]): { count: number; separated: boolean } {
  const bonds: (1 | 2 | 3)[] = []
  for (let k = 0; k < path.length; k++) {
    const a = path[k]
    const b = path[(k + 1) % path.length]
    const edge = edgeBondBetween(a, b, atoms)
    if (!edge) return { count: 0, separated: true }
    bonds.push(edge.bond)
  }
  const doubles = bonds.map((b, k) => (b === 2 ? k : -1)).filter((k) => k >= 0)
  for (const d of doubles) {
    const prev = (d - 1 + bonds.length) % bonds.length
    const next = (d + 1) % bonds.length
    if (bonds[prev] === 2 || bonds[next] === 2) return { count: doubles.length, separated: false }
  }
  return { count: doubles.length, separated: true }
}

// A Kekulé ring is an alternating cycle. Six-membered benzene shows three
// separated double bonds; azines (pyridine / pyrazine) show two or three;
// five-membered furan / pyrrole / thiophene rings show two. A lone two-double
// all-carbon six-ring is a 1,4-diene, not aromatic — those are only accepted
// via the benzenoid-pair rule below. Nothing with adjacent double bonds passes,
// which keeps cyclohexene, limonene, menthol and the pinanes non-aromatic.
function isKekuleAromaticRing(path: number[], atoms: AtomNode[]): boolean {
  if (!ringCompositionOk(path, atoms)) return false
  const { count, separated } = ringDoubleInfo(path, atoms)
  if (!separated) return false
  const els = path.map((idx) => atoms[idx].el)
  if (path.length === 6) {
    if (els.some((el) => el === "N")) return count >= 2 // azine
    return count === 3 // benzene
  }
  return count === 2 // furan / pyrrole / thiophene
}

function ringSharesWithAccepted(path: number[], atoms: AtomNode[], acceptedPaths: number[][]): boolean {
  const mine = new Set(path)
  for (const acc of acceptedPaths) {
    let shared = 0
    for (const a of acc) if (mine.has(a)) shared++
    if (shared >= 2) return true
  }
  return false
}

// γ-terpinene's 1,4-cyclohexadiene ring shows two separated doubles and must
// NOT be aromatic; naphthalene's two fused six-rings each show two. The
// distinguishing fact is fusion: a two-double all-carbon six-ring is only
// accepted when it shares an edge with a second two-double all-carbon six-ring
// (a benzenoid pair). A lone two-double six-ring stays a diene.
function benzenoidPairOk(path: number[], atoms: AtomNode[], candidates: number[][]): boolean {
  const allCarbonSix = (p: number[]) =>
    p.length === 6 && p.every((i) => atoms[i].el === "C") && ringDoubleInfo(p, atoms).count >= 2
  if (!allCarbonSix(path)) return false
  const mine = new Set(path)
  for (const other of candidates) {
    if (other === path) continue
    if (!allCarbonSix(other)) continue
    let shared = 0
    for (const a of other) if (mine.has(a)) shared++
    if (shared >= 2) return true
  }
  return false
}

function isCarbon(el: string): boolean {
  return el === "C" || el === "c" || /^\[C/.test(el)
}

// An oxygen bonded to a carbon that also carries a double-bonded oxygen is a
// carbonyl oxygen or belongs to a carbonyl (ester/acid/lactone); every other
// single-bonded O-H that sits on a non-aromatic carbon is an alcohol.
function isAlcoholOxygen(idx: number, atoms: AtomNode[], ringAtoms: Set<number>): boolean {
  const a = atoms[idx]
  if (a.el !== "O") return false
  const singles = a.edges.filter((e) => e.bond === 1)
  if (singles.length !== 1) return false
  const n = atoms[singles[0].to]
  if (!isCarbon(n.el)) return false
  if (ringAtoms.has(singles[0].to)) return false
  const neighborIsCarbonyl = n.edges.some((e) => e.bond === 2 && /^[Oo]/.test(atoms[e.to].el))
  return !neighborIsCarbonyl
}

// An ether oxygen is bonded by two single bonds to carbons, neither of which
// carries a carbonyl (a lactone ring oxygen therefore stays an ester). Oxygen
// already inside a recognised aromatic ring (furan's `o`, a Kekulé furan O)
// is never an ether.
function isEtherOxygen(idx: number, atoms: AtomNode[], ringAtoms: Set<number>): boolean {
  const a = atoms[idx]
  if (a.el !== "O") return false
  if (ringAtoms.has(idx)) return false
  const singles = a.edges.filter((e) => e.bond === 1)
  if (singles.length !== 2) return false
  for (const e of singles) {
    const n = atoms[e.to]
    if (!isCarbon(n.el)) return false
    const neighborIsCarbonyl = n.edges.some((nn) => nn.bond === 2 && /^[Oo]/.test(atoms[nn.to].el))
    if (neighborIsCarbonyl) return false
  }
  return true
}

// A carbonyl carbon whose only single-bonded neighbours are carbons: one such
// neighbour (or none, formaldehyde) is an aldehyde, two is a ketone. Carbonyl
// carbons that also hold a single-bonded oxygen belong to acids/esters/lactones
// and are skipped — those are decided by the ester/acid rules.
function countCarbonyls(atoms: AtomNode[]): { aldehydes: number; ketones: number } {
  let aldehydes = 0
  let ketones = 0
  for (const a of atoms) {
    if (!isCarbon(a.el)) continue
    const hasDoubleO = a.edges.some((e) => e.bond === 2 && /^[Oo]/.test(atoms[e.to].el))
    if (!hasDoubleO) continue
    if (a.edges.some((e) => e.bond === 1 && /^[Oo]/.test(atoms[e.to].el))) continue
    const cNbrs = a.edges.filter((e) => e.bond === 1 && isCarbon(atoms[e.to].el)).length
    if (cNbrs <= 1) aldehydes++
    else ketones++
  }
  return { aldehydes, ketones }
}

// A carbon-carbon double bond outside a recognised aromatic ring. Kekulé ring
// bonds of detected rings are already removed, so this only fires on real
// alkenes (cinnamaldehyde's styryl C=C, eugenol's allyl, geraniol, myrcene, ...).
function hasAlkene(atoms: AtomNode[], ringAtoms: Set<number>): boolean {
  return atoms.some((a, idx) => {
    if (!isCarbon(a.el)) return false
    if (ringAtoms.has(idx)) return false
    return a.edges.some((e) => e.bond === 2 && isCarbon(atoms[e.to].el))
  })
}

// Returns `{ normalized, phenol, furan, ringAtoms, atoms }`: `normalized` is the
// SMILES with any Kekulé aromatic rings rewritten to lowercase aromatic notation
// (so the regex heuristics below see the same form as curated SMILES), `phenol`
// is a structural check that an O-H sits on an aromatic ring carbon — deliberately
// connectivity-based so that a methoxy group (Ar-O-CH3) is never mistaken for a
// phenol (Ar-OH), which a text pattern like `/Oc1/` cannot tell apart — and
// `ringAtoms`/`atoms` let the structural checks below reuse the same scan.
function analyze(
  smiles: string,
): { normalized: string; phenol: boolean; furan: boolean; ringAtoms: Set<number>; atoms: AtomNode[] } {
  const { atoms, ringPairs } = scanSmiles(smiles)

  const ringAtoms = new Set<number>()
  const ringHetero = new Set<string>()
  const hasLowercaseAromatic = atoms.some((a) => a.aromatic)
  const droppedEquals = new Set<number>()

  if (hasLowercaseAromatic) {
    atoms.forEach((a, idx) => {
      if (a.aromatic) {
        ringAtoms.add(idx)
        if (/^[nos]/.test(a.el)) ringHetero.add(a.el)
      }
    })
  } else {
    const candidates: number[][] = []
    for (const [x, y] of ringPairs) {
      const closureEdge = atoms[x].edges.find((e) => e.to === y)
      if (!closureEdge) continue
      const path = findPathBetween(x, y, atoms, closureEdge.edge)
      if (!path) continue
      if (ringCompositionOk(path, atoms)) candidates.push(path)
    }
    const acceptedPaths: number[][] = []
    let changed = true
    while (changed) {
      changed = false
      for (const path of candidates) {
        if (acceptedPaths.some((p) => p === path)) continue
        const { count, separated } = ringDoubleInfo(path, atoms)
        const strict = isKekuleAromaticRing(path, atoms)
        const benzenoid = separated && benzenoidPairOk(path, atoms, candidates)
        const fused = count >= 1 && separated && ringSharesWithAccepted(path, atoms, acceptedPaths)
        if (strict || benzenoid || fused) {
          acceptedPaths.push(path)
          changed = true
        }
      }
    }
    for (const path of acceptedPaths) {
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

  if (ringAtoms.size === 0) return { normalized: smiles, phenol, furan: false, ringAtoms, atoms }

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
  return { normalized: out, phenol, furan: ringHetero.has("O") || ringHetero.has("o"), ringAtoms, atoms }
}

export function kekuleToAromatic(smiles: string): string {
  return analyze(smiles).normalized
}

export function inferFunctionalGroups(smiles: string | undefined): string[] {
  if (!smiles) return []
  const { normalized: s, phenol, furan, ringAtoms, atoms } = analyze(smiles.trim())

  const groups = new Set<string>()

  const hasAromatic = ringAtoms.size > 0
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

  // Ester first: `CCC(=O)OCC` is an ester, not an acid. PubChem writes simple
  // esters both as `...C(=O)O...` (alcohol side onward), `...COC(=O)...`, and
  // cyclic lactones as `C(=O)O1` (ring closure after the ester oxygen).
  const isEster = /[Cc]O[Cc]\(=O\)|\(=O\)O[Cc0-9]/.test(s)
  if (isEster) groups.add("ester")

  // Carboxylic acid: the carbonyl O must be terminal, bracketed, or a
  // carboxylate — never bonded onward to a carbon (that is the ester case).
  const isAcid = /C\(=O\)O$|C\(=O\)O\)|C\(=O\)\[O-/.test(s)
  if (isAcid) groups.add("carboxylic acid")

  // Ketone vs aldehyde decided structurally so branched (C(=O)C), ring
  // (C1=O), and slash-marked (C/C=O) carbonyls all classify correctly once
  // acids/esters/lactones are excluded.
  const { aldehydes, ketones } = countCarbonyls(atoms)
  if (ketones > 0) {
    groups.add("ketone")
    if (ketones > 1) groups.add("diketone")
  }
  if (aldehydes > 0) groups.add("aldehyde")

  if (hasAromatic && phenol) groups.add("phenol")

  if (atoms.some((_, i) => isAlcoholOxygen(i, atoms, ringAtoms))) groups.add("alcohol")

  if (atoms.some((_, i) => isEtherOxygen(i, atoms, ringAtoms))) groups.add("ether")

  const hasRingNitrogen = [...ringHeteroOf(ringAtoms, atoms)].some((el) => /^[Nn]/.test(el))
  if (/\[NH[0-9]\]|\(N\)|N\(|[Cc]N[Cc]|N[Cc]/.test(s) || hasRingNitrogen) groups.add("amine")

  const isThiol = /\[SH\]|S[Cc]?H|H[Ss]|[Cc]S$|\)S$/.test(s)
  if (isThiol) groups.add("thiol")
  if (/[Ss][Cc]|S[Ss]|\(S\)/.test(s)) groups.add("thioether")
  if (isThiol || /[Ss][Cc]|S[Ss]|\(S\)|=[Ss]|[Ss]=O/.test(s)) groups.add("sulfur")

  if (hasAlkene(atoms, ringAtoms)) groups.add("alkene")

  // Furan ring: a five-membered O heterocycle — either the aromatic `o1cccc1`
  // form or a Kekulé `C1=COC=C1` ring normalised to a digit-less `o` in the ring.
  if (furan || /o[123456789]/.test(s)) groups.add("furan")

  // Alkane: only C/H/ring/bond characters, no hetero atoms, no double bonds, no aromatic.
  if (/^[CcH0-9\/\\()\[\]%]+$/.test(s) && !/=/.test(s) && !hasAromatic) groups.add("alkane")

  // Terpene is not reliably inferable from SMILES alone; leave it to keyword/odor matching.
  return Array.from(groups)
}

function ringHeteroOf(ringAtoms: Set<number>, atoms: AtomNode[]): Set<string> {
  const out = new Set<string>()
  for (const idx of ringAtoms) {
    const el = atoms[idx].el
    if (/^[NOSnos]$/.test(el) || /^\[[NOSnos]/.test(el)) out.add(el)
  }
  return out
}
