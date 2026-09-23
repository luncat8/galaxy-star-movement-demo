/* 0.4.1 transient capture: the TIME HISTORY of the disk's arm response from
 * the settle boundary to T=150 (archive/0.4.1-plan.md).
 *
 *   node experiments/check-transient.js [gfb:split ...]   default: 0:0 0:3
 *   env: NSTARS (10000), SEED, ALIGN (1), TMAX (150), PHASE (seed azimuth in
 *   deg from the potential hill, overrides P.alignPhase: 90 = well = shipping
 *   since 0.4.2, 0 = the 0.4.1 hill seed; check-arm-phase.js)
 *
 * Default is the shipping A/B gate (legacy twin vs S2b). The mechanism study
 * ran 0:0 25:0 50:0 0:3 at NSTARS=10000 and 40000 (see
 * experiments/logs/transient-*.txt and archive/0.4.1-worklog.md).
 *
 * Each spec is one full run: P.live.gfb and P.alignSplit (0 = legacy all-at-t=0
 * seeding, >0 = S2b: inner seeded at t=0, outer at the settle boundary).
 *
 * Dense window: one sample every 2 tu from the settle boundary (T=30) to TMAX.
 * Per sample and band (inner 1.0-2.5, mid 2.5-4.0, outer 4.0-5.0 near OLR,
 * far 4.5-5.5) the mass-weighted m=2 (pattern frame, spiral winding) and m=1
 * (pattern frame, no winding) phasors - A2 vs A1 is the two-armed vs one-armed
 * content. An ARMED sample has A2 > 0.08 (the check-live-mode duty threshold);
 * epochs are maximal armed runs with gaps of <= 1 sample (2 tu) allowed,
 * because the envelope flickers at the shot-noise scale (finding 5).
 *
 * Mechanism probe: the live table's pattern-frame phasor at R 4.5 (bin 17) per
 * sample, temporal coherence over a 12-tu sliding window, correlated with the
 * armed series - if the feedback drives the epochs, armed samples must coincide
 * with coherent live phase.
 *
 * Gates (S2b spec vs its legacy twin, same gfb): settle outer A2 restored, no
 * extra late epoch births, inner steady state unharmed; every run repeats the
 * check-live-mode stability gates (bounded live amp, no inflow, no clumping).
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

var NSTARS = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var ALIGN = process.env.ALIGN === undefined ? 1 : parseFloat(process.env.ALIGN);
var PHASE = process.env.PHASE !== undefined ? parseFloat(process.env.PHASE) * Math.PI / 180 : undefined;
var DT = 0.01, SAMPLE = 2, TMAX = process.env.TMAX ? parseFloat(process.env.TMAX) : 150;
var T0 = 30, SUB = Math.round(SAMPLE / DT);
var NS = Math.round((TMAX - T0) / SAMPLE) + 1;      /* 61 at TMAX=150 */
var SSTR = 30;                                      /* t, 4 bands x 5, live phasor, warm/young outer */
var BANDS = [[1.0, 2.5], [2.5, 4.0], [4.0, 5.0], [4.5, 5.5]];
var ARMED = 0.08, GAP = 1, WCOH = 6, PROBE = 17;    /* armed, gap tol (samples), coh window, live bin ~R 4.5 */
var LATE0 = Math.round((75 - T0) / SAMPLE);         /* sample index of T=75 */
var RLO = 0.4, RHI = 6.4;

var specs = process.argv.slice(2).map(function(s) {
	var p = s.split(':');
	return { gfb: parseFloat(p[0]), split: parseFloat(p[1]), tag: s };
});
if (!specs.length) specs = [{ gfb: 0, split: 0, tag: '0:0' }, { gfb: 0, split: 3, tag: '0:3' }];

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

