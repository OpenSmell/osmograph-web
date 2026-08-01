# OSMELL Format Specification

**Version:** 1.0.0 · **Status:** Draft for review
**Authors:** OpenSmell project
**Format extension:** `.osmell`
**MIME type:** `application/vnd.opensmell.osmell` (alias: `application/x-osmell`)

---

## 1. Overview

The OSMELL format ("Open Smell Exchange format") is a **sensor-agnostic
container** for electronic-nose (e-nose) recordings. A single `.osmell` file
holds:

- the **raw time-series data** recorded from the sensor array,
- a **machine-readable manifest** describing the device, channels, sampling
  rate, and recording session,
- an explicit record of the **baseline / target protocol** that makes MOX
  (metal-oxide semiconductor) measurements comparable *across devices, across
  days, and across operators*,
- an optional **data-quality report** computed from the recording itself.

The format is deliberately boring: a ZIP archive containing one CSV and one
JSON file. Everything inside is plain text, inspectable with any unzipper, and
reproducible without proprietary software. The rigor lives in the *manifest
conventions* and the *quality scoring rules*, not in a binary envelope.

### 1.1 Design goals

1. **Sensor-agnostic.** The container stores data and metadata; all
   sensor-specific math lives in processing pipelines keyed by `sensorType`.
   Today that is MOX kinetics; the same file opens a MIRIS spectral array or an
   electrochemical cell tomorrow.
2. **Explicit sessions.** Baseline and exposure are recorded and labeled
   *separately and explicitly*. No software ever guesses which part of a
   continuous stream was "the baseline".
3. **Session-invariant.** With a recorded baseline, `R0`, MOX responses
   normalize to a device-agnostic relative signal `(R − R0)/R0`, making
   recordings comparable across hardware revisions and ambient conditions.
4. **Rigorously documented.** Every header, unit, and scoring formula is
   defined below with no hidden magic numbers.
5. **Easy.** Creating a file is one ZIP write; reading it is one ZIP read plus
   one CSV parse. The Import Wizard in Osmograph Web produces valid files
   from loose vendor CSVs in a few clicks.

### 1.2 Format at a glance

```
coffee_2026-08-01.osmell
├── manifest.json          (required) — format version, device, channels, session
├── data.csv               (required) — time-series samples
├── baseline.csv           (optional) — explicit baseline recording, when recorded separately
├── events.json            (optional) — labeled intervals (e.g. exposure window, annotations)
└── quality.json           (optional) — computed quality report (see §7)
```

All member files are stored **uncompressed or deflate-compressed** per the ZIP
spec. Filenames are case-sensitive and exactly as listed above.

---

## 2. Naming and registration

- Extension: **`.osmell`** (lowercase). No other extension is used.
- MIME type: `application/vnd.opensmell.osmell`.
- An `.osmell` file is a valid ZIP archive (`PK\x03\x04` magic). Readers MUST
  verify the ZIP magic before attempting a parse.

Rationale: `.osm` is registered to OpenStreetMap, `.osx` to Apple, and `.mox`
is claimed by unrelated vendors — the OpenSmell ecosystem uses a name it owns.
Version 1.0.0 is a successor to the informal v1.0 CSV convention used by
Osmograph desktop (`timestamp_ms, VOC, Alcohol, LPG, CO, NO2, C2H5OH`).

---

## 3. Container and file layout

### 3.1 The ZIP archive

A `.osmell` file MUST be a ZIP archive containing at least:

- `manifest.json`
- `data.csv`

Readers MUST tolerate the presence of extra, unknown members and MUST preserve
them on round-trip (re-export keeps unknown members). This is the extension
mechanism: future revisions add members, older readers still parse the core.

### 3.2 Manifest (`manifest.json`)

The manifest is a single JSON object, UTF-8, no trailing comments. Unknown
fields are allowed and MUST be preserved by re-exporters (see §9 forward
compatibility).

