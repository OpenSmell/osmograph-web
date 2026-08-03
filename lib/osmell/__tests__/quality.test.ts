import { describe, expect, it } from "vitest"
import fixture from "./fixtures/quality_cases.json"
import { parseOsmell } from "../io"
import { computeQuality } from "../quality"

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = Buffer.from(b64, "base64")
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer
}

describe("quality spec §7 parity (shared fixture matrix)", () => {
  for (const c of fixture.cases) {
    it(`scores ${c.name} to golden values`, async () => {
      const file = await parseOsmell(b64ToArrayBuffer(c.osmellB64))
      const report = computeQuality({
        file,
        sampleCount: file.time.length,
        guessSamplingRateHz: 10,
        unsorted: false,
        nonFinite: 0,
      })

      expect(report.total).toBe(c.expected.total)
      expect(report.badge).toBe(c.expected.badge)

      for (const [key, expected] of Object.entries(c.expected.subscores)) {
        const sub = report.subscores[key as keyof typeof report.subscores]
        if (expected === null) {
          expect(sub.value).toBeNull()
        } else {
          expect(sub.value).not.toBeNull()
          expect(Math.abs((sub.value as number) - (expected as number))).toBeLessThanOrEqual(
            fixture.tolerance,
          )
        }
      }

      expect(report.flags.deadSensors).toEqual(c.expected.deadSensors)
      expect(report.flags.usedMedianSamplingRate).toBe(
        c.expected.usedMedianSamplingRate,
      )
      expect(report.flags.usedDefaultAdcMax).toBe(c.expected.usedDefaultAdcMax)
    })
  }
})
