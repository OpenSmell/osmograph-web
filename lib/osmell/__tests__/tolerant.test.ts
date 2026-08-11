import { describe, expect, it } from "vitest"
import { parseCsv } from "../csv"
import { buildFileFromCsv } from "../ingest"

describe("tolerant ingest (any file accepted)", () => {
  it("no timestamp column -> synthetic", () => {
    const csv = "NO2,C2H5OH,VOC,CO,Alcohol,LPG\n1,2,3,4,5,6\n1,2,3,4,5,6\n"
    const p = parseCsv(csv)
    expect(p.rowCount).toBe(2)
    expect(p.timeSource).toBe("synthetic")
  })

  it("timestamp as HH:MM:SS.mmm is adopted as ms", () => {
    const csv = "timestamp,NO2,C2H5OH,VOC,CO,Alcohol,LPG\n00:00:00.000,1,2,3,4,5,6\n00:00:00.100,1,2,3,4,5,6\n00:00:00.200,1,2,3,4,5,6\n"
    const p = parseCsv(csv)
    expect(p.rowCount).toBe(3)
    expect(p.timeSource).toBe("column")
    expect(p.samples[1].time).toBe(100)
    const { file } = buildFileFromCsv(csv, "t.csv", "t", "t")
    expect(file.time[2]).toBe(200)
  })

  it("timestamp as ISO datetime is adopted as ms", () => {
    const csv = "timestamp_ms,NO2,C2H5OH,VOC,CO,Alcohol,LPG\n2024-01-01T12:00:00Z,1,2,3,4,5,6\n2024-01-01T12:00:01Z,1,2,3,4,5,6\n"
    const p = parseCsv(csv)
    expect(p.rowCount).toBe(2)
    expect(p.timeSource).toBe("column")
    expect(p.samples[1].time - p.samples[0].time).toBe(1000)
  })

  it("unparseable time column falls back to synthetic instead of dropping rows", () => {
    const csv = "time,NO2,C2H5OH,VOC,CO,Alcohol,LPG\nn/a,1,2,3,4,5,6\nn/a,1,2,3,4,5,6\nn/a,1,2,3,4,5,6\n"
    const p = parseCsv(csv)
    expect(p.rowCount).toBe(3)
    expect(p.timeSource).toBe("synthetic")
    expect(p.warnings.some((w) => w.includes("synthesized 10 Hz timing"))).toBe(true)
  })

  it("semicolon-delimited files are parsed", () => {
    const csv = "NO2;C2H5OH;VOC;CO;Alcohol;LPG\n1;2;3;4;5;6\n1;2;3;4;5;6\n"
    const p = parseCsv(csv)
    expect(p.channelIds).toEqual(["NO2", "C2H5OH", "VOC", "CO", "Alcohol", "LPG"])
    expect(p.rowCount).toBe(2)
  })

  it("epoch-seconds time column is scaled to ms", () => {
    const csv = "timestamp,NO2,C2H5OH,VOC,CO,Alcohol,LPG\n1704067200,1,2,3,4,5,6\n1704067201,1,2,3,4,5,6\n"
    const p = parseCsv(csv)
    expect(p.timeSource).toBe("column")
    expect(p.samples[1].time - p.samples[0].time).toBe(1000)
    expect(p.warnings.some((w) => w.includes("epoch seconds"))).toBe(true)
  })

  it("tab-delimited files are parsed", () => {
    const csv = "NO2\tC2H5OH\tVOC\tCO\tAlcohol\tLPG\n1\t2\t3\t4\t5\t6\n1\t2\t3\t4\t5\t6\n"
    const p = parseCsv(csv)
    expect(p.channelIds.length).toBe(6)
    expect(p.rowCount).toBe(2)
  })
})