```json
{
  "osmell": {
    "formatVersion": "1.0.0",
    "specUrl": "https://github.com/opensmell/osmograph-web/blob/main/OSMELL_FORMAT_SPEC.md"
  },
  "sensor": {
    "sensorType": "mox",
    "device": {
      "model": "Osmograph v1",
      "serial": "Osmograph-A1B2C3",
      "firmware": "0.4.0"
    },
    "channels": [
      { "id": "VOC",    "unit": "adc", "target": "VOC"   },
      { "id": "Alcohol","unit": "adc", "target": "Ethanol"},
      { "id": "LPG",    "unit": "adc", "target": "LPG"    },
      { "id": "CO",     "unit": "adc", "target": "CO"    },
      { "id": "NO2",    "unit": "adc", "target": "NO2"   },
      { "id": "C2H5OH", "unit": "adc", "target": "Ethanol"}
    ],
    "samplingRateHz": 10.0,
    "adcBits": 12,
    "adcMax": 4095,
    "timeColumn": "timestamp_ms"
  },
  "session": {
    "role": "exposure",
    "label": "coffee",
    "groupId": "c8f3a9c1-7b2e-4f5d-9a6b-1e2f3a4b5c6d",
    "recordedAt": "2026-08-01T04:00:00.000Z",
    "durationMs": 60000,
    "notes": ""
  },
  "baseline": {
    "source": "auto",           // "explicit" | "auto" | "none"
    "file": "baseline.csv",     // present when source == "explicit"
    "r0Samples": 15
  },
  "software": {
    "recorder": "Osmograph 0.4.0",
    "importer": "Osmograph Web 0.1.0"
  }
}
```

#### 3.2.1 `osmell` object (required)

| Field          | Type   | Required | Meaning                                    |
| -------------- | ------ | -------- | ------------------------------------------ |
| `formatVersion`| string | yes      | This spec version, e.g. `"1.0.0"`.         |
| `specUrl`      | string | no       | Canonical URL of the spec this file conforms to. |

#### 3.2.2 `sensor` object (required)

| Field             | Type     | Required | Meaning                                                             |
| ----------------- | -------- | -------- | ------------------------------------------------------------------- |
| `sensorType`      | string   | yes      | One of: `mox`, `miris`, `electrochemical`, `other`, `unknown`.      |
| `device.model`    | string   | no       | Human-readable device model.                                        |
| `device.serial`   | string   | no       | Device serial, e.g. ESP32 AP name `Osmograph-XXXXXX`.               |
| `device.firmware` | string   | no       | Firmware version.                                                   |
| `channels`        | array    | yes      | Ordered list of channel descriptors (see §4.1).                     |
| `samplingRateHz`  | number   | no       | Nominal sampling rate in Hz. Present if the device streams at a fixed rate. |
| `adcBits`         | integer  | no       | ADC resolution in bits.                                             |
| `adcMax`          | number   | no       | Full-scale ADC value. For a 12-bit ADC, `4095`.                     |
| `timeColumn`      | string   | yes      | Name of the timestamp column in `data.csv`: `timestamp_ms` or `elapsed_ms`. |

The pair `(adcBits, adcMax)` is informational; quality scoring (§7) uses
`adcMax` as the clipping bound. When absent, scoring falls back to a global
default of `4095` and the report MUST note the assumption.

#### 3.2.3 `session` object (required)

| Field        | Type   | Required | Meaning                                                                 |
| ------------ | ------ | -------- | ----------------------------------------------------------------------- |
| `role`       | string | yes      | One of: `baseline`, `exposure`, `single`. See §5.                       |
| `label`      | string | no       | Free-text sample label (e.g. `"coffee"`, `"empty_room"`).               |
| `groupId`    | string | no       | UUIDv4 linking this recording to a session family (baseline + exposures). |
| `recordedAt` | string | no       | ISO 8601 UTC timestamp of recording start.                              |
| `durationMs` | number | no       | Intended/recorded duration in ms.                                       |
| `notes`      | string | no       | Free text.                                                              |

#### 3.2.4 `baseline` object (optional)

| Field       | Type   | Required | Meaning                                                        |
| ----------- | ------ | -------- | -------------------------------------------------------------- |
| `source`    | string | yes      | `explicit` (linked baseline file), `auto` (auto-R0, §5.2), or `none`. |
| `file`      | string | no       | Member filename of the baseline recording; required if `source == "explicit"`. |
| `r0Samples` | integer| no       | Number of leading samples used for auto-R0. Default `15`.      |

