import { describe, expect, it } from "vitest"
import { baselineForChannel, samplesForDuration } from "../normalize"
import type { OsmellFile } from "../types"

function makeFile(
  channels: Record<string, number[]>,
  gapMs: number,
  opts: Partial<OsmellFile["manifest"]> = {},
): OsmellFile {
  const ids = Object.keys(channels)
  const n = channels[ids[0]].length
  const time = Array.from({ length: n }, (_, i) => i * gapMs)
  return {
    manifest: {
      osmell: { formatVersion: "1.0.0" },
      sensor: {
        sensorType: "mox",
        channels: ids.map((id) => ({ id, unit: "adc" })),
        samplingRateHz: gapMs > 0 ? 1000 / gapMs : undefined,
        adcBits: 12,
        adcMax: 4095,
        timeColumn: "elapsed_ms",
      },
      session: { role: "exposure", label: "test" },
      baseline: { source: "auto" },
      ...opts,
    },
    time,
    data: channels,
  }
}

describe("duration-anchored R0 and recovery windows (cadence invariance)", () => {
  it("samplesForDuration converts wall-clock to cadence-relative sample count", () => {
    expect(samplesForDuration(1500, 100, 15)).toBe(15)
    expect(samplesForDuration(1500, 500, 15)).toBe(3)
    expect(samplesForDuration(1500, null, 15)).toBe(15)
    expect(samplesForDuration(0, 100, 15)).toBe(15)
  })

  it("auto-R0 covers the same 1.5 s window at 10 Hz and 2 Hz", () => {
    const baseline = Array.from({ length: 60 }, () => 1000)
    const hi = makeFile({ A: baseline }, 100)
    const lo = makeFile({ A: baseline }, 500)
    expect(hi.manifest.sensor.samplingRateHz).toBe(10)
    expect(lo.manifest.sensor.samplingRateHz).toBe(2)

    const r0Hi = baselineForChannel(hi, "A", baseline)
    const r0Lo = baselineForChannel(lo, "A", baseline)
    expect(r0Hi.windowValues).toHaveLength(15)
    expect(r0Lo.windowValues).toHaveLength(3)
    expect(r0Hi.r0).toBe(1000)
    expect(r0Lo.r0).toBe(1000)
  })

  it("an explicit r0Samples in the manifest still wins", () => {
    const baseline = Array.from({ length: 60 }, () => 1000)
    const file = makeFile({ A: baseline }, 100, {
      baseline: { source: "auto", r0Samples: 9 },
    })
    const r0 = baselineForChannel(file, "A", baseline)
    expect(r0.windowValues).toHaveLength(9)
    expect(r0.r0).toBe(1000)
  })

  it("explicit baseline window covers the whole baseline channel, not a sample tail", () => {
    const baselineCh: number[] = []
    for (let i = 0; i < 40; i++) baselineCh.push(1000 + i * 10)
    const file = makeFile({ A: baselineCh }, 100, {
      baseline: { source: "explicit" },
    })
    const r0 = baselineForChannel(file, "A", baselineCh)
    expect(r0.windowValues).toHaveLength(40)
    expect(r0.r0).toBe(1000 + 19.5 * 10)
  })
})