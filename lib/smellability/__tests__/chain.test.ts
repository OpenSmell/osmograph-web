import { describe, expect, it } from "vitest"
import {
  COMPOUND_BY_ID,
  COMPOSITE_BY_ID,
  MAX_SUBSTANCES,
  headspacePpmBand,
  runChemicalVerdict,
  runCompositeVerdict,
  runClassVerdict,
  volatilityLabel,
} from "../index"

describe("band tables", () => {
  it("volatility bands match the science doc", () => {
    expect(volatilityLabel(10000)).toBe("very high")
    expect(volatilityLabel(9999.9)).toBe("high")
    expect(volatilityLabel(100)).toBe("moderate")
    expect(volatilityLabel(1)).toBe("low")
    expect(volatilityLabel(0.5)).toBe("negligible")
    expect(volatilityLabel(null)).toBe("unknown")
  })

  it("headspace ppm bands match the ~1 ppm MOX floor", () => {
    expect(headspacePpmBand(1000)).toBe("strong")
    expect(headspacePpmBand(999.9)).toBe("moderate")
    expect(headspacePpmBand(100)).toBe("moderate")
    expect(headspacePpmBand(10)).toBe("weak")
    expect(headspacePpmBand(1)).toBe("marginal")
    expect(headspacePpmBand(0.9)).toBe("none")
  })

  it("array capacity reconciles with canonical Table 2 (upper bound)", () => {
    expect(MAX_SUBSTANCES[3]).toBe(6)
    expect(MAX_SUBSTANCES[6]).toBe(40)
    expect(MAX_SUBSTANCES[12]).toBe(200)
    expect(MAX_SUBSTANCES[24]).toBe(10000)
  })
})

describe("chemical verdicts", () => {
  const run = (id: string) => runChemicalVerdict(COMPOUND_BY_ID.get(id)!)

  it("ethanol → green / strong / fast / high confidence", () => {
    const v = run("ethanol")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
    expect(v.responseSpeed).toBe("fast")
    expect(v.confidence).toBe("high")
  })

  it("acetone → green / strong / fast", () => {
    const v = run("acetone")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
    expect(v.responseSpeed).toBe("fast")
  })

  it("hydrogen sulfide (gas) → green / strong / fast", () => {
    const v = run("hydrogen-sulfide")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
    expect(v.responseSpeed).toBe("fast")
  })

  it("CO2 is a hard stop → red, reactivity step red", () => {
    const v = run("carbon-dioxide")
    expect(v.verdict).toBe("red")
    expect(v.steps.find((s) => s.id === "reactivity")?.verdict).toBe("red")
  })

  it("N2 is a hard stop → red", () => {
    expect(run("nitrogen").verdict).toBe("red")
  })

  it("isoamyl acetate → green / strong (≈6,900 ppm headspace)", () => {
    const v = run("isoamyl-acetate")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
    expect(v.confidence).toBe("medium")
  })

  it("cinnamaldehyde → yellow / weak / slow (low volatility honesty)", () => {
    const v = run("cinnamaldehyde")
    expect(v.verdict).toBe("yellow")
    expect(v.signalStrength).toBe("weak")
    expect(v.responseSpeed).toBe("slow")
  })

  it("eugenol → yellow / weak / slow", () => {
    const v = run("eugenol")
    expect(v.verdict).toBe("yellow")
    expect(v.signalStrength).toBe("weak")
    expect(v.responseSpeed).toBe("slow")
  })

  it("water → yellow (humidity baseline shift, not an analyte)", () => {
    const v = run("water")
    expect(v.verdict).toBe("yellow")
    expect(v.signalStrength).toBe("strong")
    expect(v.steps.find((s) => s.id === "reactivity")?.reason).toContain("baseline shift")
  })

  it("estimated properties downgrade confidence to medium", () => {
    expect(run("cinnamaldehyde").confidence).toBe("medium")
    expect(run("isoamyl-acetate").confidence).toBe("medium")
  })
})

describe("composite verdicts (everyday substances)", () => {
  const run = (id: string) => runCompositeVerdict(COMPOSITE_BY_ID.get(id)!)

  it("banana → green (ripe-fruit ester headspace)", () => {
    const v = run("banana")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
  })

  it("cinnamon → yellow / weak (dominant constituent is low-volatility)", () => {
    const v = run("cinnamon")
    expect(v.verdict).toBe("yellow")
    expect(v.signalStrength).toBe("weak")
  })

  it("sewer → green (H2S dominates)", () => {
    const v = run("sewer")
    expect(v.verdict).toBe("green")
    expect(v.signalStrength).toBe("strong")
  })

  it("gasoline → green (BTX + alkanes)", () => {
    expect(run("gasoline").verdict).toBe("green")
  })

  it("rotten egg → green", () => {
    expect(run("rotten-egg").verdict).toBe("green")
  })

  it("car-exhaust → green (CO dominant)", () => {
    expect(run("car-exhaust").verdict).toBe("green")
  })

  it("composite weights are normalized to sum to 1", () => {
    const v = run("banana")
    const sum = v.constituents.reduce((acc, c) => acc + c.weightFraction, 0)
    expect(sum).toBeCloseTo(1, 6)
  })
})

describe("class verdicts", () => {
  it("alcohol class → yellow / low confidence with a resolve-to-compound note", () => {
    const v = runClassVerdict("alcohol")
    expect(v.verdict).toBe("yellow")
    expect(v.confidence).toBe("low")
    expect(v.notes.join(" ")).toContain("specific compound")
  })
})

describe("cross-check capacity", () => {
  it("reports the canonical distinguishable-substance count for 6 sensors", () => {
    const v = runChemicalVerdict(COMPOUND_BY_ID.get("ethanol")!, { sensorCount: 6 })
    expect(v.crossCheck?.maxDistinguishable).toBe(40)
  })

  it("flags confusable labels from the user library", () => {
    const v = runChemicalVerdict(COMPOUND_BY_ID.get("ethanol")!, {
      sensorCount: 6,
      librarySubstances: ["ethanol", "hand sanitizer"],
    })
    expect(v.crossCheck?.confusable).toContain("ethanol")
  })
})