#### 3.2.5 `software` object (optional)

| Field      | Type   | Meaning                                                    |
| ---------- | ------ | ---------------------------------------------------------- |
| `recorder` | string | Software/hardware that produced the recording.             |
| `importer` | string | Software that created this `.osmell` file from raw data.   |

### 3.3 Data (`data.csv`)

Tabular time-series data. Conventions:

- UTF-8, **no BOM**.
- First row is the header. Column names are unique, lowercase-tolerant, and match
  the `id` values in `sensor.channels` plus exactly one time column.
- The time column MUST be first. It contains integer milliseconds:
  - `timestamp_ms` — wall-clock epoch milliseconds (UTC). Preferred.
  - `elapsed_ms` — milliseconds since recording start.
- Data rows MUST be sorted ascending by the time column. Readers SHOULD reject
  or re-order unsorted files (re-order only when the full file is loaded and a
  warning is surfaced).
- Numeric values MUST be parseable as finite IEEE-754 numbers. `NaN`, `Inf`,
  and `-Inf` are invalid in data rows and count against the quality score (§7.3.1).
- Missing data is represented by **omitted rows** (a gap in the time column),
  never by sentinel values.

#### 3.3.1 Channel descriptors (`sensor.channels`)

Each entry:

| Field    | Type   | Required | Meaning                                                        |
| -------- | ------ | -------- | -------------------------------------------------------------- |
| `id`     | string | yes      | Column name in `data.csv`. Must match header exactly.          |
| `unit`   | string | yes      | Physical unit of the stored value. For MOX raw, `adc`.         |
| `target` | string | no       | Target analyte or role, e.g. `"VOC"`, `"CO"`, `"Ethanol"`.     |

`unit` is free-form but SHOULD be one of: `adc` (raw counts), `volt`,
`ohm` (measured resistance), `ppm`, `norm` (unitless normalized). Future
`mox` pipelines operate on `adc` or `ohm`; normalize *after* reading, never by
mutating the stored file.

### 3.4 Baseline file (`baseline.csv`, optional)

A separate recording of the pre-exposure (clean-air / reference) signal. It
has the **same** header as `data.csv`. Present when `session.role ==
"baseline"` (this file IS the baseline) or when `baseline.source ==
"explicit"` on an exposure file (this file holds the linked baseline).

### 3.5 Events (`events.json`, optional)

Array of labeled intervals used to delimit phases within one continuous
recording:

```json
[
  {
    "label": "exposure",
    "startMs": 5000,
    "endMs": 35000,
    "note": "lid opened"
  }
]
```

| Field     | Type   | Required | Meaning                             |
| --------- | ------ | -------- | ----------------------------------- |
| `label`   | string | yes      | Event/phase label.                  |
| `startMs` | number | yes      | Start offset in ms from first sample. |
| `endMs`   | number | no       | End offset in ms. Open-ended if absent. |
| `note`    | string | no       | Free text.                          |

Events exist to annotate *phases inside a single file*. The recommended
workflow still records baseline and exposure as **separate files** (§5.1);
events are the escape hatch for legacy single-file recordings.

---

## 4. Sensor-agnostic routing

`manifest.sensor.sensorType` selects the processing pipeline. The container
itself is identical for all sensor types; only interpretation differs.

| sensorType        | Pipeline intent                                                |
| ----------------- | -------------------------------------------------------------- |
| `mox`             | MOX resistance kinetics: R0 normalization, rise/decay, AUC, saturation index (§6). |
| `miris`           | Spectral absorption arrays (reserved; MIRIS hardware).         |
| `electrochemical`| Amperometric/potentiometric cells (reserved).                  |
| `other`/`unknown` | Generic pass-through: no normalization applied, quality limited to basic checks. |

Readers MUST NOT infer `sensorType` from channel names alone. When the field is
missing, treat as `unknown` and surface a warning.

---

## 5. Session protocol

