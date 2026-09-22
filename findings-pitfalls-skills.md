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

## 10. Tooling: never issue parallel edits to the same file

Two `edit_file` calls to one file in a single block race: one edit's content is
silently lost and stray duplicated lines (`rts) module.exports…`) can appear.
Same-file edits must be sequential; parallel calls are only safe across files.