function makeRun(sp) {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = sp.gfb;
	P.align = ALIGN;
	P.alignSplit = sp.split;
	if (PHASE !== undefined) P.alignPhase = PHASE;
	var st = Galaxy.createState(NSTARS);
	st.n = NSTARS;
	Galaxy.initStars(st, P, SEED || P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
	return { P: P, st: st };
}

/* Mass-weighted m=2 + m=1 phasors per band, pattern frame, disk classes. The
 * outer band is additionally split warm (thin+thick, the seeded classes) vs
 * young (class 5, never seeded) - finding 20: the all-class mean hides which
 * population carries the transient. */
function sample(P, st, snap, i0) {
	snap[i0] = st.t;
	var p = Galaxy.spiralP(P), mass = st.live.mass, cls = st.cls;
	var re2 = [0, 0, 0, 0], im2 = [0, 0, 0, 0], re1 = [0, 0, 0, 0], im1 = [0, 0, 0, 0], w = [0, 0, 0, 0];
	var wr = 0, wi = 0, ww = 0, yr = 0, yi = 0, yw = 0;
	var i, b, m, R, ph, a2, a1;
	for (i = 0; i < st.n; i++) {
		var c = st.cls[i];
		m = mass[c];
		if (m === 0) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < RLO || R >= RHI) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		a2 = 2 * (ph - P.spiral.om * st.t - p * Lof(P, R));
		a1 = ph - P.spiral.om * st.t;
		if (R >= BANDS[2][0] && R < BANDS[2][1]) {
			if (c === 5) { yr += m * Math.cos(a2); yi += m * Math.sin(a2); yw += m; }
			else { wr += m * Math.cos(a2); wi += m * Math.sin(a2); ww += m; }
		}
		for (b = 0; b < 4; b++) {
			if (R < BANDS[b][0] || R >= BANDS[b][1]) continue;
			re2[b] += m * Math.cos(a2); im2[b] += m * Math.sin(a2);
			re1[b] += m * Math.cos(a1); im1[b] += m * Math.sin(a1);
			w[b] += m;
		}
	}
	for (b = 0; b < 4; b++) {
		snap[i0 + 1 + b * 5] = re2[b]; snap[i0 + 1 + b * 5 + 1] = im2[b];
		snap[i0 + 1 + b * 5 + 2] = w[b];
		snap[i0 + 1 + b * 5 + 3] = re1[b]; snap[i0 + 1 + b * 5 + 4] = im1[b];
	}
	snap[i0 + 21] = st.live.amp[PROBE] * Math.cos(st.live.th[PROBE]);
	snap[i0 + 22] = st.live.amp[PROBE] * Math.sin(st.live.th[PROBE]);
	snap[i0 + 23] = wr; snap[i0 + 24] = wi; snap[i0 + 25] = ww;
	snap[i0 + 26] = yr; snap[i0 + 27] = yi; snap[i0 + 28] = yw;
}

function warmAmp(snap, s) {
	var i = s * SSTR + 23, w = snap[i + 2];
	return w > 0 ? Math.sqrt(snap[i] * snap[i] + snap[i + 1] * snap[i + 1]) / w : 0;
}

function youngAmp(snap, s) {
	var i = s * SSTR + 26, w = snap[i + 2];
	return w > 0 ? Math.sqrt(snap[i] * snap[i] + snap[i + 1] * snap[i + 1]) / w : 0;
}

function amp2(snap, s, b) {
	var i = s * SSTR + 1 + b * 5, re = snap[i], im = snap[i + 1], w = snap[i + 2];
	return w > 0 ? Math.sqrt(re * re + im * im) / w : 0;
}

function amp1(snap, s, b) {
	var i = s * SSTR + 1 + b * 5, re = snap[i + 3], im = snap[i + 4], w = snap[i + 2];
	return w > 0 ? Math.sqrt(re * re + im * im) / w : 0;
}

/* Amplitude of the mean phasor over samples [i0, i1] (finding 23). */
function coherent(snap, i0, i1, b) {
	var re = 0, im = 0, w = 0, s, i;
	for (s = i0; s <= i1; s++) {
		i = s * SSTR + 1 + b * 5;
		re += snap[i]; im += snap[i + 1]; w += snap[i + 2];
	}
	return w > 0 ? Math.sqrt(re * re + im * im) / w : 0;
}

/* Armed epochs of band b: maximal A2 > ARMED runs, gaps <= GAP samples merged.
 * death = last armed sample, so lifetimes carry a +-SAMPLE ambiguity. */
