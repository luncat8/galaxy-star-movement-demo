# Findings, pitfalls, skills

Notes for LLM agents working in this repo. Concrete, hard-won, checkable.

## 1. Symplectic leapfrog punishes force discontinuities

Any hard branch in the force — a radial cutoff (`if (R < 8)` skip), a hard-frozen
spiral phase (`max(R, r1)`) — injects O(dt) errors on every crossing and shows up as
Jacobi drift of 1e-2 instead of 1e-4. Fixes that worked:

- No radial cutoffs on modes, ever. If a cheap path is needed, taper smoothly in
  BOTH accel and potential (they must stay consistent — the EJ diagnostic uses the
  potential while the dynamics uses the accel).
- Freeze spiral winding with a C1 smoothstep (`spiralLD` in galaxy.js: L and dL/dR
  across r1±0.3), not `max()`.

## 2. Diagnose integrator drift with a per-star outlier table

When a max-drift gate fails, print the worst stars as
(rel, abs, EJ0, class, min-R-over-run). The pattern names the mechanism:

- small |EJ0| + large R → denominator cancellation (near resonances), not a bug;
- offenders clustered at one radius → force kink there (found the r1 freeze this way);
- offenders at large R only in one mode → cutoff discontinuity (found the R<8 bug).

Median drift ~1e-6 with a few 1e-3 outliers almost always means localized
non-smoothness, not a bad integrator.

## 3. Two pattern speeds: gate single-pattern + shadow, never energy slope

With bar+spiral there is no conserved energy or Jacobi integral — the patterns do
physical work. The discriminating experiment: run dt and dt/2; identical energy drift
(= our case, 1.27e-4 vs 1.28e-4/tu) proves the drift is physics, not numerics.
Gates used: per-pattern max|ΔEJ|/|EJ| < 2e-3, plus a dt-vs-dt/2 shadow run
(median |dx| < 5e-4 at T=30).

## 4. Leapfrog reversal is flip-v-plus-forward-steps, and still wrong for driven fields

`step(-dt)` after flipping v integrates backwards along the trajectory's *tangent*,
i.e. continues forward — the reverse map uses +dt. And with an explicitly
time-dependent potential you must additionally mirror time in the force evaluation.
Don't test driven systems with reversibility; use shadow convergence (§3).

## 5. Calibrate test metrics against their noise floors

- Histogram-profile L2 has a Poisson floor (≈9% for N=4000 in 20 radial bins).
  Always run an axisymmetric control alongside; gate the control tight (proves the
  integrator clean) and the pattern run loose (bounded physical evolution).
- Relative metrics on near-zero means are garbage (mean E ≈ 0.08 by disk/halo
  cancellation made a 1e-4/tu physical drift look like failure). Prefer absolute,
  shadow, or per-star-floored metrics.
- Epicycle frequency from zero-crossing *counts* is biased at half-integer cycle
  numbers (measured 3.7% off); use crossing-time *intervals* (measured 0.00% off).

## 6. Sample near-equilibrium DFs or pay in settle time

- Halo uniform in r sagged 30% post-settle; r^-1.5 number profile over [0.8, 7] with
  isotropic 0.5 dispersions is near-stationary.
- Settle must extend past the pattern ramp (15 tu ramp + 10 tu at full strength):
  bar capture rearranges the inner disk and needs full-strength phase-mixing, else the
  first seconds of the demo visibly contract.
- Diagnose per class (median R(t) by class, patterns vs axisym): separates DF
  transients (also present in axisym) from pattern effects.

## 7. Bar-response aperture: annulus + disk classes, or x2 cancels x1

Inside the ILR, x2 orbits run perpendicular to the bar and cancel the x1 signal;
the round bulge dilutes it. Measure bar-frame m=2 over disk classes in 0.6<R<1.9:
amp 0.185, misalign 1.5°. Over all stars R<1.8 the same run reads 0.096 — same
physics, wrong aperture.

## 8. Vertical heating: thicken the mode, not weaker arms

Thin vertical mode profiles (zs=0.3) heat the disk fast. zs=0.5 keeps (slightly
stronger) in-plane arms while halving dZ/dz forcing. Heating saturates slowly, so
always check T=300, not just T=100, before accepting an amplitude.

## 9. Hot-path trig/log budget (measured 1.5 ms per 10k-substep in V8)

- One `ln R` per star per substep: derive ln(R/r1) = ln(R/rp) + ln(rp/r1) with the
  constant precomputed.
- Precompute the inner-branch (R<r1) spiral sin/cos once per substep.
- cos2φ/sin2φ algebraically from x, y — never atan2 per star.
- Result: 10k × 10 substeps ≈ 15 ms/frame in node; default N=4k for 60 fps headroom.

## 10. Isotropic dispersions make half the bulge/halo retrograde — fold vφ

Sampling vx, vy, vz as independent Gaussians puts ~50% of bulge/halo stars on
Lz<0 orbits: visibly wrong, a fifth of the galaxy counter-rotating. Fix: convert
to cylindrical at the star's position and take |vφ| (`foldPrograde`). |v|² is
unchanged so the energy DF — and hence equilibrium — is untouched; only Lz folds.
A few % flip back later by real resonant torque; that is physical, not a bug.
Gated by `check-ics` (<1% retrograde at init).

