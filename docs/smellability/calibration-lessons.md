# Smellability — Calibration Lessons

**What this documents:** what the OpenSmell lab experiments taught us about calibration, and how those lessons constrain what a web verdict may and may not claim. Every Smellability verdict is a *physical feasibility grade*, not a calibrated measurement — these findings are why.

---

## 1. Affine calibration is a documented dead end on real data

- An affine transform (per-sensor gain + offset) works on controlled multi-batch data (UCI Gas Sensor Array Drift dataset, >0.95 accuracy) but **failed on real cross-device data: accuracy fell 47% → 33%** after calibration. See `research/calibration-experiments/uci-affine/`, `research/calibration-experiments/affine-calibration-failed/`, and `OpenSmell-Legacy/TECHNICAL.md` §4.1.
- Root cause identified in `TECHNICAL.md` §4.1: *"The calibration failures share a cause: they assume a mathematical form for the mapping between devices or sessions. The affine approach assumed linearity."*
- **Web consequence:** the Smellability engine never claims to output a calibrated ppm. Saturated headspace ppm is a *thermodynamic estimate* ("if the sensor were ideal and the chamber enclosed"), and the verdict text says "rated to resolve roughly…", not "measures…". Any future Import Wizard step must store raw baselines, not absolutes.

## 2. Pure-anchor calibration cannot cover odorant space

- A convex-hull analysis (`Chemoprint/validation/convex_hull.py`, summarized in `Chemoprint/README.md` §6) shows six pure compounds (methanol, hexane, acetone, acetic acid, toluene, isopropanol) cover only **~0.1%** of 4,565 common odorants in the GoodScents database. Pure-anchor calibration is therefore **not viable**.
- **Web consequence:** the web on-ramp does not ship a "calibrate me to these six bottles" flow. Instead it ships a *contribution* loop: users record labeled exposures and the community dataset grows. This is a deliberate architectural answer to a measured calibration failure.

## 3. Session invariance comes from learning, not formulas

- The universal encoder's 1D-CNN, evaluated on held-out *measurement sessions* (entire recording days never seen in training), reached **81.78% accuracy / 80.33% macro-F1** against a pre-registered >70% threshold (random baseline 2%). `OpenSmell-Legacy/TECHNICAL.md` §4.2, `SmellNet` dataset.
- The learned latent space is **session-invariant for substances in the training set** — it is *not* assumed to generalize zero-shot to unseen chemistry across arbitrary hardware.
- **Web consequence:** the chain's array-capacity table (feasibility-chain.md Step 5, from `interoperability/canonical_experiments/generate_tables.py` Table 2) is a capacity bound that assumes *labeled sessions*. The verdict's `crossCheck` block is explicit: "Cross-sensitivity to your library is unknown until you add labeled sessions."

## 4. Effective dimensionality is far below sensor count

- Real MOX sensors covary: two same-family MOX sensors have effective dimensionality ~1; three MOX sensors ~1.5–2; four ~2–3 (`../../../private/OPENSMELL_MASTER.md` §6). Humidity is a common-mode signal across SnO₂ channels.
- This is why the canonical Table 2 (3 → 4–6, 6 → 20–40, 12 → 200–400, 24 → 10,000+ distinguishable substances) is conservative and why `MAX_SUBSTANCES` in `lib/smellability/constants.ts` uses the top of each range with 4/5 interpolated.
- **Web consequence:** the verdict does not promise that N sensors distinguish everything — it grades a single substance and flags *label overlap* with the user's existing library. Distinguishing chemically similar compounds (isomers such as limonene vs pinene) is explicitly out of scope for small arrays.

## 5. Drift, batch variance, and humidity set the capture rules

- Sensor drift can break decision boundaries within days without recalibration; batch-to-batch sensitivity varies ±20% for the same part number (`../../../private/OPENSMELL_MASTER.md` §6).
- **Web consequence:** the chain's `guidance()` always prescribes the capture protocol (clean-air baseline → exposure → recovery) and the verdict's guidance text varies with the expected signal (short exposures for strong/fast, maximized headspace + long windows for weak/slow). The `crossCheck` and guidance text together tell the user *how* to record so the labels stay usable across sessions — the closest thing the web layer can do to "calibration" without hardware assumptions.

## 6. Normalization & preprocessing findings

- z-score normalization beats Rs/R₀ for encoder input; paradigm (temporal/device-agnostic) features outperform statistical features on cross-device tests (`research/calibration-experiments/README.md`, `run_rsr0.py`, `run_ablation.py`).
- **Web consequence:** the `.osmell` format must preserve raw values plus baseline structure so any client can apply its preferred normalization. The 7-subscore quality taxonomy (Continuity, Dynamic range, Saturation-free, Baseline stability, SNR, Recovery completeness, Duration) exists precisely to score whether a recorded session can support cross-session comparison.

## 7. What a Smellability verdict is and is not

| The verdict **is** | The verdict **is not** |
|---|---|
| Physical feasibility: will the substance produce a detectable MOX response (volatility × redox) | A calibrated concentration measurement |
| A capacity grade: can an N-sensor array resolve this within your labeled library | A guarantee of mixture decomposition |
| Honest uncertainty: `low`/`medium` confidence when properties are estimated or unknown | A promise across unseen devices or unlabeled sessions |
| Actionable capture guidance tuned to expected signal | A replacement for the recorder's baseline/exposure/recovery protocol |

The engine never fabricates missing data and never upgrades an estimate to a measurement. These limits come directly from measured failures in the lab — they are features, not omissions.

---

## References

- `../../../OpenSmell-Legacy/TECHNICAL.md` — affine failure (47%→33%), session-invariance proof, learned-latent rationale
- `../../../research/calibration-experiments/` — affine vs real-data failure, z-score vs Rs/R₀, paradigm features
- `../../../Chemoprint/README.md` §6 — convex-hull / pure-anchor coverage limit
- `../../../private/OPENSMELL_MASTER.md` §6 — effective dimensionality, drift, batch variance, humidity common-mode
- `../../../interoperability/canonical_experiments/generate_tables.py` — Table 2 capacity ranges, Table 3 MOX boundaries
- `../../../private/OPENSMELL_MASTER.md` §8 — audit of these negative results (affine-calibration-failed confirmed)
