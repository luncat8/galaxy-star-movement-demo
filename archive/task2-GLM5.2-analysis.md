# Task 2 — `demo-simple-GLM5.2.html` analysis: what to pick, what to skip

Same family as the Beltoforion reference: KINEMATIC (closed-form orbits,
phase = f(t)). No integration, no forces. 33.5k stars, ~700 lines.

## What it does (per component)

- Disk (18k): fixed Kepler ellipses + flat-curve angular speed, RANDOM
  epicycle orientations → no spiral arms at all (axisymmetric by
  construction). Vertical sine bobbing.
- Bar (5k): aligned ellipses rigidly rotated at pattern speed — a MATERIAL
  bar: stars locked to the pattern, no streaming through, no capture/
  escape, no resonances. Looks like a bar, behaves like a sticker.
- Belt (3.5k): narrow Gaussian ring at r=3.7 on circular orbits. A ring by
  initial condition, not by dynamics (cf. our OLR/CR resonance rings).
- Bulge (7k): circles in random 3D planes (inclination/node uniform).
  Correct look, cheapest possible method.
- Motion: time advances phases; camera yaw/pitch/zoom + trails + orbit
  paths for 25 random stars; additive glow sprites, gradient bg, core glow.

## Verdict: presentation ideas YES, dynamics ideas NO

Pick (adopted in 0.1.1): drag-to-rotate + wheel-zoom camera (ours: yaw/tilt
drag, wheel zoom, dblclick reset); radial-gradient background + warm core
glow; distinct per-component color language with the responsive population
brightest (ours: young disk icy blue, larger sprite; background classes
dimmed/small); orbit-path overlays (we already had 8 tracers — kept).

Skip (with reasons):
1. Kinematic orbits can't make arms: random epi-phases = smooth disk; the
   file shows NO spiral structure. Correlated phases (Beltoforion trick)
   would be paint, not physics — and our plan decision 4 already rejects
   closed-form epicycles as the engine.
2. Material bar contradicts the demo's core message (stars stream THROUGH
   the bar on x1 orbits; capture/escape visible). Ours integrates this.
3. No resonances, no migration, no heating, no EJ — nothing to validate
   against; the whole experiments/ suite would be meaningless on it.
4. Perf style is the bottleneck, not the star count: `project()` allocates
   an object PER STAR PER FRAME (GC churn), full trig per star, 64px
   sprites overdrawn at 33k. Ours: preallocated typed arrays, algebraic
   cos2phi/sin2phi, 16px sprites — 10k x 10 substeps ~15 ms sim.

## Net

GLM5.2 is a rendering/camera reference, not a physics reference. The picks
are all in `index.html` (camera, background, palette/alpha/sizes); the
engine stays Hamiltonian test particles (`galaxy.js`), which is the only
approach in the room that actually grows spiral arms from dynamics.
