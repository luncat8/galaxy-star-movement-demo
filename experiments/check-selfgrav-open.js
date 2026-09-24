/* 0.5.0 study step 2 — OPEN LOOP (the decisive experiment, plan section 4.2):
 * drive the force from a table measured with the force ZEROED, then FROZEN.
 * If the non-local field alone organizes R>4, the kernel is the answer; if it
 * does not, the disk is unresponsive at Q=8-32 and no closed loop can help.
 *
 *   node experiments/check-selfgrav-open.js          # N=10k
 *   env: NSTARS=40000, SEED, GAIN (drive gain, default 1), TMEAS (70), TMAX (150)
 *
 * Method:
 *   settle + measure to TMEAS with SelfGrav ticking at gain 0 (table stays 0
 *   -> no force; pr/pi converge through the normal pipeline), average the raw
 *   solved Phi over T=30..TMEAS, write amp/th ONCE from the mean with GAIN,
 *   stop ticking (frozen). The force reads amp/th directly, so the frozen
 *   table drives at full strength with zero feedback. Compared against the
 *   g=0 twin (same ICs, no live term at all).
 *
 * Gates: the standard stability set (amp <= cap, median R +-10%, radial
 * peak/mean <= 1.25x twin, no runaway). The organization verdict (outer band
 * coherent A2) is printed for the worklog — it may legitimately be null.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var SelfGrav = require('../selfgrav.js');

var N = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var GAIN = process.env.GAIN !== undefined ? parseFloat(process.env.GAIN) : 1;
var TMEAS = process.env.TMEAS ? parseFloat(process.env.TMEAS) : 70;
var TMAX = process.env.TMAX ? parseFloat(process.env.TMAX) : 150;
var DT = 0.01, SAMPLE = 2, T0 = 75;
var BANDS = [[1.0, 2.5], [2.5, 4.0], [4.0, 5.0], [4.5, 5.5]];
var ARMED = 0.08;
var NB = 16, RLO = 0.4, RHI = 6.4;

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

function makeP(live) {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = live ? 1 : 0;
	if (live) { P.live.freeze = true; P.live.cap = 0.10; }
	return P;
}

var bRe = new Float64Array(4), bIm = new Float64Array(4), bW = new Float64Array(4);
var SSTR = 12;
function sample(P, st, snaps, i0) {
	bRe.fill(0); bIm.fill(0); bW.fill(0);
	var p = Galaxy.spiralP(P), mass = st.live.mass, i, b, R, ph, a;
	for (i = 0; i < st.n; i++) {
		var m = mass[st.cls[i]];
		if (m === 0) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < RLO || R >= RHI) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		a = 2 * (ph - P.spiral.om * st.t - p * Lof(P, R));
		for (b = 0; b < 4; b++) {
			if (R < BANDS[b][0] || R >= BANDS[b][1]) continue;
			bRe[b] += m * Math.cos(a); bIm[b] += m * Math.sin(a); bW[b] += m;
		}
	}
	snaps[i0 + 11] = st.t;
	for (b = 0; b < 4; b++) {
		snaps[i0 + b * 3] = bRe[b]; snaps[i0 + b * 3 + 1] = bIm[b]; snaps[i0 + b * 3 + 2] = bW[b];
	}
}
function coherent(snaps, ns, i0, i1, out) {
	var b, s, re, im, w;
	for (b = 0; b < 4; b++) {
		re = 0; im = 0; w = 0;
		for (s = i0; s <= i1 && s < ns; s++) {
			re += snaps[s * SSTR + b * 3]; im += snaps[s * SSTR + b * 3 + 1]; w += snaps[s * SSTR + b * 3 + 2];
		}
		out[b] = w > 0 ? Math.sqrt(re * re + im * im) / w : 0;
	}
	return out;
}

function run(live) {
	var P = makeP(live), st = Galaxy.createState(N), t0 = Date.now();
	st.n = N;
	Galaxy.initStars(st, P, SEED || P.seed);
	if (live) SelfGrav.ensure(P), P.sg.solver = 1;
	/* settle + measure to TMEAS, gain 0: no force anywhere in this phase */
	var snaps = new Float64Array((Math.ceil((TMAX - P.tsettle) / SAMPLE) + 4) * SSTR);
	var ns = 0, phiSumRe = new Float64Array(Galaxy.LIVE_NB), phiSumIm = new Float64Array(Galaxy.LIVE_NB), phiN = 0;
	var ampMax = 0, i, b;
	/* settle */
	var total = Math.round(P.tsettle / P.dtSettle), c = 0;
	while (c < total) {
		var m = Math.min(live ? P.sg.refresh : total, total - c);
		Galaxy.settle(st, P, m, P.dtSettle, false, true);
		if (live) SelfGrav.step(st, P, st.t, P.dtSettle, m, 0);
		c += m;
	}
	/* measure T0..TMEAS at gain 0, then (live) write the frozen table once */
	var measEnd = TMEAS, tEnd = TMAX;
	var wrote = !live;
	while (st.t < tEnd - 1e-9) {
		for (i = 0; i < Math.round(SAMPLE / DT); i++) {
			Galaxy.step(st, P, DT, false, true);
			if (live) {
				var refreshed = SelfGrav.step(st, P, st.t, DT, 1, 0);
				if (refreshed && st.t < measEnd && st.t > P.tsettle) {
					for (b = 0; b < Galaxy.LIVE_NB; b++) {
						phiSumRe[b] += SelfGrav.lastPhi.re[b];
						phiSumIm[b] += SelfGrav.lastPhi.im[b];
					}
					phiN++;
				}
				/* freeze the moment we cross TMEAS: write mean Phi, drive gain */
				if (!wrote && st.t >= measEnd) {
					for (b = 0; b < Galaxy.LIVE_NB; b++) { phiSumRe[b] /= phiN; phiSumIm[b] /= phiN; }
					SelfGrav.writeTable(st.live, P, phiSumRe, phiSumIm, GAIN);
					wrote = true;
					console.log('  wrote frozen table from ' + phiN + ' refreshes (T30-' + measEnd.toFixed(0) +
						'), drive gain ' + GAIN);
				}
			}
			if (st.t > P.tsettle) {
				for (b = 0; b < st.live.nb; b++) if (st.live.amp[b] > ampMax) ampMax = st.live.amp[b];
			}
		}
		if (st.t > P.tsettle - 1e-9 && ns < (snaps.length / SSTR)) { sample(P, st, snaps, ns * SSTR); ns++; }
	}
	var lateI = Math.max(0, Math.round((T0 - P.tsettle) / SAMPLE));
	var late = coherent(snaps, ns, lateI, ns - 1, new Float64Array(4));
	var at70 = coherent(snaps, ns, Math.max(0, Math.round((measEnd - P.tsettle) / SAMPLE) - 1),
		Math.max(0, Math.round((measEnd - P.tsettle) / SAMPLE) + 1), new Float64Array(4));
	/* stability */
	var buf = new Float64Array(N), med = L.median(L.radii(st, buf), st.n);
	var h = L.hist(L.radii(st, buf), st.n, 0, 6, 20), pk = 0;
	for (i = 0; i < h.length; i++) if (h[i] > pk) pk = h[i];
	var pm = pk * h.length;
	console.log((live ? 'open-loop g=' + GAIN : 'twin  g=0 ') + '  N=' + N + '  (~' +
		((Date.now() - t0) / 1000).toFixed(0) + 's, caps=' + st.caps + ', ampMax=' + ampMax.toExponential(2) +
		'/' + P.live.cap + ', medR=' + med.toFixed(3) + ', pk/mean=' + pm.toFixed(2) + ')');
	console.log('  band        T=70     late75-150');
	for (b = 0; b < 4; b++)
		console.log('  ' + BANDS[b][0].toFixed(1) + '-' + BANDS[b][1].toFixed(1) + '     ' +
			at70[b].toFixed(3) + '     ' + late[b].toFixed(3));
	return { late: late, at70: at70, med: med, pm: pm, ampMax: ampMax, P: P };
}

