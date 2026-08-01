# Osmograph Web (osmograph-web)

The web analytics platform for MOX e-nose sensor data, served at
**mox.opensmell.xyz**. Import loose CSVs, normalize against a baseline, score
data quality, and export the `.osmell` format.

## What it does

- **Import** — drop a CSV from your Osmograph, ESP32, or any MOX array (or an
  existing `.osmell` file) and channels are detected automatically.
- **Normalize** — computes per-channel `R0` (explicit baseline or SmellNet-style
  auto-R0) and the session-invariant response `(R − R0)/R0`.
- **Score** — produces a verifiable 0–100 data-quality score across continuity,
  dynamic range, saturation, baseline stability, signal strength, and duration,
  per the OSMELL format spec (§7).
- **Export** — writes a compact, self-describing `.osmell` container
  (ZIP: `manifest.json` + `data.csv`).

## The OSMELL format

`OSMELL_FORMAT_SPEC.md` is the single source of truth for the `.osmell` file
format: sensor-agnostic container, explicit baseline/target session protocol,
session-invariant normalization, and hard-to-vary quality scoring. It is
designed to be the successor to Osmograph's legacy CSV convention and to back
future paper revisions and official documentation.

## Stack

- Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4
- Theme tokens shared with `opensmell-web` (dark-default oklch neutral palette,
  zero radius, Geist, hex motif)
- `lib/osmell/` — framework-agnostic core: CSV parser, `.osmell` parser/writer
  (jszip), normalization, quality scorer, and the `sensor_type` processor router
- shadcn/ui components

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — `/` redirects to `/mox`.

## Development

```bash
npm run lint    # eslint
npx tsc --noEmit  # typecheck
npm run build   # production build
```

The `lib/osmell` core is intentionally pure TypeScript (no React) so it can be
reused by CLI tooling and future pipelines. Extend the processor router in
`lib/osmell/processors.ts` when adding a new `sensorType`.