MOX sensors are temperature- and humidity-sensitive. Two recordings of the same
odor on different days can look very different in raw counts while being
identical after baseline normalization. The session protocol makes that
normalization **explicit and verifiable**.

### 5.1 Recommended workflow (separate files)

1. Record a **baseline** — the array's response to the reference condition
   (typically clean air / empty chamber) immediately before the experiment.
   Mark it `role: "baseline"`.
2. Record one **exposure** per sample — `role: "exposure"`, `label` set to the
   sample name.
3. All recordings in one experimental session share the same `groupId`.

Baseline and exposure are recorded *separately and explicitly*. No phase
detection, no midpoint-splitting heuristics, no guessing.

### 5.2 Import Wizard accommodation (single files)

When a user only has one continuous file that contains baseline-then-exposure,
Osmograph Web's Import Wizard performs an explicit **midpoint split** at a
user-confirmed boundary and writes *two* `.osmell` files with a shared
`groupId`. The split boundary is always human-confirmed; the software never
auto-detects phases.

### 5.3 Auto-R0

If no baseline file exists, pipelines may use **auto-R0**: `R0` is the median
of the first `r0Samples` samples of the channel (default `15`, i.e. ~1.5 s at
10 Hz). This matches the reference SDK convention and is only valid when the
first samples are known clean-air conditions. Files that use auto-R0 MUST
declare `baseline.source: "auto"` so downstream consumers know the provenance
of `R0`.

---

## 6. MOX normalization and features

### 6.1 Definitions

For channel values `x[0..N-1]` and baseline `R0`:

```
R0   = median of the baseline recording (per channel), or
       median of x[0..r0Samples-1] when baseline.source == "auto"

normalized[i] = (x[i] − R0) / R0
```

- `normalized[i]` is unitless and device-agnostic: it is the *relative change*
  in sensor signal against its reference.
- The ratio `(R − R0)/R0` is the canonical MOX response measure and is
  insensitive to multiplicative gain drift and to the specific baseline
  resistance of the individual sensor element.

### 6.2 Dead-sensor guard

A channel is considered **dead** when its coefficient of variation over the
whole recording is negligible:

```
cv = std(x) / R0   (R0 > 0)
dead  ⟺  cv < 0.001
```

Dead channels MUST be excluded from derived features and MUST be flagged in the
quality report. This mirrors the reference SDK guard.

### 6.3 Feature framework (informative)

The reference feature framework extracts 187 features per recording, including:

- **Relative amplitude** `max|(x − R0)/R0|` and response direction.
- **Rise time / decay time**: time to cross 10%–90% of the full response span.
- **AUC**: time integral of the normalized response over the recording.
- **Saturation index**: fraction of samples clipped at `adcMax` or `0` (§7.3.4).
- **Multi-exponential decay fits** for recovery modeling.

These features are consumed by classification pipelines (the Osmograph desktop
app ships RandomForest and LogisticRegression trainers). The `.osmell` file
stores *raw data*, never pre-computed features, so features can always be
recomputed from source. Pre-computed values may be cached in `quality.json` or
`features.json` as a convenience, and MUST be labeled as derived.

---

## 7. Data-quality scoring

The quality report (`quality.json`) is a 0–100 score composed of five
sub-scores, each defined by an explicit, hard-to-vary formula. It is computed
**from the recording itself** and requires no external truth — the same file
scored by any conforming implementation yields the same numbers to numerical
precision.

### 7.1 Sub-scores

#### 7.1.1 Continuity `C` (weight 0.20)

Measures adherence to the nominal sampling schedule using only interior
inter-sample gaps. Let the time column have `N` values `t[0..N-1]` and nominal
period `T = 1000 / samplingRateHz` ms (when declared). Define interior gaps
`g[k] = t[k+1] − t[k]`. A gap is **regular** when it is within 10% of the
nominal period:

```
regular(k) ⟺ |g[k] − T| ≤ 0.10 · T
C = 100 · (count of regular gaps) / (N − 1)
```

