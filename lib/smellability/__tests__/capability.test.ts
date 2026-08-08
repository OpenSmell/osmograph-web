import { describe, expect, it } from "vitest"
import { COMPOSITES, COMPOSITE_BY_ID } from "../composites"
import { runCompositeVerdict } from "../chain"
import { overlapBetween, profileOf, rigCapabilityCheck } from "../capability"

function vector(chemicals: string[], contributions: number[]) {
  return { chemicals, contributions, signalScore: 1, signalStrength: "strong" as const, verdict: "green" as const }
}

describe("capability profile", () => {
  it("overlap is 1 for identical profiles and 0 for disjoint ones", () => {
    const a = vector(["x", "y"], [0.7, 0.3])
    expect(overlapBetween(a, vector(["x", "y"], [0.7, 0.3]))).toBeCloseTo(1)
    expect(overlapBetween(a, vector(["z"], [1]))).toBe(0)
  })

  it("overlap is proportional to shared volatile mass", () => {
    // a = {x:0.7, y:0.3}, b = {x:0.5, z:0.5} → inter = min(0.7,0.5)=0.5,
    // union = 0.7+0.3+0.5 = 1.5 → 0.5/1.5 ≈ 0.333
    const a = vector(["x", "y"], [0.7, 0.3])
    const b = vector(["x", "z"], [0.5, 0.5])
    expect(overlapBetween(a, b)).toBeCloseTo(0.3333, 3)
  })

  it("composite verdicts produce weighted profiles", () => {
    const v = runCompositeVerdict(COMPOSITE_BY_ID.get("ginger")!)
    const p = profileOf(v)
    expect(p.chemicals.length).toBe(v.constituents.length)
    expect(p.contributions.reduce((s, c) => s + c, 0)).toBeCloseTo(1, 5)
  })
})

describe("rig capability check", () => {
  it("flags identical-profile pairs as high risk", () => {
    const v = runCompositeVerdict(COMPOSITE_BY_ID.get("ginger")!)
    const r = rigCapabilityCheck([v, v], 6)
    expect(r.pairs[0].risk).toBe("high")
    expect(r.pairs[0].overlap).toBeGreaterThanOrEqual(99)
  })

  it("flags disjoint strong profiles as low risk", () => {
    const a = runCompositeVerdict(COMPOSITE_BY_ID.get("garlic")!)
    const b = runCompositeVerdict(COMPOSITE_BY_ID.get("coffee")!)
    const r = rigCapabilityCheck([a, b], 6)
    expect(r.pairs[0].risk).toBe("low")
  })

  it("reports capacity vs sensor count", () => {
    const v = runCompositeVerdict(COMPOSITE_BY_ID.get("ginger")!)
    const r = rigCapabilityCheck([v], 3)
    expect(r.maxDistinguishable).toBe(6)
    expect(r.atCapacity).toBe(false)
  })

  it("is at capacity when pinned substances exceed the array rating", () => {
    const ids = COMPOSITES.slice(0, 7).map((c) => runCompositeVerdict(c))
    const r = rigCapabilityCheck(ids, 3)
    expect(r.pinned).toBe(7)
    expect(r.atCapacity).toBe(true)
  })
})
