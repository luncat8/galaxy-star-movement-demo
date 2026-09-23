## stars movement in galaxy

fast math demo stars movement in galaxy, without calculate N body gravity.

Every star is a persistent test particle in a fixed multi-component potential
(thin/thick disk, bulge, halo) with rigidly rotating m=2 wave modes, integrated
with a symplectic leapfrog. Spiral arms are density-wave crests: stars stream
through them, the pattern never winds up.

Default is a calm spiral-only preset tuned so the coherent arm zone covers the
bright disk (Om 0.30, As 0.06). At reset the warm disk stars are seeded
pre-aligned with the wave (apocenters on the spiral winding law), so connected
arms are visible immediately; the young cold disk grows its own arms, and the
seeded outer alignment shears away honestly over tens of time units. The bar
is a toggle experiment, and so is the live m=2 mode (S5): the disk's measured
m=2 response is optionally fed back as a small WKB self-gravity term, which
measurably strengthens the steady arms inside corotation but cannot hold the
outer disk - see archive/0.4.0-worklog.md. Rendering adds
interpolated sub-pixel motion and a glow underlay (pattern-frame accumulated,
edge-filtered disk light) - the surface-brightness layer that makes density-wave
renders like https://en.wikipedia.org/wiki/File:Galaxy_rotation_wave.ogv look
calm; the stars underneath are plain single-particle orbits.

Run: open index.html in a browser (file:// friendly, no build, no modules).

    node experiments/check-response.js          # structure persistence gates
    node experiments/check-live-mode.js 0 50    # S5 self-gravity study
    node experiments/render-png.js calm         # headless preview renders
    (see experiments/ for the full validation suite)
