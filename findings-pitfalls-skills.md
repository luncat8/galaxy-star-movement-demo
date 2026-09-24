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

## 20. Judge IC experiments on renders + per-class, not all-disk annulus means

S2 kinematic-aligned ICs: all-disk narrow-annulus m=2 amps were nearly
identical align=0 vs align=1, yet the renders differ sharply at settle
(connected ridges vs detached clumps). A smooth aligned ellipse field DILUTES
per-annulus contrast while improving arm connectivity — amp/phase metrics see
"no change", eyes see the product. Conversely the committed young=1.3x seeding
looked fine in band means but halved the young disk's own outer response
(0.37->0.20) and washed the T=150 render. Rules: (a) for IC/initial-structure
changes, gate on same-seed headless render A/B at settle/T=75/T=150; (b) run
per-class profiles — the coldest population dominates the visual and already
IS the strongest spiral response; never seed over it (alignYoung 0), seed only
the warm classes that can't organize themselves; (c) when a measurement
contradicts another from the same script, bit-compare the untouched subset
(deterministic seeds make this exact) before trusting either.

## 21. sed-renaming params across scripts: run the suite before committing

A batch `P.align = 0;` insert left one copy at top level of check-jacobi.js
(`P` undefined there) — committed with the gate crashing. Any param-plumbing
sweep across experiments/ must end with a full `for f in check-*.js; do node
$f; done` before commit; a red suite is part of the diff.

## 22. A density crest must ADD a potential well — mind the feedback phase

Measuring an m=2 moment as `A e^{i psi}` puts its crest where `2(phi - psi) = 0`.
Writing the force as `cos(2(phi - psi) - theta)` with `theta = psi` places the
potential crest ON the density crest, i.e. the feedback REPELS its own arms.
Symptom found the hard way: median R drifts UP (x1.075) and an artificial hole
opens exactly where the arms were. Store `theta = psi + pi` (the well sits at
the crest) and verify on the state the table was built from: the table phase
agrees with an independent moment measurement to 0.35 rad, not to pi.

## 23. Outer-disk amplitudes need a coherent (phasor-window) estimator

A single snapshot of an m=2 band at R>4 is shot-noise dominated (band 4.5-5.5,
N=10k: noise sigma ~0.035 vs signal ~0.036), so per-snapshot comparisons flip
sign run to run and a study can "find" anything. Metrics that survived:

- amplitude of the MEAN complex phasor over a window (T=75-150): keeps a steady
  wave, averages incoherent response down by ~sqrt(n);
- the per-sample median/p80 and a "duty cycle" (fraction of samples above a
  fixed threshold ~0.08): separates "armed some of the time" from "never armed";
- always print the per-sample mean next to the coherent amplitude — a coherent
  amplitude above the per-sample mean is arithmetically impossible and is the
  fastest way to catch an indexing bug.

Guard both ends: a stride mismatch in the snapshot buffer made a band read the
previous snapshot's data and produced a "coherent 0.225" out of a band whose
per-sample mean was 0.038.

## 24. Table-driven potentials: interpolate C1 or the force is not the gradient

If the potential comes from a table (measured profile, FFT grid, etc.) and the
force is computed analytically, linear interpolation between nodes breaks the
pair: the value's slope is not the interpolated derivative
(`d(linear interp)/dR = (a[i+1]-a[i])/dR`, not the average of node slopes), so
the leapfrog sees a 4e-4 relative inconsistency — 4% of the term's own curvature
and exactly the class of error finding 1 warns about. Catmull-Rom gives value +
exact derivative in ~10 ops and made check-gradient pass at 3e-9. Gate the
diagonal: `accelSingle` (analytic) vs central differences of `potential` on a
frozen table, 1e-4 relative / 1e-7 absolute.

## 25. Self-gravity feedback amplifies only where the response is coherent

An SCF-lite m=2 feedback (`Phi = gfb * 2 pi G Sigma2 / k`, local WKB, soft
saturation, tau=4 low-pass on the pattern-frame phasor) is stable and
phase-coherent at any tested gain (1-50), but its steady-state effect is
+10-12% coherent arm amplitude inside corotation and nothing beyond R~4. Reason:
the measured outer m=2 moment collapses across OLR (2 pi G Sigma2/k:
9.1e-3 at R=2.4 -> 1.3e-6 at R=4.5, a 10x drop at OLR alone), so the loop
amplifies a noise-level moment into a coherent but weak ripple with no resonant
support. Lesson: before building a closed loop, measure the OPEN-loop signal in
the same units the loop will use; the feedback cannot create a response that the
static potential could not.

Also: an SCF-style loop makes the potential time-dependent at fixed pattern
speed, so the Jacobi/HUD diagnostic must report n/a (like a mode fade), and the
frozen-table variant (`P.live.freeze`) is the only way to gate the force with an
invariant.

## 26. WebGL page without a browser: capture draws, replay them into a PNG

