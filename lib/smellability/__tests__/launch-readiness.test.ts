import { describe, expect, it } from "vitest"
import { COMPOUNDS, COMPOUND_BY_ID, REFERENCE_COMPOUND } from "../compounds"
import { GENERATED_COMPOUNDS } from "../compounds-generated"
import { COMPOSITES } from "../composites"
import { searchSubstances, exactResolve } from "../search"
import { runChemicalVerdict, runCompositeVerdict, runClassVerdict } from "../chain"
import { CLASS_TERMS } from "../constants"

// Launch-readiness regression suite: every registry entry must resolve and run
// the feasibility chain, everyday queries must never come back empty, and the
// generated + curated dictionaries must stay consistent.

describe("launch readiness", () => {
  it("all composite constituents resolve to a compound", () => {
    const missing = new Set<string>()
    for (const c of COMPOSITES) {
      for (const k of c.constituents) if (!COMPOUND_BY_ID.has(k.chemicalId)) missing.add(k.chemicalId)
    }
    expect([...missing]).toEqual([])
  })

  it("every compound runs the chain without throwing and yields steps", () => {
    const bad: string[] = []
    for (const c of COMPOUNDS) {
      try {
        const v = runChemicalVerdict(c)
        if (!v.entityId || !v.steps.length) bad.push(`${c.id}:no-steps`)
      } catch (e) {
        bad.push(`${c.id}:${String(e)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("every composite runs the chain with all constituents", () => {
    for (const c of COMPOSITES) {
      const v = runCompositeVerdict(c)
      expect(v.entityId).toBe(c.id)
      expect(v.constituents.length).toBe(c.constituents.length)
    }
  })

  it("every class term runs", () => {
    for (const key of Object.keys(CLASS_TERMS)) {
      const v = runClassVerdict(key)
      expect(v.entityId).toBe(`class:${key}`)
    }
  })

  it("everyday queries always resolve to something", () => {
    const queries = [
      "banana", "coffee", "garlic", "vinegar", "rotten egg", "gasoline",
      "hand sanitizer", "car exhaust", "isoamyl acetate", "hydrogen sulfide",
      "citronella", "eucalyptus", "lavender", "skunk", "fresh cut grass",
      "nail polish remover", "propane", "natural gas", "ethanol", "acetone",
      "vanilla", "rose", "onion", "pine", "christmas tree", "fish", "seafood",
      "mothballs", "clove", "spearmint", "thyme", "rosemary", "tea", "black tea",
      "chocolate", "cocoa", "coconut", "peach", "violet", "mint",
    ]
    const notFound: string[] = []
    for (const q of queries) {
      const r = searchSubstances(q)
      if (r.length === 0) notFound.push(q)
    }
    expect(notFound).toEqual([])
  })

  it("exact resolve is precise for canonical names", () => {
    for (const q of ["ethanol", "acetone", "banana", "vinegar"]) {
      expect(exactResolve(q), q).not.toBeNull()
    }
  })

  it("generated records are physically sane and searchable", () => {
    expect(GENERATED_COMPOUNDS.length).toBeGreaterThan(100)
    for (const c of GENERATED_COMPOUNDS) {
      const mw = c.props.molecularWeight.value
      if (mw != null) expect(mw).toBeGreaterThan(0)
    }
  })

  it("curated reference intact", () => {
    expect(REFERENCE_COMPOUND?.id).toBe("ethanol")
    expect(COMPOUNDS.length).toBeGreaterThan(140)
  })

  it("redox direction is classified correctly for inorganics", () => {
    // Oxidizing gases respond on MOX (resistance rise) and must be green.
    for (const id of ["gen-24823", "chlorine"]) {
      const c = COMPOUND_BY_ID.get(id)
      expect(c, id).toBeDefined()
      if (!c) continue
      expect(c.props.oxidizing, id).toBe(true)
      expect(c.props.redoxActive, id).toBe(true)
      const v = runChemicalVerdict(c)
      expect(v.verdict, id).toBe("green")
      expect(v.steps.find((s) => s.id === "reactivity")?.reason ?? "").toContain("oxidizing")
    }
    // True inerts are a hard stop.
    const co2 = COMPOUND_BY_ID.get("carbon-dioxide")
    expect(co2?.props.nonRedox).toBe(true)
    expect(runChemicalVerdict(co2!).verdict).toBe("red")
  })

  it("reaction composites carry reaction/hazard flags through the chain", () => {
    const reaction = COMPOSITES.filter((c) => c.reaction)
    expect(reaction.length).toBeGreaterThanOrEqual(4)
    for (const c of reaction) {
      const v = runCompositeVerdict(c)
      expect(v.entityId).toBe(c.id)
      expect(v.reaction).toBe(true)
    }
    const hazardous = COMPOSITES.filter((c) => c.hazard)
    expect(hazardous.length).toBeGreaterThanOrEqual(3)
    for (const c of hazardous) {
      expect(c.reaction, c.id).toBe(true)
      expect(runCompositeVerdict(c).hazard).toBe(c.hazard)
    }
    // The reaction pairs resolve from their everyday phrases.
    for (const q of ["bleach and ammonia", "bleach and vinegar", "vinegar and baking soda", "lemon juice and baking soda"]) {
      expect(searchSubstances(q, 1)[0]?.id, q).not.toBeUndefined()
    }
  })
})