function epochs(snap, b) {
	var out = [], first = -1, last = -1, s, e;
	for (s = 0; s < NS; s++) {
		if (amp2(snap, s, b) > ARMED) {
			if (first < 0) first = s;
			last = s;
		} else if (first >= 0 && s - last > GAP) {
			out.push(mkEpoch(snap, b, first, last));
			first = -1;
		}
	}
	if (first >= 0) out.push(mkEpoch(snap, b, first, last));
	for (e = 0; e < out.length; e++) out[e].idx = e + 1;
	return out;
}

function mkEpoch(snap, b, s0, s1) {
	var p2 = 0, p1 = 0, s;
	for (s = s0; s <= s1; s++) {
		if (amp2(snap, s, b) > p2) p2 = amp2(snap, s, b);
		if (amp1(snap, s, b) > p1) p1 = amp1(snap, s, b);
	}
	return {
		birth: T0 + s0 * SAMPLE, death: T0 + s1 * SAMPLE,
		dur: (s1 - s0) * SAMPLE, peakA2: p2, peakA1: p1,
		kind: p1 > p2 ? 'm1' : 'm2', s0: s0, s1: s1
	};
}

function duty(snap, b) {
	var n = 0, s;
	for (s = 0; s < NS; s++) if (amp2(snap, s, b) > ARMED) n++;
	return n / NS;
}

function armedTu(snap, b) {
	var n = 0, s;
	for (s = 0; s < NS; s++) if (amp2(snap, s, b) > ARMED) n++;
	return n * SAMPLE;
}

/* Sliding-window temporal coherence of the live table phasor at the probe. */
function cohSeries(snap) {
	var out = new Float64Array(NS), s, k, i0, re, im, mag, n;
	for (s = 0; s < NS; s++) {
		i0 = Math.max(0, s - WCOH + 1);
		re = 0; im = 0; mag = 0; n = 0;
		for (k = i0; k <= s; k++) {
			var zr = snap[k * SSTR + 21], zi = snap[k * SSTR + 22];
			re += zr; im += zi; mag += Math.sqrt(zr * zr + zi * zi); n++;
		}
		out[s] = mag > 0 ? Math.sqrt(re * re + im * im) / mag : 0;
	}
	return out;
}

function pearson(a, b2, n) {
	var sa = 0, sb = 0, i;
	for (i = 0; i < n; i++) { sa += a[i]; sb += b2[i]; }
	var ma = sa / n, mb = sb / n, va = 0, vb = 0, cab = 0;
	for (i = 0; i < n; i++) {
		va += (a[i] - ma) * (a[i] - ma);
		vb += (b2[i] - mb) * (b2[i] - mb);
		cab += (a[i] - ma) * (b2[i] - mb);
	}
	return va > 0 && vb > 0 ? cab / Math.sqrt(va * vb) : 0;
}

function peakMeanR(st, buf) {
	var h = L.hist(L.radii(st, buf), st.n, 0, 6, 20), pk = 0, i;
	for (i = 0; i < h.length; i++) if (h[i] > pk) pk = h[i];
	return pk / (1 / h.length);
}

var buf = new Float64Array(NSTARS), snap = new Float64Array(NS * SSTR), runs = [], clumpRef = 0;

