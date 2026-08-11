import { describe, expect, it } from "vitest"
import {
  buildFileFromCsv,
  groupsFromFileList,
  ingestFile,
  LOOSE_GROUP_NAME,
} from "../ingest"
import { buildOsmell, parseOsmell } from "../io"

const SMELLNET_HEADER =
  "NO2,C2H5OH,VOC,CO,Alcohol,LPG,Benzene,Temperature,Pressure,Humidity,Gas_Resistance,Altitude"

function csvRows(n: number): string[] {
  const rows: string[] = []
  for (let i = 0; i < n; i++) {
    const step = i < 8 ? 0 : 1200
    rows.push(
      [
        1200 + step,
        900 + step,
        1500 + step,
        2000 + step,
        800 + step,
        1100 + step,
        950 + step,
        24.5,
        1013,
        45,
        12_000,
        320,
      ].join(","),
    )
  }
  return rows
}

function smellnetCsv(n = 30): string {
  return [SMELLNET_HEADER, ...csvRows(n)].join("\n") + "\n"
}

function csvFile(name: string, rel?: string, text = smellnetCsv()): File {
  const f = new File([text], name, { type: "text/csv" })
  if (rel) {
    Object.defineProperty(f, "webkitRelativePath", {
      value: rel,
      configurable: true,
    })
  }
  return f
}

describe("buildFileFromCsv (SmellNet-style)", () => {
  it("adopts a folder CSV: synthetic timing, context preserved, mox channels only", () => {
    const { file, report, mox } = buildFileFromCsv(
      smellnetCsv(),
      "cinnamon.csv",
      "cinnamon",
      "cinnamon",
    )

    expect(file.manifest.sensor.sensorType).toBe("mox")
    expect(file.manifest.session.groupId).toBe("cinnamon")
    expect(file.manifest.session.label).toBe("cinnamon")
    expect(file.manifest.sensor.timeColumn).toBe("synthetic_index")

    const channelIds = file.manifest.sensor.channels.map((c) => c.id)
    expect(channelIds).not.toContain("Temperature")
    expect(channelIds).not.toContain("Gas_Resistance")
    expect(channelIds).toEqual(
      expect.arrayContaining(["VOC", "CO", "NO2", "C2H5OH", "Alcohol", "LPG"]),
    )

    const ingest = file.manifest.extra?.ingest
    expect(ingest?.timeSource).toBe("synthetic")
    expect(ingest?.contextColumns).toContain("Temperature")
    expect(ingest?.context).toBeDefined()
    expect(ingest?.context?.["Humidity"]?.[0]).toBe(45)
    expect(ingest?.warnings?.length).toBeGreaterThan(0)
    expect(ingest?.warnings?.some((w) => w.includes("No time column"))).toBe(true)
    expect(ingest?.warnings?.some((w) => w.includes("context"))).toBe(true)

    expect(mox).not.toBeNull()
    expect(mox?.features.length).toBeGreaterThanOrEqual(6)
    expect(report.total).not.toBeNull()
  })

  it("uses the declared time column when present", () => {
    const header = "timestamp_ms," + SMELLNET_HEADER
    const body = csvRows(10).map((r, i) => `${i * 1000},${r}`).join("\n")
    const { file } = buildFileFromCsv(`${header}\n${body}\n`, "t.csv", "t", "t")
    expect(file.manifest.extra?.ingest?.timeSource).toBe("column")
    expect(file.manifest.extra?.ingest?.timeColumn).toBe("timestamp_ms")
    expect(file.time[1]).toBe(1000)
  })

  it("round-trips provenance through .osmell", async () => {
    const { file } = buildFileFromCsv(smellnetCsv(), "c.csv", "c", "c")
    const blob = await buildOsmell(file)
    const parsed = await parseOsmell(await blob.arrayBuffer())
    expect(parsed.manifest.extra?.ingest?.timeSource).toBe("synthetic")
    expect(parsed.manifest.extra?.ingest?.contextColumns).toContain("Pressure")
    expect(parsed.time.length).toBe(file.time.length)
  })
})

describe("ingestFile", () => {
  it("reports failure instead of throwing on an empty file", async () => {
    const f = new File([""], "empty.csv", { type: "text/csv" })
    const s = await ingestFile(f, "sub")
    expect(s.ok).toBe(false)
    expect(s.error).toBeTruthy()
  })

  it("reports failure on a header-only CSV", async () => {
    const f = new File([SMELLNET_HEADER + "\n"], "h.csv", { type: "text/csv" })
    const s = await ingestFile(f, "sub")
    expect(s.ok).toBe(false)
  })

  it("ingests a valid SmellNet file successfully", async () => {
    const f = new File([smellnetCsv()], "cinnamon.376616d4c817.csv.csv", {
      type: "text/csv",
    })
    const s = await ingestFile(f, "cinnamon")
    expect(s.ok).toBe(true)
    expect(s.substance).toBe("cinnamon")
    expect(s.features).not.toBeNull()
    expect(s.warnings.length).toBeGreaterThan(0)
  })
})

describe("groupsFromFileList", () => {
  it("groups folder-picked files by immediate parent directory", () => {
    const files = [
      csvFile("a.csv", "cinnamon/a.csv"),
      csvFile("b.csv", "cinnamon/b.csv"),
      csvFile("c.csv", "garlic/c.csv"),
    ]
    const groups = groupsFromFileList(files)
    expect(groups).toHaveLength(2)
    const cin = groups.find((g) => g.name === "cinnamon")
    const gar = groups.find((g) => g.name === "garlic")
    expect(cin?.files).toHaveLength(2)
    expect(gar?.files).toHaveLength(1)
  })

  it("groups flat files under the loose sentinel", () => {
    const groups = groupsFromFileList([csvFile("a.csv"), csvFile("b.csv")])
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe(LOOSE_GROUP_NAME)
    expect(groups[0].files).toHaveLength(2)
  })
})
