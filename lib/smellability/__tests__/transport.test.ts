import { describe, expect, it } from "vitest"
import {
  vaporPressureAntoine,
  vaporPressureClausiusClapeyron,
  deltaHVapTrouton,
  diffusionVolumeFromMw,
  signalRatioVsRef,
  type IncidentFluxInput,
} from "../transport"

const within = (actual: number, expected: number, pct: number) => {
  const lo = expected * (1 - pct / 100)
  const hi = expected * (1 + pct / 100)
  expect(actual, `${actual} vs ${expected} (±${pct}%)`).toBeGreaterThan(lo)
  expect(actual, `${actual} vs ${expected} (±${pct}%)`).toBeLessThan(hi)
}

describe("vaporPressureAntoine — NIST constants vs curated values", () => {
  it("ethanol ≈ 7.87 kPa at 25 °C", () => {
    within(vaporPressureAntoine(8.20417, 1642.89, 230.3, 25), 7870, 2)
  })
  it("acetone ≈ 30.6 kPa at 25 °C", () => {
    within(vaporPressureAntoine(7.11714, 1210.595, 229.664, 25), 30600, 2)
  })
  it("methanol ≈ 16.9 kPa at 25 °C", () => {
    within(vaporPressureAntoine(8.08097, 1582.271, 239.726, 25), 16900, 2)
  })
  it("benzene ≈ 12.7 kPa at 25 °C", () => {
    within(vaporPressureAntoine(6.90565, 1211.033, 220.79, 25), 12700, 2)
  })
  it("isopropanol ≈ 6.0 kPa at 25 °C (looser — stored constants from a different reference)", () => {
    within(vaporPressureAntoine(8.87829, 2010.33, 252.636, 25), 6020, 5)
  })
  it("rises monotonically with temperature", () => {
    const a = vaporPressureAntoine(8.20417, 1642.89, 230.3, 20)
    const b = vaporPressureAntoine(8.20417, 1642.89, 230.3, 30)
    expect(b).toBeGreaterThan(a)
  })
})

describe("vaporPressureClausiusClapeyron + Trouton (estimation path)", () => {
  it("water from boiling point lands within an order of magnitude of ~3.2 kPa", () => {
    const tBoilK = 100 + 273.15
    const p = vaporPressureClausiusClapeyron(298.15, tBoilK, deltaHVapTrouton(tBoilK))
    expect(p).toBeGreaterThan(1000)
    expect(p).toBeLessThan(10000)
  })
  it("deltaHVapTrouton is 88× boiling temperature", () => {
    expect(deltaHVapTrouton(373.15)).toBeCloseTo(32837.2, 1)
  })
})

describe("diffusion & flux ratio", () => {
  it("diffusion volume is 1.1× molecular weight", () => {
    expect(diffusionVolumeFromMw(100)).toBeCloseTo(110)
  })

  it("H2S flux is ~14.5× ethanol (matches the known smoke-test result)", () => {
    const ethanol: IncidentFluxInput = { vaporPressurePa: 7870, molWeightKg: 0.04607, diffusionVolumeCm3: 50.68 }
    const h2s: IncidentFluxInput = { vaporPressurePa: 101325, molWeightKg: 0.03408, diffusionVolumeCm3: 37.49 }
    const ratio = signalRatioVsRef(h2s, ethanol)
    expect(ratio).toBeGreaterThan(13)
    expect(ratio).toBeLessThan(16)
  })

  it("a zero-vapor-pressure compound contributes no flux", () => {
    const ethanol: IncidentFluxInput = { vaporPressurePa: 7870, molWeightKg: 0.04607, diffusionVolumeCm3: 50.68 }
    const inert: IncidentFluxInput = { vaporPressurePa: 0, molWeightKg: 0.1, diffusionVolumeCm3: 110 }
    expect(signalRatioVsRef(inert, ethanol)).toBe(0)
  })
})
