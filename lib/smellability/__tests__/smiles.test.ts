import { describe, expect, it } from "vitest"
import {
  isLikelySmiles,
  parseSmiles,
  estimateBoilingPointJoback,
  structureToChemical,
  registerStructure,
  resolveStructure,
} from "../smiles"
import { searchSubstances } from "../search"
import { resolveAndRun } from "../chain"

describe("parseSmiles — formula and molecular weight", () => {
  it("ethanol CCO → C2H6O, MW 46.07", () => {
    const p = parseSmiles("CCO")
    expect(p).not.toBeNull()
    expect(p!.formula).toBe("C2H6O")
    expect(p!.mw).toBeCloseTo(46.07, 1)
    expect(p!.counts).toMatchObject({ C: 2, H: 6, O: 1 })
  })

  it("benzene c1ccccc1 → C6H6, MW 78.11 (aromatic + implicit H)", () => {
    const p = parseSmiles("c1ccccc1")
    expect(p!.formula).toBe("C6H6")
    expect(p!.mw).toBeCloseTo(78.11, 1)
    expect(p!.counts).toMatchObject({ C: 6, H: 6 })
  })

  it("Kekulé C1=CC=CC=C1 gives the same formula as lowercase aromatic", () => {
    expect(parseSmiles("C1=CC=CC=C1")!.formula).toBe("C6H6")
    expect(parseSmiles("C1=CC=CC=C1")!.mw).toBeCloseTo(78.11, 1)
  })

  it("acetone CC(=O)C → C3H6O", () => {
    const p = parseSmiles("CC(=O)C")
    expect(p!.formula).toBe("C3H6O")
    expect(p!.mw).toBeCloseTo(58.08, 1)
  })

  it("acetic acid CC(=O)O → C2H4O2", () => {
    const p = parseSmiles("CC(=O)O")
    expect(p!.formula).toBe("C2H4O2")
    expect(p!.mw).toBeCloseTo(60.05, 1)
  })

  it("toluene Cc1ccccc1 → C7H8", () => {
    const p = parseSmiles("Cc1ccccc1")
    expect(p!.formula).toBe("C7H8")
    expect(p!.mw).toBeCloseTo(92.14, 1)
  })

  it("sodium chloride salt [Na+].[Cl-] → ClNa, MW 58.44", () => {
    const p = parseSmiles("[Na+].[Cl-]")
    expect(p!.counts).toMatchObject({ Na: 1, Cl: 1 })
    expect(p!.mw).toBeCloseTo(58.44, 1)
  })

  it("ammonia N → NH3 (Hill order H3N)", () => {
    const p = parseSmiles("N")
    expect(p!.formula).toBe("H3N")
    expect(p!.mw).toBeCloseTo(17.03, 1)
  })

  it("rejects strings that do not parse", () => {
    expect(parseSmiles("banana")).toBeNull()
    expect(parseSmiles("x")).toBeNull()
    expect(parseSmiles("")).toBeNull()
    expect(parseSmiles("vanilla")).toBeNull()
  })
})

describe("estimateBoilingPointJoback — group-contribution values land near literature", () => {
  it("ethanol: CH3 + CH2 + OH, estimate inside 40–90 °C (lit. 78)", () => {
    const j = estimateBoilingPointJoback(parseSmiles("CCO")!)
    expect(j).not.toBeNull()
    expect(j!.valueC).toBeGreaterThan(40)
    expect(j!.valueC).toBeLessThan(90)
    expect(j!.groups).toContain("−OH")
  })

  it("acetone: estimate inside 35–75 °C (lit. 56)", () => {
    const j = estimateBoilingPointJoback(parseSmiles("CC(=O)C")!)
    expect(j!.valueC).toBeGreaterThan(35)
    expect(j!.valueC).toBeLessThan(75)
    expect(j!.groups).toContain("−C(=O)−")
  })

  it("benzene: estimate inside 55–95 °C (lit. 80)", () => {
    const j = estimateBoilingPointJoback(parseSmiles("c1ccccc1")!)
    expect(j!.valueC).toBeGreaterThan(55)
    expect(j!.valueC).toBeLessThan(95)
  })

  it("acetic acid estimates high enough to be a liquid at room temp (lit. 118)", () => {
    const j = estimateBoilingPointJoback(parseSmiles("CC(=O)O")!)
    expect(j).not.toBeNull()
    expect(j!.valueC).toBeGreaterThan(70)
    expect(j!.groups).toContain("−COOH")
  })
})