specs.forEach(function(sp) {
	var t0 = Date.now(), run = makeRun(sp), P = run.P, st = run.st;
	var snapL = snap, k, s, i;
	if (ALIGN && sp.split > 0 !== !!st.seededOuter)
		L.fail(sp.tag + ': S2b boundary event ' + (st.seededOuter ? 'fired' : 'did not fire'));
	var ampMax = 0;
	var med30 = L.median(L.radii(st, buf), st.n), pm30 = peakMeanR(st, buf);
	sample(P, st, snapL, 0);
	for (s = 1; s < NS; s++) {
		for (k = 0; k < SUB; k++) Galaxy.step(st, P, DT, false, true);
		sample(P, st, snapL, s * SSTR);
	}
	for (i = 0; i < st.live.nb; i++) if (st.live.amp[i] > ampMax) ampMax = st.live.amp[i];

	var eps = epochs(snapL, 2), lateBirths = 0;
	for (i = 0; i < eps.length; i++) if (eps[i].birth > T0 + 10) lateBirths++;
	var coh = cohSeries(snapL);
	var armedArr = new Float64Array(NS), cohArr = new Float64Array(NS), a2Arr = new Float64Array(NS);
	var cA = 0, cU = 0, nA = 0, nU = 0;
	for (s = 0; s < NS; s++) {
		armedArr[s] = amp2(snapL, s, 2) > ARMED ? 1 : 0;
		cohArr[s] = coh[s];
		a2Arr[s] = amp2(snapL, s, 2);
		if (armedArr[s]) { cA += coh[s]; nA++; } else { cU += coh[s]; nU++; }
	}
	var pm150 = peakMeanR(st, buf), med150 = L.median(L.radii(st, buf), st.n);

	/* view-start organization = coherent amp over samples 0-4 (T=30-38, minimal
	 * shear inside one t_decorr): single snapshots in the outer band carry
	 * +-0.04 of real structure variance and cannot gate anything (finding 5). */
	var settleCoh = coherent(snapL, 0, Math.min(4, NS - 1), 2);
	var wr = 0, wi = 0, ww = 0;
	for (s = 0; s <= Math.min(4, NS - 1); s++) {
		wr += snapL[s * SSTR + 23]; wi += snapL[s * SSTR + 24]; ww += snapL[s * SSTR + 25];
	}

	var summary = {
		tag: sp.tag, gfb: sp.gfb, split: sp.split,
		settleCoh: settleCoh, warmSettleCoh: ww > 0 ? Math.sqrt(wr * wr + wi * wi) / ww : 0,
		settleA2: [amp2(snapL, 0, 0), amp2(snapL, 0, 1), amp2(snapL, 0, 2), amp2(snapL, 0, 3)],
		late: [coherent(snapL, LATE0, NS - 1, 0), coherent(snapL, LATE0, NS - 1, 1),
			coherent(snapL, LATE0, NS - 1, 2), coherent(snapL, LATE0, NS - 1, 3)],
		duty: [duty(snapL, 0), duty(snapL, 1), duty(snapL, 2), duty(snapL, 3)],
		armedTu: armedTu(snapL, 2), epochs: eps, lateBirths: lateBirths,
		cohA: nA ? cA / nA : 0, cohU: nU ? cU / nU : 0,
		rCA: pearson(cohArr, armedArr, NS), rCA2: pearson(cohArr, a2Arr, NS),
		ampMax: ampMax, med30: med30, med150: med150, pm150: pm150,
		secs: (Date.now() - t0) / 1000
	};
	runs.push(summary);

	console.log(sp.tag + '  N=' + NSTARS + ' align=' + ALIGN + ' alignSplit=' + sp.split +
		' alignPhase=' + (P.alignPhase * 180 / Math.PI).toFixed(0) + 'deg  (~' + summary.secs.toFixed(0) + 's)');
	var ser = '', serWY = '';
	for (s = 0; s < NS; s++) {
		ser += a2Arr[s].toFixed(2) + (armedArr[s] ? '*' : ' ');
		serWY += warmAmp(snapL, s).toFixed(2) + '/' + youngAmp(snapL, s).toFixed(2) + ' ';
	}
	console.log('  A2 outer 2-tu (* = armed): ' + ser);
	console.log('  outer warm/young per class:  ' + serWY);
	console.log('  epochs outer 4.0-5.0 (armed > ' + ARMED + ', gaps <= ' + (GAP * SAMPLE) + ' tu):');
	if (!eps.length) console.log('   (none)');
	for (i = 0; i < eps.length; i++) {
		var e = eps[i];
		console.log('   ' + e.idx + '  T' + e.birth.toFixed(0) + '->' + e.death.toFixed(0) +
			'  dur ' + e.dur.toFixed(0) + '  peakA2 ' + e.peakA2.toFixed(3) +
			'  peakA1 ' + e.peakA1.toFixed(3) + '  ' + e.kind);
	}
	console.log('  band        settle  late75-150  duty');
	for (i = 0; i < 4; i++) {
		console.log('  ' + BANDS[i][0].toFixed(1) + '-' + BANDS[i][1].toFixed(1) + '    ' +
			summary.settleA2[i].toFixed(3) + '    ' + summary.late[i].toFixed(3) + '       ' +
			summary.duty[i].toFixed(2));
	}
	console.log('  outer armedTu=' + summary.armedTu.toFixed(0) + ' lateBirths=' + lateBirths +
		' medR ' + med30.toFixed(2) + '->' + med150.toFixed(2) + ' peak/mean ' + pm30.toFixed(2) + '->' + pm150.toFixed(2));
	if (sp.gfb > 0) {
		console.log('  coh R4.5 (12-tu): armed=' + summary.cohA.toFixed(2) + ' unarmed=' + summary.cohU.toFixed(2) +
			'  r(C,armed)=' + summary.rCA.toFixed(2) + ' r(C,A2)=' + summary.rCA2.toFixed(2) +
			'  liveAmpMax=' + ampMax.toExponential(2) + '/' + P.live.cap);
		if (ampMax > P.live.cap * 1.0001) L.fail(sp.tag + ': live amplitude exceeds cap');
	}
	if (med150 / med30 < 0.90 || med150 / med30 > 1.10)
		L.fail(sp.tag + ': median R drifted x' + (med150 / med30).toFixed(3));
	/* clumping is gated cross-run vs the first run (the check-live-mode rule:
	 * patterning legitimately sharpens the radial profile; only excess over the
	 * no-feedback baseline is clumping). */
	if (!clumpRef) clumpRef = pm150;
	if (pm150 > clumpRef * 1.25) L.fail(sp.tag + ': radial clumping peak/mean ' + pm150.toFixed(2));
});

