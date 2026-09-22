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
is a toggle experiment. Rendering adds
interpolated sub-pixel motion and a glow underlay (pattern-frame accumulated,
edge-filtered disk light) - the surface-brightness layer that makes density-wave
renders like https://en.wikipedia.org/wiki/File:Galaxy_rotation_wave.ogv look
calm; the stars underneath are plain single-particle orbits.

Run: open index.html in a browser (file:// friendly, no build, no modules).

    node experiments/check-response.js   # structure persistence gates
    node experiments/render-png.js calm  # headless preview renders
    (see experiments/ for the full validation suite)