describe("structureToChemical — builds a first-principles Chemical", () => {
  it("ethanol structure carries estimated props and structure provenance", () => {
    const c = structureToChemical("CCO")!
    expect(c).not.toBeNull()
    expect(c.id.startsWith("struct-")).toBe(true)
    expect(c.provenance).toBe("structure")
    expect(c.name).toBe("C2H6O (structure)")
    expect(c.props.molecularWeight.source).toBe("estimated")
    expect(c.props.molecularWeight.value).toBeCloseTo(46.07, 1)
    expect(c.props.boilingPoint.source).toBe("estimated")
    expect(c.props.vaporPressure25.source).toBe("estimated")
    expect(c.props.vaporPressure25.value).toBeGreaterThan(0)
    expect(c.props.functionalGroups).toContain("alcohol")
    expect(c.props.redoxActive).toBe(true)
    expect(c.props.nonRedox).toBeUndefined()
  })

  it("inorganic nitrogen gas is flagged nonRedox when not redox-active", () => {
    const c = structureToChemical("N#N")!
    expect(c.props.nonRedox).toBe(true)
  })

  it("returns null for non-structures", () => {
    expect(structureToChemical("banana")).toBeNull()
  })
})

describe("registerStructure / resolveStructure — the chain can resolve a structure", () => {
  it("a registered structure resolves back to the same chemical", () => {
    const c = structureToChemical("CC(=O)Oc1ccccc1")!
    registerStructure(c)
    expect(resolveStructure(c.id)).toBe(c)
  })
})

describe("isLikelySmiles — conservative detector", () => {
  it("accepts real structures", () => {
    expect(isLikelySmiles("CCO")).toBe(true)
    expect(isLikelySmiles("c1ccccc1")).toBe(true)
    expect(isLikelySmiles("CC(=O)Oc1ccccc1")).toBe(true)
    expect(isLikelySmiles("CCC(=O)OCC")).toBe(true)
  })

  it("rejects everyday words and element words", () => {
    for (const q of ["banana", "citrus", "vanilla", "ethanol", "co", "no", "si", "ca", "mg"]) {
      expect(isLikelySmiles(q), q).toBe(false)
    }
  })

  it("rejects single-heavy-atom strings", () => {
    expect(isLikelySmiles("O")).toBe(false)
    expect(isLikelySmiles("N")).toBe(false)
  })
})

describe("RDKit-rejected structures — still parse and run, 2D preview degrades", () => {
  // This SMILES is rejected by RDKit_minimal's get_mol() but passes our own
  // parser. The structure pipeline must still resolve: formula and estimated
  // properties come from our parser, and only the 2D preview degrades (see
  // StructureViewer's "unavailable" state).
  const RDKIT_REJECTED =
    "C[C@@]12CC[C@H]3C[C@@H](O)CC[C@@H]4C[C@@H](O)[C@H](O)[C@H]34[C@@]12"

  it("parses to a formula and estimated properties", () => {
    const p = parseSmiles(RDKIT_REJECTED)
    expect(p).not.toBeNull()
    expect(p!.formula.length).toBeGreaterThan(0)
    expect(p!.counts.C).toBeGreaterThanOrEqual(13)
    expect(p!.counts.O).toBe(3)
  })

  it("isLikelySmiles accepts it (structure search entry)", () => {
    expect(isLikelySmiles(RDKIT_REJECTED)).toBe(true)
  })

  it("structureToChemical builds a chemical and the chain resolves a verdict", () => {
    const c = structureToChemical(RDKIT_REJECTED)!
    expect(c.provenance).toBe("structure")
    registerStructure(c)
    expect(resolveStructure(c.id)).toBe(c)
    const verdict = resolveAndRun(c.id, "chemical")
    expect(verdict).not.toBeNull()
    expect(verdict!.steps.map((s) => s.id)).toEqual(["identity", "volatility", "signal", "reactivity"])
  })
})

describe("search integration — a SMILES query enters the pipeline as a structure", () => {
  it("searchSubstances surfaces a structure-parsed candidate for CCO", () => {
    const hits = searchSubstances("CCO")
    const struct = hits.find((h) => h.id.startsWith("struct-"))
    expect(struct).toBeDefined()
    expect(struct!.kind).toBe("chemical")
    expect(struct!.matchHint).toContain("structure")
  })

  it("resolveAndRun produces a full verdict for the structure", () => {
    const hits = searchSubstances("CC(=O)Oc1ccccc1")
    const struct = hits.find((h) => h.id.startsWith("struct-"))!
    expect(struct).toBeDefined()
    const verdict = resolveAndRun(struct.id, "chemical")
    expect(verdict).not.toBeNull()
    expect(verdict!.entityName).toBe(struct.name)
    expect(verdict!.steps.length).toBeGreaterThanOrEqual(4)
    expect(verdict!.steps.map((s) => s.id)).toEqual(["identity", "volatility", "signal", "reactivity"])
    const identity = verdict!.steps[0]
    expect(identity.values[0].value).toContain("g/mol")
    expect(identity.values[1].value).toContain("°C")
  })
})