/* ---- mechanism hints: gfb on/off at the same IC scheme ---- */
runs.forEach(function(a) {
	runs.forEach(function(b2) {
		if (b2.gfb > a.gfb && b2.split === a.split) {
			console.log('verdict hints (' + a.tag + ' vs ' + b2.tag + '): armedTu ' +
				a.armedTu.toFixed(0) + ' vs ' + b2.armedTu.toFixed(0) +
				', outer duty ' + a.duty[2].toFixed(2) + ' vs ' + b2.duty[2].toFixed(2) +
				', r(C,A2) ' + a.rCA2.toFixed(2) + ' vs ' + b2.rCA2.toFixed(2));
		}
	});
});

/* ---- A/B gates: each S2b spec vs its legacy twin (same gfb, split 0).
 * Calibrated against the measured floors (finding 5) and per finding 20:
 * the all-class outer amp at settle is NOT the S2 seed's to claim (the young
 * turn-on response dominates it), so the gates here are history-shape and
 * no-harm claims, not amplitude restoration. */
var pairs = 0;
runs.forEach(function(s2b) {
	if (!(s2b.split > 0)) return;
	var leg = null, i;
	for (i = 0; i < runs.length; i++) if (runs[i].gfb === s2b.gfb && !(runs[i].split > 0)) leg = runs[i];
	if (!leg) return;
	pairs++;
	var tag = 'S2b ' + s2b.tag + ' vs legacy ' + leg.tag;
	console.log('A/B ' + tag + ':');
	console.log('  settle outer A2 (coh 0-4): ' + s2b.settleCoh.toFixed(3) + ' vs ' + leg.settleCoh.toFixed(3) +
		'  warm: ' + s2b.warmSettleCoh.toFixed(3) + ' vs ' + leg.warmSettleCoh.toFixed(3));
	console.log('  late births: ' + s2b.lateBirths + ' vs ' + leg.lateBirths);
	console.log('  inner late: ' + s2b.late[0].toFixed(3) + ' vs ' + leg.late[0].toFixed(3));
	if (s2b.settleCoh < 0.5 * leg.settleCoh)
		L.fail(tag + ': view-start organization collapsed (' + s2b.settleCoh.toFixed(3) + ' < 0.5x ' + leg.settleCoh.toFixed(3) + ')');
	if (s2b.lateBirths > leg.lateBirths)
		L.fail(tag + ': extra late epoch births (' + s2b.lateBirths + ' > ' + leg.lateBirths + ')');
	if (s2b.late[0] < 0.7 * leg.late[0])
		L.fail(tag + ': inner steady state degraded (' + s2b.late[0].toFixed(3) + ' < ' + (0.7 * leg.late[0]).toFixed(3) + ')');
});
L.pass('check-transient: history captured' + (pairs ? ', S2b gates pass (' + pairs + ' pair' + (pairs > 1 ? 's' : '') + ')' : ''));