## 11. Two pattern speeds beat and kill structures — corotate the pair

Bar at Ωb + spiral at Ωs makes the stellar response beat at 2(Ωb−Ωs) (measured
bar amplitude swinging 0.04↔0.26 every ~20 tu) and grinds the disk via overlapping
resonances (bar OLR sat exactly on spiral CR). Setting Ωs = Ωb (bar-driven spiral)
makes the field static in one frame: response steady, heating saturates low
(σR ≈ 0.20 vs 0.27), EJ conserved again, corot view freezes both patterns. The Ωs
slider stays as a beating experiment. Lesson: with test particles, one pattern
speed is not a simplification, it is the stability mechanism.

## 12. Wide-annulus m=2 amplitude lies across corotation

Response phase jumps across CR, so averaging exp(2iψ) over R = 2–4 partially
cancels and fakes a slow decay (0.25→0.09) while local arm contrast stays ~1.2
forever. Always measure response in narrow annuli (or ψ-binned contrast at fixed
R). `check-response` gates narrow-annulus amplitude + contrast, never wide.

## 13. Cold disks + ramped patterns = violent transient → heat 4× in settle

A σR=0.07 disk hit by a 15-tu ramp rings coherently, then phase-mixes to σR≈0.28.
Cure: start warmer (σR=0.12 — near the driven equilibrium ≈0.20, so the transient
is gentle) + slower ramp (tramp=20). Longer ramps do NOT remove libration bunching
(separatrix periods diverge), so expect mild post-settle relaxation and gate the
steady value, not the peak.

## 14. Jacobi max-gates are hostage to single plunging orbits

One dead-center halo plunge (rmin≈0.00) takes a bounded 1e-3 EJ kick while the
median sits at 2e-6. Gate p99 < 2e-3 + max < 1e-2 instead of max < 2e-3: tests the
integrator, not the luck of the random draw.

## 15. Tooling: never issue parallel edits to the same file

Two `edit_file` calls to one file in a single block race: one edit's content is
silently lost and stray duplicated lines (`rts) module.exports…`) can appear.
Same-file edits must be sequential; parallel calls are only safe across files.

## 16. Steady test-particle arms live ILR→CR only; map (R,psi) to see it

(R,psi) density maps (psi = azimuth in spiral-potential frame) diagnose arm
zones unambiguously: vertical ridges = arms tracking the wave, horizontal
bands = rings, scatter = disorganized. Found: strong inner response, a
horseshoe gap at CR (width ~sqrt(Phi_a/Omega), cold stars avoid CR itself —
a real dynamical gap, not a bug), and NO organized response CR→OLR at any
tested amplitude (0.02–0.06): small De + strong forcing = nonlinear
overdrive. Lower amplitude weakens inner arms without organizing the outer
disk, so envelope tapers can't fix it. Consequence: put the clean zone where
it shows (pattern speed sets ILR/CR/OLR together) and gate arms in
phase-coherent narrow annuli (bar→spiral phase twist near R~1.5 at Om=0.36
splits the zone; measure inside one side).

## 17. Rejected: peculiar-velocity cooling (AM pump) and Lin-Shu ICs (no-op)

- A Langevin thermostat on peculiar velocities pins arms perfectly (amp
  0.65, contrast 3.5, sigmaR pinned) — but vp→vc(R_now) sampled on
  epicycle orbits pumps angular momentum: median Lz drifts x0.85–1.27/200tu
  with direction flipping by eta. Uncooled control migrates x~1.0, proving
  the drift is cooler artifact. Never balance physical torque against a
  tuned artifact; gate median Lz, not just median R.
- Lin-Shu forced-epicycle ICs (full X/Y derivation, regularized at CR/OLR)
  changed nothing (fade 0.59 vs 0.60): the settle transient is separatrix
  capture during ramp, not initial-condition mismatch. Slower ramp (20→40)
  also identical. Only colder starts + trapping statistics move the needle.
- Bonus: removing the bar makes spiral fade WORSE (0.56 vs 0.71) — the
  bar-driven spiral organizes, not just perturbs. Don't "decouple" by
  deletion.

## 18. Pattern-speed moves ILR into the bar: check twist-vs-R, not just mean

Om 0.40→0.33 widened the arm zone but dragged ILR to 0.83 and twisted the
1.0–1.25 bar response 29° (strong component → mean misalignment 23°, gate
fail). Bar-frame m=2 phase-vs-R in 0.25 slices names the culprit slice;
Om=0.36 (ILR 0.72, CR 2.57, OLR 4.03) is x1-clean over 1.0–2.3 with the gap
pushed outward. Rule: any Om change re-validates BOTH the arm zone and the
bar twist profile; keep the bar aperture above the ILR.

## 19. Headless PNG renders without a browser (node+zlib, ~40 lines)

No canvas in the sandbox: replicate the page sprite loop (class colors,
alpha/size, tilt projection, additive accumulation into Float32 RGB) and
encode PNG via zlib.deflateSync + hand-rolled IHDR/IDAT/IEND with CRC32.
Soft-clip tone map (v/(v+k)) for the core. Good enough to judge arm/bar/
ring morphology and background dilution at settle vs T=150. Deterministic
same-seed physics ⇒ renders are comparable across parameter changes; fix
the bar phase (or note Om*T) when comparing snapshots.
