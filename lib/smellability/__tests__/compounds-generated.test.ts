import { describe, expect, it } from "vitest"
import { COMPOUNDS, COMPOUND_BY_ID, REFERENCE_COMPOUND } from "../compounds"
import { GENERATED_COMPOUNDS } from "../compounds-generated"
import { inferFunctionalGroups } from "../groups"

describe("generated compound dataset", () => {
  it("is large enough to be worth shipping", () => {
    expect(GENERATED_COMPOUNDS.length).toBeGreaterThan(90)
    expect(COMPOUNDS.length).toBeGreaterThan(100)
  })

  it("every generated record is CID-traced and has a SMILES", () => {
    for (const c of GENERATED_COMPOUNDS) {
      expect(typeof c.pubchemCid).toBe("number")
      expect(typeof c.smiles).toBe("string")
      expect(c.sourceRefs.length).toBeGreaterThan(0)
    }
  })

  it("measured boiling points outnumber missing ones", () => {
    const withBp = GENERATED_COMPOUNDS.filter((c) => c.props.boilingPoint.value != null).length
    expect(withBp).toBeGreaterThan(GENERATED_COMPOUNDS.length * 0.9)
  })

  it("groups on disk match what the current inference produces", () => {
    for (const c of GENERATED_COMPOUNDS) {
      const expected = inferFunctionalGroups(c.smiles).sort()
      expect([...c.props.functionalGroups].sort(), `${c.name} (${c.smiles})`).toEqual(expected)
    }
  })
})

describe("curated + generated merge", () => {
  it("expands the dictionary without duplicate ids", () => {
    expect(COMPOUND_BY_ID.size).toBe(COMPOUNDS.length)
    const ids = COMPOUNDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("keeps the curated reference intact", () => {
    expect(COMPOUND_BY_ID.get("ethanol")?.name).toBe("Ethanol")
    expect(REFERENCE_COMPOUND?.id).toBe("ethanol")
  })

  it("a CID is only served once — the curated record wins an overlap", () => {
    const curatedIds = new Set(COMPOUNDS.filter((c) => c.pubchemCid != null).map((c) => c.id))
    const seen = new Set<number>()
    for (const c of COMPOUNDS) {
      if (c.pubchemCid == null) continue
      expect(seen.has(c.pubchemCid), `CID ${c.pubchemCid} served twice`).toBe(false)
      seen.add(c.pubchemCid)
    }
    // A curated record overlapping a generated CID must not have been dropped
    // in favour of the generated estimate (curated carries measured physics).
    for (const g of GENERATED_COMPOUNDS) {
      const curated = COMPOUNDS.filter((c) => c.pubchemCid === g.pubchemCid && c.id !== g.id)
      for (const c of curated) {
        expect(curatedIds.has(c.id)).toBe(true)
        expect(c.props.boilingPoint.source).not.toBe("unknown")
      }
    }
  })

  it("every compound id resolves through the by-id map", () => {
    for (const c of COMPOUNDS) expect(COMPOUND_BY_ID.get(c.id)).toBe(c)
  })
})