If `samplingRateHz` is not declared, `T` is taken as the **median** gap and the
score reflects *regularity of whatever schedule the file actually uses*; the
report MUST note this. `C` is capped at 100. A file with a single sample
(`N = 1`) scores `C = 100` (no gaps to penalize) but is heavily penalized by
Duration below.

#### 7.1.2 Dynamic range `D` (weight 0.15)

Per channel, how much of the usable ADC range the signal actually occupies.
With full-scale `M = adcMax` (default 4095) and observed channel min/max:

```
span_k = (max(x) − min(x)) / M
D_k    = 100 · clamp(span_k · 10, 0, 1)      // ≥10% span ⟹ full marks
D      = mean over channels
```

Dead channels (cv < 0.001, §6.2) are excluded from the mean and counted toward
the Dead Sensors flag.

#### 7.1.3 Saturation-free `S` (weight 0.15)

Fraction of samples **not** clipped at either rail, per channel, averaged:

```
clipped_k  = count( x[i] ≥ adcMax OR x[i] ≤ 0 )
S_k        = 100 · (1 − clipped_k / N)
S          = mean over channels
```

If `adcMax` is unknown, clipping at the upper rail is not detectable and only
the lower rail (`≤ 0`) counts; the report MUST note this.

#### 7.1.4 Baseline stability `B` (weight 0.20)

Scored only when an R0 is available (explicit baseline or auto-R0). Uses the
window from which R0 was taken (the baseline recording, or the first
`r0Samples` of the exposure):

```
cv_window = std(window) / R0          (R0 > 0)
B = 100 · clamp(1 − cv_window / 0.05, 0, 1)
```

A window whose coefficient of variation is ≥5% scores zero (too noisy to trust
R0); a dead-flat window scores 100. When no R0 is available, `B = 0` with
reason `no_baseline`.

#### 7.1.5 Signal strength / SNR `G` (weight 0.20)

Only meaningful for `role: "exposure"` with an R0. For each non-dead channel,
take the peak absolute normalized response and compare it to the R0-window
noise:

```
peak_k   = max_i |(x[i] − R0) / R0|
noise_k  = std(window) / R0            (same window as B)
SNR_k    = peak_k / max(noise_k, 1e-6)

G_k      = 100 · clamp(SNR_k / 10, 0, 1)     // SNR ≥ 10 ⟹ full marks
G        = max over channels (strongest channel is the meaningful signal)
```

For `role` other than `exposure`, or when no R0 exists, `G` is reported as `null`
and excluded from the total (§7.2), with reason `no_exposure_signal`.

#### 7.1.6 Duration adequacy `T` (weight 0.10)

MOX kinetics need enough samples for rise/decay analysis. With `N` samples and
nominal rate `samplingRateHz`:

```
t_seconds = (N − 1) / samplingRateHz
T = 100 · clamp(t_seconds / 60, 0, 1)    // ≥60 s ⟹ full marks
```

If the rate is undeclared, the median gap is used to estimate `t_seconds`.

### 7.2 Total score and badge

```
weights = { C: 0.20, D: 0.15, S: 0.15, B: 0.20, G: 0.20, T: 0.10 }
sum_w   = Σ w_i over non-null sub-scores
score   = round( Σ w_i · sub_i / sum_w )
```

`G` is null for non-exposure roles; all other sub-scores are always present.

| Score range | Badge       | Guidance                                    |
| ----------- | ----------- | ------------------------------------------- |
| 90–100      | Excellent   | Ready for analysis and publication.         |
| 75–89       | Good        | Ready; review flagged notes first.          |
| 50–74       | Fair        | Usable with caveats listed in the report.   |
| 0–49        | Poor        | Investigate hardware/protocol before use.   |

### 7.3 Report shape

```json
{
  "format": "opensmell-quality",
  "version": "1",
  "computedAt": "2026-08-01T04:05:00.000Z",
  "total": 87,
  "badge": "Good",
  "subscores": {
    "continuity": 92, "dynamicRange": 81, "saturationFree": 100,
    "baselineStability": 88, "signalStrength": null, "durationAdequacy": 74
  },
  "flags": {
    "deadSensors": ["NO2"],
    "unsortedRows": false,
    "nonFiniteSamples": 0,
    "usedDefaultAdcMax": false,
    "usedMedianSamplingRate": false
  },
  "reasons": {
    "baselineStability": "r0_window_cv_too_high",
    "signalStrength": "no_exposure_signal"
  },
  "notes": []
}
```

