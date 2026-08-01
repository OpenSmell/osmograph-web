import { describe, expect, it } from "vitest"
import { extractBoilingPointC, parseBoilingPoint } from "../enrichment"

describe("parseBoilingPoint", () => {
  it("parses plain, °C and wordy strings", () => {
    expect(parseBoilingPoint("78.2 °C")).toBe(78.2)
    expect(parseBoilingPoint("285°C")).toBe(285)
    expect(parseBoilingPoint("100 C")).toBe(100)
    expect(parseBoilingPoint("Boiling point: 56.7 °C at 760 mmHg")).toBe(56.7)
  })

  it("rejects non-numeric or non-string input", () => {
    expect(parseBoilingPoint("not a number")).toBeNull()
    expect(parseBoilingPoint(undefined)).toBeNull()
    expect(parseBoilingPoint(78)).toBeNull()
    expect(parseBoilingPoint("−10 (est.)")).toBeNull()
  })
})

describe("extractBoilingPointC from pug_view section trees", () => {
  it("finds the first numeric °C under a Boiling Point heading", () => {
    const sections = [
      {
        TOCHeading: "Experimental Properties",
        Section: [
          {
            TOCHeading: "Boiling Point",
            Information: [
              {
                Value: { StringWithMarkup: [{ String: "281.6±35.0 °C" }] },
              },
              {
                Value: { StringWithMarkup: [{ String: "285 °C" }] },
              },
            ],
          },
        ],
      },
    ]
    expect(extractBoilingPointC(sections)).toBe(281.6)
  })

  it("handles Number arrays and StringWithMarkup fallbacks", () => {
    const sections = [
      {
        TOCHeading: "Boiling Point",
        Information: [{ Value: { Number: [78.2, 78.5] } }],
      },
    ]
    expect(extractBoilingPointC(sections)).toBe(78.2)
  })

  it("returns null when no boiling point is present", () => {
    expect(extractBoilingPointC([{ TOCHeading: "Density", Information: [{ Value: { String: "1.05 g/cm³" } }] }])).toBeNull()
    expect(extractBoilingPointC(undefined)).toBeNull()
  })

  it("rejects implausible out-of-range values", () => {
    const sections = [{ TOCHeading: "Boiling Point", Information: [{ Value: { StringWithMarkup: [{ String: "1200 °C" }] } }] }]
    expect(extractBoilingPointC(sections)).toBeNull()
  })
})
