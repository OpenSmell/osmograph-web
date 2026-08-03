import { describe, expect, it } from "vitest"
import { processMox } from "../processors"
import type { OsmellFile } from "../types"

function makeFile(channels: Record<string, number[]>): OsmellFile {
  const ids = Object.keys(channels)
  const n = channels[ids[0]].length
  const time = Array.from({ length: n }, (_, i) => i * 100)
  return {
    manifest: {
      osmell: { formatVersion: "1.0.0" },
      sensor: {
        sensorType: "mox",
        channels: ids.map((id) => ({ id, unit: "adc" })),
        samplingRateHz: 10,
        adcBits: 12,
        adcMax: 4095,
        timeColumn: "elapsed_ms",
      },
      session: { role: "exposure", label: "test" },
      baseline: { source: "auto", r0Samples: 15 },
    },
    time,
    data: channels,
  }
}

function impulseSeries(
  base: number,
  peak: number,
  nBase: number,
  nRise: number,
  nHold: number,
  nDecay: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < nBase; i++) out.push(base)
  for (let i = 1; i <= nRise; i++) out.push(base + ((peak - base) * i) / nRise)
  for (let i = 0; i < nHold; i++) out.push(peak)
  for (let i = 1; i <= nDecay; i++) out.push(peak - ((peak - base) * i) / nDecay)
  for (let i = 0; i < 10; i++) out.push(base)
  return out
}

describe("processMox device-agnostic features", () => {
  it("computes rise time, decay time, endpoint delta and saturation for a clean impulse", () => {
    const series = impulseSeries(1000, 2000, 20, 10, 5, 10)
    const { features } = processMox(makeFile({ A: series }))
    const f = features[0]

    expect(f.dead).toBe(false)
    expect(f.relativeAmplitude).toBeCloseTo(1.0, 5)
    expect(f.riseTimeMs).not.toBeNull()
    expect(f.decayTimeMs).not.toBeNull()
    expect(f.endpointDelta).toBeCloseTo(0, 5)
    expect(f.saturationIndex).toBeCloseTo(1.0, 5)
  })

  it("keeps decay time null when the signal never returns toward baseline", () => {
    const n = 60
    const values: number[] = []
    for (let i = 0; i < n; i++) values.push(i < 15 ? 1000 : 2000)
    const { features } = processMox(makeFile({ A: values }))
    expect(features[0].decayTimeMs).toBeNull()
    expect(features[0].saturationIndex).toBeCloseTo(1.0, 5)
  })

  it("marks flat channels dead and zeroes their features", () => {
    const flat = Array.from({ length: 60 }, () => 1000)
    const { features } = processMox(makeFile({ A: flat }))
    expect(features[0].dead).toBe(true)
    expect(features[0].relativeAmplitude).toBe(0)
    expect(features[0].decayTimeMs).toBeNull()
    expect(features[0].endpointDelta).toBe(0)
  })
})