Every sub-score MUST carry the reason it was reduced below 100, so the report
is self-explanatory. `flags` mirror the hard-to-vary checks and are the
machine-readable equivalent of the notes.

---

## 8. Validation rules

A conforming **reader** MUST:

1. Verify the ZIP magic (`PK\x03\x04`).
2. Require `manifest.json` and `data.csv` members.
3. Parse `manifest.json` as UTF-8 JSON; on failure, reject the file with a
   parse error (no partial data).
4. Require `osmell.formatVersion` and `sensor.sensorType`; on `"unknown"`
   sensorType, proceed but surface a warning.
5. Verify the `data.csv` header matches `sensor.channels[].id` plus exactly one
   time column named by `timeColumn`.
6. Parse all sample values as finite numbers; non-finite values are a data
   defect counted against Continuity–Saturation checks and logged in flags.
7. Sort-check the time column; reject out-of-order files unless an explicit
   re-order policy is enabled with a surfaced warning.

A conforming **writer** MUST:

1. Write members in the exact casing listed in §1.2.
2. Write `data.csv` with `\n` row endings, `\r\n` accepted on read.
3. Emit `session.role`, `session.label` (when the user supplied one), and a
   shared `groupId` across a split session.
4. Never write non-finite values into `data.csv`.
5. Preserve unknown members and unknown manifest fields on re-export (§9).

---

## 9. Extensibility and versioning

- **Backward compatibility.** Readers implementing this spec MAY read any file
  whose `formatVersion` has the same major version (`1.*`). Unknown manifest
  fields and unknown archive members are ignored but preserved.
- **Forward compatibility.** Writers MUST preserve unknown fields/members they
  do not understand, so a newer tool's annotations survive an older tool's
  re-export.
- **Major versions** (e.g. `2.0.0`) may change required fields or the scoring
  formulas; they are opted into explicitly by the reader.

---

## 10. Reference implementations

| Implementation | Repository                         | Status    |
| -------------- | ---------------------------------- | --------- |
| Osmograph desktop (Python) | `github.com/opensmell/osmograph`  | Current recorder; emits legacy CSV, upgraded via Import Wizard. |
| OpenSmell SDK (Python)     | `opensmell/opensmell`             | Feature framework; consumes CSV.      |
| Osmograph Web (TypeScript) | this repository (`osmograph-web`) | Reference parser, scorer, writer.    |

---

## Appendix A. Legacy CSV upgrade path

Legacy Osmograph CSVs use the header
`timestamp_ms, VOC, Alcohol, LPG, CO, NO2, C2H5OH` with 12-bit ADC values.
The Import Wizard converts these to `.osmell` by:

1. Reading the header into `sensor.channels` with `unit: "adc"` and
   `adcBits: 12`, `adcMax: 4095`, `timeColumn: "timestamp_ms"`.
2. Guessing `samplingRateHz` from the median gap, noting it in the report.
3. Asking the user for `role`, `label`, and (for exposure files) whether a
   baseline exists; linking baseline/exposure with a shared `groupId`.
4. Midpoint-splitting single files containing baseline+target at a
   user-confirmed boundary.

## Appendix B. Example file (minimal)

A minimal baseline recording:

```
$ unzip -l coffee.osmell
  manifest.json
  data.csv

$ cat data.csv
timestamp_ms,VOC,Alcohol,LPG,CO,NO2,C2H5OH
1750000000000,2048,2010,1998,2005,2022,2033
1750000000100,2049,2011,1998,2006,2021,2033
...
```

With `manifest.json` declaring `role: "baseline"`, `samplingRateHz: 10`,
`channels` matching the header, and `session.groupId` shared with the
corresponding exposure files.

---

*This document is the single source of truth for the `.osmell` format. Issues
and pull requests are welcome in `github.com/opensmell/osmograph-web`.*
