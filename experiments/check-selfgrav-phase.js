/* 0.5.0 audit 2: SIGN of the global self-gravity term, measured against the
 * potential itself (the 0.4.2 hand-off: check-arm-phase part A applied to the
 * new term; finding 29 — never trust the phase algebra, scan the potential).
 *
 *   node experiments/check-selfgrav-phase.js
 *   env: NSTARS (10000), SEED
 *
 * Two scans, one per direction of the chain:
 *   A. SOLVE wiring: put a KNOWN crest phase (constant u0 across the grid)
 *      straight into pr/pi, mask=1, solve, scan phi of the variant-table
 *      potential. The well must sit at the known crest within +-10 deg (the
 *      kernel is linear with real K, so this is exact up to quadrature — it
 *      catches a double-counted +pi and an atan2 argument swap).
 *   B. FORCE-PATH sign vs INDEPENDENT data: measure the density crest from
 *      star positions (pattern frame, mean over the prime window), push it
 *      through the production kernel (SelfGrav.phiOf -> writeTable, pr never
 *      involved), scan the potential, and require the well within +-10 deg of
 *      arg(Phi)+pi predicted from those same independent phasors.
 *
 * Also printed (NOT gated): the real internal-measurement table's well vs the
 * LOCAL density crest at each probe, with the kernel's local-input share.
 * The solve is non-local by design — share 25% at R=1.5, 5% at R=4.5 — so the
 * outer well follows the dominant (inner) response's phase. That offset is
 * physics the study is about, not a sign bug; gating it would gate the
 * non-locality itself.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var SelfGrav = require('../selfgrav.js');

var N = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var PRIME = process.env.PRIME ? parseFloat(process.env.PRIME) : 4;
var PROBES = [1.5, 2.5, 3.5, 4.5], AW = 0.2;   /* annulus half-width */
var DEG = 180 / Math.PI;
var DT = 0.01;

function fold90(d) { return ((d + 90) % 180 + 180) % 180 - 90; }
function fmt(v) { return (v >= 0 ? ' ' : '') + v.toFixed(1); }

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

/* well azimuth (phi, unwrapped around the reference) of the live-only term:
 * spiral static part zeroed with as=0, bar off, ramp forced 1. */
function scanWell(P, Lv, R, t) {
	var o = { bar: false, spiral: true, ramp: 1, live: Lv };
	var best = Infinity, wphi = 0, k, phi, v, x, y;
	for (k = 0; k < 1440; k++) {
		phi = k / 1440 * 2 * Math.PI;
		x = R * Math.cos(phi); y = R * Math.sin(phi);
		v = Galaxy.potential(x, y, 0, t, P, o);
		if (v < best) { best = v; wphi = phi; }
	}
	return wphi;
}

function crestOffsetDeg(wellPhi, crestPhi) {
	/* m=2: fold the azimuth difference to (-90, 90] */
	return fold90((wellPhi - crestPhi) * DEG);
}

var P = Galaxy.defaultParams();
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
P.live.gfb = 1; P.live.freeze = true; P.live.cap = 0.10;
SelfGrav.ensure(P);
P.sg.solver = 1;

var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, SEED || P.seed);

/* settle + prime in refresh-sized chunks, gain 0 -> measurement converges,
 * the force table stays 0 (no force), exactly the open-loop priming. */
function tickSteps(n, dt) {
	for (var c = 0; c < n; ) {
		var m = Math.min(P.sg.refresh, n - c);
		Galaxy.settle(st, P, m, dt, false, true);
		SelfGrav.step(st, P, st.t, dt, m, 0);
		c += m;
	}
}
tickSteps(Math.round(P.tsettle / P.dtSettle), P.dtSettle);
tickSteps(Math.round(PRIME / DT), DT);

/* static spiral off from here on: the scans must see axisym + variant table
 * only (the measurement above already happened under the full field) */
