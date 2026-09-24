/* 0.5.0 pre-flight. Two questions, measured before any closed loop exists:
 *
 *   (a) is the sampled disk self-gravitating-stable at all? Toomre Q(R) of the
 *       shipping ICs, with the disk classes' own radial dispersion.
 *   (b) what does a GLOBAL m-harmonic Green's function give for the disk's own
 *       measured response, in the units the S5 loop used (finding 25 measured
 *       the WKB version: 2*pi*G*Sig2/k, 9.1e-3 at R=2.4 -> 1.3e-6 at R=4.5)?
 *       The global kernel is non-local, so the strong inner response reaches
 *       the outer disk - that is the whole 0.5.0 hypothesis.
 *
 * The kernel is the exact m-harmonic of a Plummer-softened razor-thin layer,
 *   g_m(R,R') = int_0^2pi cos(m psi) / sqrt(R^2 + R'^2 - 2 R R' cos psi + eps^2) dpsi
 *   Phi_m(R)  = -G sum_j g_m(R,R_j) R_j dR * (harmonic amplitude of Sigma at R_j)
 * precomputable as a 32x32 matrix per m. Normalization gated below against a
 * direct pairwise sum over a Monte-Carlo sample of the same axisymmetric
 * profile (the m>0 kernels share the same quadrature, so the gate covers them).
 *
 * Conventions match galaxy.js/check-live-mode: pattern-frame phasor
 * c * e^{-i psi}, psi = 2(Om t + p L(R)); Sig_m reported as |phasor|/area,
 * which is HALF the harmonic amplitude a_m = 2|phasor|/area (the shipped WKB
 * est uses that same half-amplitude - see the 0.5.0 plan).
 *
 * Usage: node experiments/measure-selfgrav-kernel.js [N] [Tend]
 *   env EPS=<softening> (default 0.15), NSTAR=... same as N
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

var N = parseInt(process.argv[2] || process.env.NSTARS || '20000', 10);
var TEND = parseFloat(process.argv[3] || '70');
var EPS = parseFloat(process.env.EPS || '0.15');
var NB = Galaxy.LIVE_NB, RLO = Galaxy.LIVE_RLO, RHI = Galaxy.LIVE_RHI;
var DR = (RHI - RLO) / NB, NQ = 256, SAMPLE = 2;

var P = Galaxy.defaultParams();
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0;   /* calm preset */
P.bar.g = 0; P.spiral.g = 1; P.live.gfb = 0;
var p = Galaxy.spiralP(P), om = P.spiral.om;

var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);

/* --- accumulate pattern-frame m=1,2 phasors + mass + radial dispersion ------- */
var rc = new Float64Array(NB), area = new Float64Array(NB), i, j;
for (i = 0; i < NB; i++) {
	rc[i] = RLO + (i + 0.5) * DR;
	area[i] = Math.PI * ((RLO + (i + 1) * DR) * (RLO + (i + 1) * DR) -
		(RLO + i * DR) * (RLO + i * DR));
}
var c1r = new Float64Array(NB), c1i = new Float64Array(NB);
var c2r = new Float64Array(NB), c2i = new Float64Array(NB);
var msum = new Float64Array(NB), ns = new Float64Array(NB), nsamp = 0;
var vr1 = new Float64Array(NB), vr2 = new Float64Array(NB), vrm = new Float64Array(NB);
var mass = st.live.mass;

/* local copy of the winding law, same as check-transient (galaxy.js keeps
 * spiralLD private) */