console.log('0.5.0 open loop: table measured at zero force, frozen, drive gain ' + GAIN +
	'  N=' + N + ' Tmeas=' + TMEAS + ' TMAX=' + TMAX);
var twin = run(false);
var open = run(true);

/* gates: stability + no harm (same set as check-live-mode) */
if (open.ampMax > open.P.live.cap * 1.0001) L.fail('open-loop ampMax ' + open.ampMax.toExponential(2) + ' exceeds cap');
if (open.med / twin.med < 0.90 || open.med / twin.med > 1.10)
	L.fail('open-loop median R x' + (open.med / twin.med).toFixed(3));
if (open.pm > twin.pm * 1.25) L.fail('open-loop radial peak/mean ' + open.pm.toFixed(2) + ' > 1.25x twin ' + twin.pm.toFixed(2));
if (open.late[0] < 0.7 * twin.late[0])
	L.fail('open-loop inner coherent amp degraded ' + open.late[0].toFixed(3) + ' vs twin ' + twin.late[0].toFixed(3));

/* verdict (printed, not gated — plan section 4 decision material) */
console.log('verdict vs twin (coherent A2, T75-150):');
['inner 1-2.5', 'mid 2.5-4', 'outer 4-5', 'far 4.5-5.5'].forEach(function(nm, b) {
	var ratio = twin.late[b] > 0 ? open.late[b] / twin.late[b] : Infinity;
	console.log('  ' + nm.padEnd(12) + ' open ' + open.late[b].toFixed(3) + '  twin ' +
		twin.late[b].toFixed(3) + '  x' + (isFinite(ratio) ? ratio.toFixed(2) : 'inf'));
});
console.log('  (outer organized iff outer/far ratio >> 1 beyond the 40k noise floor of ~0.04)');
L.pass('check-selfgrav-open stability gates hold; verdict numbers above');