var asSave = P.spiral.as;
P.spiral.as = 0;

/* ---- A. synthetic known crest ------------------------------------------- */
(function synthetic() {
	var Ls = st.live, u0 = 0.7, i;
	var savePr = Ls.pr.slice(), savePi = Ls.pi.slice(), saveMask = Ls.mask.slice();
	for (i = 0; i < Ls.nb; i++) {
		/* phasor e^{i u0}: density crest at u = u0, constant across the grid */
		var w = 0.02 * Math.exp(-Math.pow((Ls.rc[i] - 2.8) / 2.5, 2));
		Ls.pr[i] = w * Math.cos(u0); Ls.pi[i] = w * Math.sin(u0); Ls.mask[i] = 1;
	}
	SelfGrav.solve(st, P, 1);
	var t = st.t, worst = 0;
	PROBES.forEach(function(R) {
		var well = scanWell(P, Ls, R, t);
		var crestPhi = P.spiral.om * t + Galaxy.spiralP(P) * Lof(P, R) + u0 / 2;
		var off = crestOffsetDeg(well, crestPhi);
		if (Math.abs(off) > Math.abs(worst)) worst = off;
		console.log('A synthetic R=' + R.toFixed(2) + '  well-crest ' + fmt(off) + ' deg');
	});
	if (Math.abs(worst) > 10) L.fail('A: synthetic wiring well off by ' + worst.toFixed(1) + ' deg (sign/atan2 bug)');
	Ls.pr.set(savePr); Ls.pi.set(savePi); Ls.mask.set(saveMask);
})();

/* ---- B. measured crest vs scanned well ----------------------------------- */
var p = Galaxy.spiralP(P), mass = st.live.mass;
var accRe = new Float64Array(PROBES.length), accIm = new Float64Array(PROBES.length), accW = new Float64Array(PROBES.length);
var Lv0 = st.live;
var accReExt = new Float64Array(Lv0.nb), accImExt = new Float64Array(Lv0.nb);
var ns = 0, i2;

function foldU(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a * 180 / Math.PI; }

function accumulateCrest() {
	var t = st.t, x = st.x, y = st.y, cls = st.cls, n = st.n, si, sk;
	for (si = 0; si < n; si++) {
		var c = cls[si], m = mass[c];
		if (m === 0) continue;
		var R = Math.sqrt(x[si] * x[si] + y[si] * y[si]);
		var b = ((R - Galaxy.LIVE_RLO) / ((Galaxy.LIVE_RHI - Galaxy.LIVE_RLO) / Galaxy.LIVE_NB)) | 0;
		if (b >= 0 && b < Lv0.nb) {
			var phB = Math.atan2(y[si], x[si]);
			var uB = 2 * (phB - P.spiral.om * t - p * Lof(P, R));
			accReExt[b] += m * Math.cos(uB); accImExt[b] += m * Math.sin(uB);
		}
		for (sk = 0; sk < PROBES.length; sk++) {
			if (Math.abs(R - PROBES[sk]) > AW) continue;
			var ph = Math.atan2(y[si], x[si]);
			var u = 2 * (ph - P.spiral.om * t - p * Lof(P, R));
			accRe[sk] += m * Math.cos(u); accIm[sk] += m * Math.sin(u); accW[sk] += m;
		}
	}
	ns++;
}

var nsamp = Math.round(PRIME * 100);   /* every substep of the prime window */
for (i2 = 0; i2 < nsamp; i2++) {
	Galaxy.step(st, P, DT, false, true);
	SelfGrav.step(st, P, st.t, DT, 1, 0);
	accumulateCrest();
}

/* solve once from the converged measurement, gain 1 (spiral static term is
 * already off, so the scan sees axisym + the variant table only) */
SelfGrav.solve(st, P, 1);
var Lv = st.live, t = st.t, fails = [], K = SelfGrav.kernel(P);
var NB = Galaxy.LIVE_NB, phiRe = new Float64Array(NB), phiIm = new Float64Array(NB);
var i2, k2;