function Lof(R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

function accumulate() {
	var t = st.t, x = st.x, y = st.y, vx = st.vx, vy = st.vy, cls = st.cls, R, b, ph, c1, s1, c2, s2, vR, psi, cp, sp, ar, ai;
	for (i = 0; i < st.n; i++) {
		var cl = cls[i];
		if (cl !== 0 && cl !== 1 && cl !== 5) continue;
		R = Math.sqrt(x[i] * x[i] + y[i] * y[i]);
		if (R < RLO || R >= RHI) continue;
		b = ((R - RLO) / DR) | 0;
		ph = Math.atan2(y[i], x[i]);
		psi = 2 * (om * t + p * Lof(R));
		cp = Math.cos(psi); sp = Math.sin(psi);
		c1 = Math.cos(ph); s1 = Math.sin(ph);
		c2 = c1 * c1 - s1 * s1; s2 = 2 * c1 * s1;
		/* rotate into the pattern frame: (a + i b) e^{-i psi} */
		ar = c1 * cp + s1 * sp; ai = s1 * cp - c1 * sp;
		c1r[b] += mass[cl] * ar; c1i[b] += mass[cl] * ai;
		ar = c2 * cp + s2 * sp; ai = s2 * cp - c2 * sp;
		c2r[b] += mass[cl] * ar; c2i[b] += mass[cl] * ai;
		msum[b] += mass[cl]; ns[b]++;
		vR = (vx[i] * x[i] + vy[i] * y[i]) / R;
		vr1[b] += vR; vr2[b] += vR * vR; vrm[b]++;
	}
	nsamp++;
}

accumulate();
for (var step = 0; st.t < TEND; step++) {
	Galaxy.step(st, P, 0.01, true, true);
	if ((step + 1) % Math.round(SAMPLE / 0.01) === 0) accumulate();
}

/* --- kernel matrix (precomputable; here rebuilt once for the study) ---------- */
for (i = 0; i < NB; i++) {
	c1r[i] /= nsamp; c1i[i] /= nsamp; c2r[i] /= nsamp; c2i[i] /= nsamp;
	msum[i] /= nsamp;   /* vr1/vr2/vrm stay as accumulated: sigR = vr2/vrm - (vr1/vrm)^2 */
}
var NSUB = 8, dRs = DR / NSUB;
var cosT = new Float64Array(NQ), wq = 2 * Math.PI / NQ;
for (i = 0; i < NQ; i++) cosT[i] = Math.cos(wq * (i + 0.5));
function gm(m, R, Rp) {
	var s = 0, d2 = R * R + Rp * Rp + EPS * EPS, k;
	for (k = 0; k < NQ; k++) s += Math.cos(m * wq * (k + 0.5)) / Math.sqrt(d2 - 2 * R * Rp * cosT[k]);
	return s * wq;
}
/* K[i][j] = -G * int over source bin j of R' g_m(R_i,R') dR': the source radius
 * is integrated, not taken at the bin centre (the kernel is peaked at R'~R). */
var K = [[], [], []];
for (var m = 0; m <= 2; m++) {
	K[m] = new Float64Array(NB * NB);
	for (i = 0; i < NB; i++) for (j = 0; j < NB; j++) {
		var acc = 0, lo = RLO + j * DR, q;
		for (q = 0; q < NSUB; q++) {
			var Rp = lo + dRs * (q + 0.5);
			acc += gm(m, rc[i], Rp) * Rp * dRs;
		}
		K[m][i * NB + j] = -P.G * acc;
	}
}

/* --- normalization gate: kernel matrix vs dense quadrature on a smooth
 *     analytic profile (Sigma = S0 exp(-R/Rd), no interpolation error) ------ */
/* Truth over the SAME R range as the grid: the grid starts at RLO, and the
 * mass inside it is real (7% of this profile at R=1.4) - a m=0 solve would
 * have to start at R=0 or carry that hole as a known bias. */
var S0 = 0.08, Rd = 0.8, NRQ = 800, NPQ = 2048, dRq = (RHI - RLO) / NRQ, dPq = 2 * Math.PI / NPQ;
var gateMax = 0, gateAt = 0;
for (i = 0; i < NB; i++) {
	if (rc[i] < 1.0 || rc[i] > 6.2) continue;
	var phQ = 0, k2, jq;
	for (jq = 0; jq < NRQ; jq++) {
		var Rq = RLO + (jq + 0.5) * dRq, acc = 0;
		for (k2 = 0; k2 < NPQ; k2++) {
			var dx = rc[i] - Rq * Math.cos(dPq * (k2 + 0.5)), dy = Rq * Math.sin(dPq * (k2 + 0.5));
			acc += 1 / Math.sqrt(dx * dx + dy * dy + EPS * EPS);
		}
		phQ -= P.G * S0 * Math.exp(-Rq / Rd) * acc * dPq * Rq * dRq;
	}
	var phK = 0;
	for (j = 0; j < NB; j++) phK += K[0][i * NB + j] * S0 * Math.exp(-rc[j] / Rd);
	var e = Math.abs(phK - phQ) / Math.abs(phQ);
	if (e > gateMax) { gateMax = e; gateAt = rc[i]; }
}

/* --- report ----------------------------------------------------------------- */
console.log('self-gravity pre-flight  N=' + N + ' T=' + P.tsettle + '->' + st.t.toFixed(0) +
	' (' + nsamp + ' samples, ' + SAMPLE + ' tu apart), eps=' + EPS + ', calm preset (Om ' + om + ', As ' + P.spiral.as + ')');
console.log('m=0 kernel vs 800x2048 dense quadrature, same R range (R 1-6.2): max rel err ' +
	gateMax.toExponential(2) + ' at R=' + gateAt.toFixed(2) +
	(gateMax < 5e-3 ? '  PASS' : '  FAIL (kernel discretization too coarse)'));
console.log('');
console.log('   R    Sig0      Q    sigR   Sig1     Sig2   | WKB(Sig2)  glob m=2  ratio  glob m=1');
var qmin = 1e9, qminR = 0;
var sig0 = new Float64Array(NB);
for (i = 0; i < NB; i++) sig0[i] = msum[i] / area[i];
for (i = 0; i < NB; i++) {
	if (msum[i] < 1e-9) continue;
	var kap = Galaxy.kappa(rc[i], P);
	var sigR = vrm[i] > 1 ? Math.sqrt(Math.max(0, vr2[i] / vrm[i] - (vr1[i] / vrm[i]) * (vr1[i] / vrm[i]))) : 0;
	var Q = kap * sigR / (3.36 * P.G * sig0[i]);
	if (Q > 0 && Q < qmin) { qmin = Q; qminR = rc[i]; }
	var s1 = Math.sqrt(c1r[i] * c1r[i] + c1i[i] * c1i[i]) / area[i];
	var s2 = Math.sqrt(c2r[i] * c2r[i] + c2i[i] * c2i[i]) / area[i];
	var wkb = 2 * Math.PI * P.G * s2 / (2 * p / rc[i]);
	/* global solve on the TRUE harmonic amplitude a_m = 2 * Sig_m */
	var g2r = 0, g2i = 0, g1r = 0, g1i = 0, ar2, ai2;
	for (j = 0; j < NB; j++) {
		/* coherent (mean-phasor) input: keep phase AND amplitude, so the inner
		 * arm's contribution adds with the right sign at the outer radii */
		ar2 = 2 * c2r[j] / area[j]; ai2 = 2 * c2i[j] / area[j];
		g2r += K[2][i * NB + j] * ar2; g2i += K[2][i * NB + j] * ai2;
		ar2 = 2 * c1r[j] / area[j]; ai2 = 2 * c1i[j] / area[j];
		g1r += K[1][i * NB + j] * ar2; g1i += K[1][i * NB + j] * ai2;
	}
	var g2 = Math.sqrt(g2r * g2r + g2i * g2i), g1 = Math.sqrt(g1r * g1r + g1i * g1i);
	console.log(
		rc[i].toFixed(2).padStart(5) + '  ' + sig0[i].toExponential(2) + '  ' + Q.toFixed(2) +
		'  ' + sigR.toFixed(3) + '  ' + s1.toExponential(2) + '  ' + s2.toExponential(2) +
		'  | ' + wkb.toExponential(2) + '  ' + g2.toExponential(2) + '  ' +
		(wkb > 0 ? (g2 / wkb).toFixed(2) : 'inf').padStart(5) + '  ' + g1.toExponential(2));
}
console.log('');
console.log('min Q = ' + qmin.toFixed(2) + ' at R=' + qminR.toFixed(2) +
	'  (Q<1 => the sampled disk is unstable to its own gravity at gain 1)');
console.log('imposed spiral field amplitude As = ' + P.spiral.as + ' (the scale the self-term must reach to matter)');
L.pass('self-gravity pre-flight measured');