For a GPU-only feature (shader colour ramp, additive sprites), stub a WebGL
context that records uniforms per draw call and replays the vertex-shader maths
in JS into a Float32 buffer, then encode PNG. It catches real mistakes: the
first "Colorize" fan (25 arcs) read as stripes instead of a ribbon, and the
strength->hue ramp needed its warm end restricted to the core (indices
0.80-0.97) before it read as a heat ribbon. Keep the replay in the gate
(`--png` flag), not in a scratch file, so the visual evidence stays reproducible.

## 27. Before gating a transient, split the phasor by population — never gate one snapshot

The all-class outer band at view start is ~3:1 young:warm, and the young series
is identical across IC schemes — a whole-band A/B gate measures the wrong
population. Single snapshots of a near-noise quantity cannot gate anything at
all: outer-band A2 samples wander +-0.04 run to run at N=40k, swamping the
seed's ~0.03 contribution (the usable statistic is the windowed coherent
amplitude over the first samples). Companion trap: a tau-lagged complex order
parameter's short-window coherence saturates at 0.95+ whatever the driver, so a
"feedback correlation" probe built from it can neither condemn nor acquit (0.4.1
needed the armed/unarmed coherence gap and the gfb=0 twins instead; r(C,*)
reported 0.09-0.17 and -0.05..0.09 with no discrimination power).

## 28. A position-map seeding law's output phasor is not its input phase

Seeding epicycles through a differentially rotating map (phi -> phi + dphi(R),
sweeping 0.93->2.44 rad over R 2->5.5) rotates and smears the m=2 signature:
measured 0.083 rad-length at angle -1.87 for a law set at -2.14. Placed against
the disk's own forcing-aligned response the fresh seed lands partially
cancelling (settle coherent outer A2 0.094 vs 0.128 for the aged t=0 seed at
N=40k) even though its law was "aligned with the crest". Measure the map's
output signature (amp AND phase, per annulus) before reasoning about
co-location or "which phase it lands on"; the map's geometry is part of the
seeding.

## 29. "Crest" phase references: name the hill or the well, and audit against the potential itself

Every m=2 phasor in this repo is measured against `ref = Om*t + p*L(R)` and the
scripts, comments and the S2 seeder all called that azimuth "the crest". It is
the potential HILL: both mode terms are `+A*cos(2*(phi - ref))` with `A > 0`,
so the trough (the arm) is 90 deg away in azimuth = pi in the phasor. The
"~pi offset of the inner response" recorded in 0.4.1 was therefore the
in-phase forced response inside corotation - stars crest in the well, exactly
where a Hamiltonian disk should crest - and not a physics anomaly. Cheap and
decisive method (`experiments/check-arm-phase.js`): (a) brute-force scan phi
of `potential()` at a few R and print hill/well offsets from the reference,
before any star is looked at; (b) report response phases relative to the WELL,
per class, in narrow annuli, coherent-window averaged; (c) apply the seeding
routine alone and measure its own phasor. Traps this exposed: the S2/S2b
seeder placed apocenters on the hill (25-35 deg from the well after the map
rotation of finding 28) while the disk's own response sits at 0 deg from the
well - the forcing relocks the inner seed anyway (settle amp within 4% either
way), but the S2b boundary seed, which nothing relocks, landed 83-88 deg from
the well and cancelled part of the young response (this is the "partially
cancelling phase" of finding 28); seeding at the well (`P.alignPhase = pi/2`)
turned the S2b settle outer A2 from 0.073 into 0.172 with the inner steady
state unchanged. The page's "bar-captured" tracer test used the hill axis and
flagged stars on the bar's depleted minor axis (374 vs 570 on the well axis).
`alignEpicycles` also carried two dead "crest-pointing unit vector" locals.
Rule: when a phase looks like "pi off", check the sign convention of the
forcing term against the measured phasor BEFORE reasoning about dynamics.

## 30. A hard clamp in the consumer is a boundary condition the producer must satisfy (LIVE_RLO value+slope)

`liveSample` zeroes the force-table amplitude for `R < LIVE_RLO` with the
derivative zeroed (it is a hard cut, not a taper). The WKB tables arrived with
a small inner amplitude and squeaked by (frozen-table Jacobi p99 1.5e-3); the
global-solve tables arrived ~5x stronger, so the Catmull-Rom slope at the
boundary (~0.5*amp[1]/dr, a ~1.4e-2 force kink) fired at every star crossing:
p99 6.5e-3, dt-INDEPENDENT (crossing error accumulates the same at smaller
dt), linear in table amplitude, independent of theta. Fix: the producer tapers
so value AND slope reach the clamp as 0 - which pins the first TWO bins
(boundary slope is set by amp[1]) to exact zero. Signature to recognize:
episodic one-time dEJ jumps (~1e-3) in inner/plunging stars, plateaus after;
dt-invariance + amp-linearity distinguish it from integrator truncation.

## 31. liveGain(P, spirOn, barOn): two adjacent booleans are a swap waiting to happen

`Galaxy.liveGain` takes (spirOn, barOn) in that order. The page first wired it
as `liveGain(P, ui.bar, ui.spiral)` - with the calm preset (bar off, spiral
on) that silently returns 0: the solver select armed, `P.live.freeze` set,
everything LOOKED live, and the feedback table stayed empty (only the
smoke-page table-nonzero check caught it). When a gate result is "armed but
zero", check argument order against the signature before suspecting the
physics; `check-jacobi` had the same trap earlier as `(false, true)` passed
for (spirOn, barOn).

## 32. Closed-loop gates must normalize like the pre-flight (mass-weighted moments) and carry their own twin

Q(R) from `vr2/n - (vr1/n)^2` with mass-weighted vr moments underestimates
sigR by ~sqrt(m_avg) (~100x here): every run AND its twin read minQ 0.03 and
the gate failed universally - a broken normalizer shows up as "the control
fails too". Divide by SUM(m). Same class of rule: relative gates (radial
peak/mean <= 1.25x "first run") must compare against a g=0 twin run in the
SAME invocation (finding-5 rule, restated in 0.5.0 plan 4.3) or the baseline
is whatever the previous script happened to leave in the machine.