console.log('B1. real table (internal pr): well vs LOCAL density crest + kernel local share');
console.log('    (offset grows where the solve is non-local by design — printed, not gated)');
PROBES.forEach(function(R) {
	var bin = Math.min(NB - 1, Math.max(0, Math.round((R - Galaxy.LIVE_RLO) / ((Galaxy.LIVE_RHI - Galaxy.LIVE_RLO) / NB) - 0.5)));
	var crest = accW[PROBES.indexOf(R)] > 0 ? Math.atan2(accIm[PROBES.indexOf(R)], accRe[PROBES.indexOf(R)]) : NaN;
	var crestU = isFinite(crest) ? crest : 0;
	var well = scanWell(P, Lv, Lv.rc[bin], t);
	var uWell = 2 * (well - P.spiral.om * t - p * Lof(P, Lv.rc[bin]));
	var den = 0, loc = 0, j, aj, term;
	for (j = 0; j < NB; j++) {
		aj = Math.sqrt(Math.pow(Lv.mask[j] * 2 * Lv.pr[j] / Lv.area[j], 2) +
			Math.pow(Lv.mask[j] * 2 * Lv.pi[j] / Lv.area[j], 2));
		term = Math.abs(K[bin * NB + j]) * aj;
		den += term;
		if (j === bin) loc = term;
	}
	var share = den > 0 ? loc / den : 0;
	console.log('    R=' + R.toFixed(2) + '  local share ' + share.toFixed(3) +
		'  well-crest ' + fmt(foldU(uWell - crestU) * 1) + ' u-deg');
});

/* B2. FORCE-PATH sign: table from the INDEPENDENT phasors (pr untouched),
 * predicted well = arg(Phi_ext) + pi, gate +-10 deg at every probe. */
var extRe = new Float64Array(NB), extIm = new Float64Array(NB);
for (i2 = 0; i2 < NB; i2++) {
	extRe[i2] = Lv.mask[i2] * 2 * (accReExt[i2] / ns) / Lv.area[i2];
	extIm[i2] = Lv.mask[i2] * 2 * (accImExt[i2] / ns) / Lv.area[i2];
}
SelfGrav.phiOf(P, extRe, extIm, phiRe, phiIm);
SelfGrav.writeTable(Lv, P, phiRe, phiIm, 1);
console.log('B2. independent crest -> production kernel -> writeTable: scanned well vs arg(Phi_ext)+pi');
PROBES.forEach(function(R) {
	var bin = Math.min(NB - 1, Math.max(0, Math.round((R - Galaxy.LIVE_RLO) / ((Galaxy.LIVE_RHI - Galaxy.LIVE_RLO) / NB) - 0.5)));
	var predU = Math.atan2(phiIm[bin], phiRe[bin]) + Math.PI;
	var well = scanWell(P, Lv, Lv.rc[bin], t);
	var uWell = 2 * (well - P.spiral.om * t - p * Lof(P, Lv.rc[bin]));
	var offPhi = foldU(uWell - predU) / 2;   /* azimuth (phi) deg, folded +-90 */
	console.log('  R=' + R.toFixed(2) + '  |Phi_ext| ' +
		Math.sqrt(phiRe[bin] * phiRe[bin] + phiIm[bin] * phiIm[bin]).toExponential(2) +
		'  well-pred ' + fmt(offPhi) + ' deg' + (Math.abs(offPhi) <= 10 ? '  ok' : '  FAIL'));
	if (!(Math.abs(offPhi) <= 10)) fails.push('R=' + R + ' off ' + offPhi.toFixed(1));
});
fails.forEach(function(m) { L.fail('B2: scanned well not at arg(Phi)+pi: ' + m); });
L.pass('check-selfgrav-phase: solve wiring and force-path sign put the well on the (independent) crest ±10 deg');
