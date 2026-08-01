import { describe, expect, it } from "vitest"
import { buildProvisionalChemical, estimateVaporPressureFromBoilingPoint } from "../provisional"
import type { EnrichedBoilingPoint, EnrichedChemical } from "../enrichment"

const enriched = (partial: Partial<EnrichedChemical>): EnrichedChemical => ({
  name: "Vanillin",
  smiles: "COC1=C(C=CC(=C1)C=O)O",
  molecularWeight: 152.15,
  source: "pubchem",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...partial,
})

const bp = (valueC: number): EnrichedBoilingPoint => ({ valueC, source: "measured", note: "PubChem experimental property" })

describe("buildProvisionalChemical", () => {
  it("flags everything derived from PubChem as estimated", () => {
    const c = buildProvisionalChemical(enriched({}), bp(285))
    expect(c.props.vaporPressure25?.source).toBe("estimated")
    expect(c.props.vaporPressure25?.value).toBeGreaterThan(0)
    expect(c.props.molecularWeight?.source).toBe("measured")
    expect(c.props.functionalGroups).toContain("phenol")
  })

  it("leaves vapor pressure unknown when no boiling point was fetched", () => {
    const c = buildProvisionalChemical(enriched({}), null)
    expect(c.props.vaporPressure25?.value).toBeNull()
    expect(c.props.vaporPressure25?.source).toBe("unknown")
    expect(c.props.boilingPoint?.value).toBeNull()
  })

  it("inorganic inerts are nonRedox", () => {
    for (const name of ["N2", "O2", "CO2", "Ar", "He", "Ne", "nitrogen", "oxygen", "argon", "carbon dioxide"]) {
      const c = buildProvisionalChemical(enriched({ name, smiles: undefined }), null)
      expect(c.props.functionalGroups, name).toEqual([])
      expect(c.props.nonRedox, name).toBe(true)
      expect(c.props.redoxActive, name).toBe(false)
    }
  })

  it("reducing gases and organics are redoxActive", () => {
    for (const name of ["H2", "CO", "H2S", "NH3", "ammonia", "hydrogen sulfide"]) {
      const c = buildProvisionalChemical(enriched({ name }), null)
      expect(c.props.nonRedox, name).toBeUndefined()
      expect(c.props.redoxActive, name).toBe(true)
    }
  })

  it("inorganic molecules without functional groups are still redoxActive only if reducing", () => {
    const water = buildProvisionalChemical(enriched({ name: "H2O", smiles: "O" }), null)
    expect(water.props.functionalGroups).toEqual([])
    expect(water.props.redoxActive).toBe(false)
    expect(water.props.nonRedox).toBeUndefined()
  })

  it("cites PubChem as its source", () => {
    const c = buildProvisionalChemical(enriched({}), bp(285))
    expect(c.sourceRefs).toContain("PubChem (live lookup)")
  })
})

describe("estimateVaporPressureFromBoilingPoint (Clausius–Clapeyron + Trouton)", () => {
  it("water-ish volatility order: high BP → low VP", () => {
    const ethanol = estimateVaporPressureFromBoilingPoint(78.2)
    const vanillin = estimateVaporPressureFromBoilingPoint(285)
    expect(ethanol).toBeGreaterThan(vanillin!)
  })

  it("matches the chain's estimated branch for a known substance", () => {
    const p = estimateVaporPressureFromBoilingPoint(78.2)
    expect(p).toBeGreaterThan(5000)
    expect(p).toBeLessThan(50000)
  })
})
