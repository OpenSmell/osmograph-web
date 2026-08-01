import { describe, expect, it } from "vitest"
import {
  COMPOUND_BY_ID,
  COMPOSITE_BY_ID,
  MOX_BOUNDARIES,
  dominantPercept,
  perceptsFor,
  perceptualSummary,
  relevantBoundaries,
  runChemicalVerdict,
  runCompositeVerdict,
  runClassVerdict,
} from "../index"

const chem = (id: string) => COMPOUND_BY_ID.get(id)!

describe("perceptual ontology (the 'hat' layer)", () => {
  it("isoamyl acetate reads as fruity/sweet esters", () => {
    const ps = perceptsFor(chem("isoamyl-acetate"))
    expect(ps.map((p) => p.id)).toContain("fruity-ester")
  })

  it("cinnamaldehyde reads as spicy/balsamic", () => {
    expect(dominantPercept(chem("cinnamaldehyde"))?.id).toBe("spicy-balsamic")
  })

  it("limonene reads as citrus/terpenic", () => {
    expect(dominantPercept(chem("limonene"))?.id).toBe("citrus-terpenic")
  })

  it("hydrogen sulfide reads as sulfurous", () => {
    expect(perceptsFor(chem("hydrogen-sulfide")).map((p) => p.id)).toContain("sulfurous")
  })

  it("ethanol reads as alcoholic", () => {
    expect(perceptsFor(chem("ethanol")).map((p) => p.id)).toContain("alcoholic")
  })

  it("low-volatility percepts are flagged (spicy/smoky)", () => {
    const ps = perceptsFor(chem("cinnamaldehyde"))
    expect(ps.some((p) => p.id === "spicy-balsamic")).toBe(true)
  })
})

describe("MOX boundaries (Table 3 mirrored)", () => {
  it("has the canonical boundaries: 4 can / 5 cannot", () => {
    const can = MOX_BOUNDARIES.filter((b) => b.capability)
    const cannot = MOX_BOUNDARIES.filter((b) => !b.capability)
    expect(can).toHaveLength(4)
    expect(cannot).toHaveLength(5)
    expect(cannot.map((b) => b.id)).toEqual(
      expect.arrayContaining(["structure", "concentration", "non-redox", "trace", "mixture"]),
    )
  })

  it("CO2 verdict highlights the non-redox boundary", () => {
    const v = runChemicalVerdict(chem("carbon-dioxide"))
    expect(relevantBoundaries(v)).toContain("non-redox")
  })

  it("composite verdict highlights the mixture boundary", () => {
    const v = runCompositeVerdict(COMPOSITE_BY_ID.get("banana")!)
    expect(relevantBoundaries(v)).toContain("mixture")
  })

  it("class verdict highlights the structure boundary", () => {
    const v = runClassVerdict("alcohol")
    expect(relevantBoundaries(v)).toContain("structure")
  })
})

describe("perceptual summary wording", () => {
  it("a red non-redox verdict says the chemistry is not redox-active", () => {
    const v = runChemicalVerdict(chem("carbon-dioxide"))
    expect(perceptualSummary(v, perceptsFor(chem("carbon-dioxide")))).toContain("not redox-active")
  })

  it("a strong green verdict names the reducing response", () => {
    const v = runChemicalVerdict(chem("ethanol"))
    expect(perceptualSummary(v, perceptsFor(chem("ethanol")))).toContain("clear reducing response")
  })

  it("a low-volatility spice warns about weak slow signal", () => {
    const v = runChemicalVerdict(chem("cinnamaldehyde"))
    expect(perceptualSummary(v, perceptsFor(chem("cinnamaldehyde")))).toContain("weak, slow")
  })
})