## 33. Real HDR in WebGL2: float FBO + Narkowicz ACES, and calibrate the default EV from a luma ratio

"No fake HDR" means the scene accumulates in a float framebuffer (RGBA16F via
`EXT_color_buffer_float`/`EXT_color_buffer_half_float`, both present on every
Chrome 150+ GPU; fail loudly, no 8-bit path) and the present pass grades it:
exposure `2^EV` -> luma-preserving saturation (`mix(vec3(l), c, sat)`,
l = Rec.709 dot) in LINEAR light -> Narkowicz ACES fit
`x(2.51x+.03)/(x(2.43x+.59)+.14)` -> exact sRGB transfer. ACES is monotone
with the identity crossing near x~0.65: below ~0.5 it LIFTS (0.1->0.126),
above it compresses (1->0.80, 2->0.915, ~8->1.0). Two traps: (1) a star
sprite's per-pixel peak alpha is NOT its radiance — count overlaps, not
sprite values; (2) the old 8-bit "additive into clamped byte" pipeline read
like sRGB, so a faithful float port lands ~1.2-1.5 stops brighter in the
mids unless you account for the sRGB encode — that is the honest cost of
real HDR, not a bug to paper over with a magic dimming constant.
Calibration that worked (both pages): measure core/disk median luma from the
`--stats` replay (`experiments/smoke-page.js --stats`), then pick the default
EV so the core median maps to ~0.89-0.93 (structure + colour survive, no
pure-white plate) and the arm p90 stays >0.3. A 45:1 core/disk galaxy wants
default EV ~ -0.7; a bright jam demo is fine at EV 0. Keep the range wide
(-4..+2 / -3..+3): the slider's job is to trade core detail against disk
brightness — verify both ends with the `--png` replay, not one snapshot.
Uniform arrays come back from `getActiveUniform` as `name[0]` — stubs and
uniform maps must key on that.

## 34. WebGPU native HDR: extended canvas toneMapping and color-preserving highlight compression (why stars turned white above 255)

In WebGL, canvas output is clamped to 8-bit SDR, and per-channel tone curves
(like ACES) compress each RGB channel independently towards 1.0. When radiance
accumulates beyond 1.0 (above 255 in 8-bit space), all three channels saturate
to ~0.99, collapsing blue disk stars, hot pink arm jam stars, and golden bulge
stars into chalk white. Furthermore, clamping on SDR displays burns highlights
into white if any individual channel exceeds 1.0.

Fixing this in WebGPU:
1. Native HDR Canvas: Configure `canvas.getContext('webgpu')` with
   `format: 'rgba16float'` and `toneMapping: { mode: 'extended' }`. This
   transmits linear half-float radiance into the display's extended dynamic
   range without standard SDR clipping.
2. Chromaticity-Preserving Highlight Compression: In the present pass, do
   NOT compress R, G, B independently. Instead, compress the peak channel
   (or luminance) and scale all channels by the SAME factor:
   `let peak = max(c_sat.r, max(c_sat.g, c_sat.b));`
   `let mappedPeak = (peak * H) / (H + peak);`
   `let scale = select(1.0, mappedPeak / max(peak, 1e-6), peak > 0.0);`
   `let c_hdr = c_sat * scale;`
   Since all three channels share the identical scaling ratio `scale`, the
   chromaticity ratio (R : G : B) is 100% invariant across all brightness
   levels. Even at 1,000x or 10,000x brightness, pink stays pink, blue stays
   blue, and amber stays amber.
3. Headroom calibration: `H = isHighDR ? 2.5 : 1.0`. On an SDR display,
   `mappedPeak < 1.0`, so no channel ever clips to white. On an HDR display,
   `mappedPeak < 2.5`, shining with physical peak HDR luminescence.
4. Quad Point Sprites: WebGPU does not support `gl_PointSize` (the
   `point-list` primitive is fixed to 1 pixel). Render star point sprites
   as instanced camera-facing quads using `@builtin(vertex_index)` (6 vertices
   per instance) with radial gaussian falloff and circular discard in the
   fragment shader.

