/* 0.5.0 study step 3 — CLOSED LOOP gain ladder (plan section 4.3):
 * calm preset, SelfGrav global solver ticking every substep, gains from argv
 * plus the g=0 twin, sampling every 2 tu to T=150. Instrument = the
 * check-live-mode / check-transient apertures.
 *
 *   node experiments/check-selfgrav-loop.js                # default ladder
 *   node experiments/check-selfgrav-loop.js 0.1 0.25 0.5 1
 *   env: NSTARS (10000), SEED, TMAX (150)
 *
 * Per sample: mass-weighted m=2 phasor per band (inner 1-2.5, mid 2.5-4,
 * outer 4-5, far 4.5-5.5), pattern frame + winding. Reports per band: coherent
 * A2 over T=75-150, p50/p80, duty > 0.08, armed-epoch births after T=100;
 * plus live-table phase coherence, Q(R) drift (settle vs TMAX) and the
 * stability set.
 *
 * Decision rule (printed): the global solver earns a nonzero default only if
 * outer coherent A2 at T=75-150 grows monotonically with g and clears the
 * g=0 twin beyond the 40k noise floor, inner >= 0.7x twin. Stability gates
 * are hard; the decision itself is worklog material.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var SelfGrav = require('../selfgrav.js');

var N = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var TMAX = process.env.TMAX ? parseFloat(process.env.TMAX) : 150;
var DT = 0.01, SAMPLE = 2, T0 = 75;
var BANDS = [[1.0, 2.5], [2.5, 4.0], [4.0, 5.0], [4.5, 5.5]];
var ARMED = 0.08, GAP = 1;
var PROBE = [7, 11, 17];                 /* live bins ~R 2.0, 3.1, 4.5 */
var NS = Math.round((TMAX - 30) / SAMPLE) + 1;
var SSTR = 19;                           /* 4 bands x 3 + t + 3 live phasors x 2 */
var RLO = 0.4, RHI = 6.4;

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

var bRe = new Float64Array(4), bIm = new Float64Array(4), bW = new Float64Array(4);
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
	snaps[i0 + 12] = st.t;
	for (b = 0; b < 4; b++) {
		snaps[i0 + b * 3] = bRe[b]; snaps[i0 + b * 3 + 1] = bIm[b]; snaps[i0 + b * 3 + 2] = bW[b];
	}
	for (b = 0; b < 3; b++) {
		snaps[i0 + 13 + b * 2] = st.live.amp[PROBE[b]] * Math.cos(st.live.th[PROBE[b]]);
		snaps[i0 + 14 + b * 2] = st.live.amp[PROBE[b]] * Math.sin(st.live.th[PROBE[b]]);
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

function spread(snaps, ns, i0, i1) {
	var out = [], b, s, a;
	for (b = 0; b < 4; b++) {
		a = [];
		for (s = i0; s <= i1 && s < ns; s++) {
			var w = snaps[s * SSTR + b * 3 + 2];
			a.push(w > 0 ? Math.sqrt(Math.pow(snaps[s * SSTR + b * 3], 2) + Math.pow(snaps[s * SSTR + b * 3 + 1], 2)) / w : 0);
		}
		a.sort(function(x, y) { return x - y; });
		out.push({ p50: a[Math.floor(a.length / 2)], p80: a[Math.floor(a.length * 0.8)],
			duty: a.filter(function(v) { return v > ARMED; }).length / a.length });
	}
	return out;
}

/* armed epochs with gap merge (check-transient): count + late births (start >= T100) */
function epochs(snaps, ns, i0) {
	var out = { n: 0, late: 0, armedTu: 0 }, s, inEp = false, start = 0, gap = 0;
	for (s = i0; s < ns; s++) {
		var re = snaps[s * SSTR + 3 * 3], im = snaps[s * SSTR + 3 * 3 + 1], w = snaps[s * SSTR + 3 * 3 + 2];
		var amp = w > 0 ? Math.sqrt(re * re + im * im) / w : 0;
		if (amp > ARMED) {
			if (!inEp) { inEp = true; start = s; }
			gap = 0;
		} else if (inEp) {
			gap++;
			if (gap > GAP) { inEp = false; out.n++; out.armedTu += (s - gap - start + 1) * SAMPLE; }
		}
	}
	if (inEp) { out.n++; out.armedTu += (ns - start) * SAMPLE; }
	/* late births: first armed sample after index of T100 */
	var i100 = Math.max(0, Math.round((100 - 30) / SAMPLE));
	for (s = i0; s < ns; s++) {
		var re2 = snaps[s * SSTR + 9], im2 = snaps[s * SSTR + 10], w2 = snaps[s * SSTR + 11];
		var a2 = w2 > 0 ? Math.sqrt(re2 * re2 + im2 * im2) / w2 : 0;
		if (a2 > ARMED && s >= i100) {
			/* count only if this sample starts an epoch (prev unarmed) */
			var pr = s > 0 ? snaps[(s - 1) * SSTR + 11] : 0;
			var prr = s > 0 ? snaps[(s - 1) * SSTR + 9] : 0, pri = s > 0 ? snaps[(s - 1) * SSTR + 10] : 0;
			var pa = pr > 0 ? Math.sqrt(prr * prr + pri * pri) / pr : 0;
			if (pa <= ARMED) out.late++;
		}
	}
	return out;
}

function tableCoh(snaps, ns, i0, probe) {
	var re = 0, im = 0, mag = 0, s;
	for (s = i0; s < ns; s++) {
		var a = snaps[s * SSTR + 13 + probe * 2], b = snaps[s * SSTR + 14 + probe * 2];
		re += a; im += b; mag += Math.sqrt(a * a + b * b);
	}
	var m = Math.sqrt(re * re + im * im);
	return mag > 0 ? m / mag : 0;
}

/* Toomre Q(R) snapshot: sigR from vR moments of disk classes */
function qProfile(P, st) {
	var bins = 16, dr = (RHI - RLO) / bins;
	var m0 = new Float64Array(bins), vr1 = new Float64Array(bins), vr2 = new Float64Array(bins), cnt = new Float64Array(bins);
	var mass = st.live.mass, i;
	for (i = 0; i < st.n; i++) {
		var m = mass[st.cls[i]];
		if (m === 0) continue;
		var R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		var b = Math.floor((R - RLO) / dr);
		if (b < 0 || b >= bins) continue;
		var vR = (st.x[i] * st.vx[i] + st.y[i] * st.vy[i]) / R;
		m0[b] += m; vr1[b] += m * vR; vr2[b] += m * vR * vR; cnt[b]++;
	}
	var qmin = Infinity, qminR = 0;
	var area = new Float64Array(bins);
	for (i = 0; i < bins; i++) {
		var rlo = RLO + i * dr, rhi2 = rlo + dr;
		area[i] = Math.PI * (rhi2 * rhi2 - rlo * rlo);
		if (cnt[i] < 40 || m0[i] <= 0) continue;
		/* mass-weighted moments: divide by SUM(m), not star count */
		var mu = vr1[i] / m0[i], mu2 = vr2[i] / m0[i];
		var sigR = Math.sqrt(Math.max(0, mu2 - mu * mu));
		var sig0 = m0[i] / area[i];
		var rc = rlo + dr / 2;
		var Q = Galaxy.kappa(rc, P) * sigR / (3.36 * P.G * sig0);
		if (Q > 0 && Q < qmin) { qmin = Q; qminR = rc; }
	}
	return { qmin: qmin, qminR: qminR };
}

function run(live, gfb) {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = gfb;
	var t0 = Date.now();
	if (live) { P.live.freeze = true; P.live.cap = 0.10; SelfGrav.ensure(P); P.sg.solver = 1; }
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, SEED || P.seed);
	var snaps = new Float64Array(NS * SSTR), ns = 0, ampMax = 0, i, k;
	/* settle (chunked ticks when live) */
	var total = Math.round(P.tsettle / P.dtSettle), c = 0;
	while (c < total) {
		var m = Math.min(live ? P.sg.refresh : total, total - c);
		Galaxy.settle(st, P, m, P.dtSettle, false, true);
		if (live) SelfGrav.step(st, P, st.t, P.dtSettle, m, Galaxy.liveGain(P, true, false));
		c += m;
	}
	var q0 = qProfile(P, st);
	sample(P, st, snaps, 0); ns = 1;
	while (st.t < TMAX - 1e-9 && ns < NS) {
		for (k = 0; k < Math.round(SAMPLE / DT); k++) {
			Galaxy.step(st, P, DT, false, true);
			if (live) SelfGrav.step(st, P, st.t, DT, 1, Galaxy.liveGain(P, true, false));
		}
		for (i = 0; i < st.live.nb; i++) if (st.live.amp[i] > ampMax) ampMax = st.live.amp[i];
		sample(P, st, snaps, ns * SSTR);
		ns++;
	}
	var lateI = Math.max(1, Math.round((T0 - 30) / SAMPLE));
	var late = coherent(snaps, ns, lateI, ns - 1, new Float64Array(4));
	var settleA = coherent(snaps, ns, 0, 0, new Float64Array(4));
	var sp = spread(snaps, ns, lateI, ns - 1);
	var ep = epochs(snaps, ns, lateI);
	var buf = new Float64Array(N), med = L.median(L.radii(st, buf), st.n);
	var h = L.hist(L.radii(st, buf), st.n, 0, 6, 20), pk = 0;
	for (i = 0; i < h.length; i++) if (h[i] > pk) pk = h[i];
	var pm = pk * h.length;
	var q1 = qProfile(P, st);
	console.log('g=' + gfb + (live ? '' : ' (twin)') + '  (~' + ((Date.now() - t0) / 1000).toFixed(0) +
		's, N=' + N + ', caps=' + st.caps + ', ampMax=' + ampMax.toExponential(2) + '/' + P.live.cap +
		', medR=' + med.toFixed(3) + ', pk/mean=' + pm.toFixed(2) + ')');
	console.log('  band        settle   late75-150  p50/p80    duty');
	for (i = 0; i < 4; i++)
		console.log('  ' + BANDS[i][0].toFixed(1) + '-' + BANDS[i][1].toFixed(1) + '     ' +
			settleA[i].toFixed(3) + '     ' + late[i].toFixed(3) + '      ' +
			sp[i].p50.toFixed(3) + '/' +(sp[i].p80).toFixed(3) + '   ' + sp[i].duty.toFixed(2));
	console.log('  outer epochs=' + ep.n + ' lateBirths=' + ep.late + ' armedTu=' + ep.armedTu +
		'  tableCoh R2.0/R3.1/R4.5=' + tableCoh(snaps, ns, lateI, 0).toFixed(2) + '/' +
		tableCoh(snaps, ns, lateI, 1).toFixed(2) + '/' + tableCoh(snaps, ns, lateI, 2).toFixed(2));
	console.log('  minQ settle ' + q0.qmin.toFixed(2) + '@' + q0.qminR.toFixed(1) +
		' -> T' + TMAX.toFixed(0) + ' ' + q1.qmin.toFixed(2) + '@' + q1.qminR.toFixed(1));
	return { late: late, med: med, pm: pm, ampMax: ampMax, qmin: q1.qmin, P: P,
		inner: late[0], outer: late[2], far: late[3] };
}

var gains = process.argv.slice(2).map(parseFloat);
if (!gains.length) gains = [0.1, 0.25, 0.5, 1.0];
console.log('0.5.0 closed loop: global solver, ladder [' + gains.join(' ') + '] + g=0 twin, N=' + N + ' TMAX=' + TMAX);

var twin = run(false, 0);
var runs = [], fails = [];
gains.forEach(function(g) { runs.push(run(true, g)); });

runs.forEach(function(r, i) {
	var tag = 'g=' + gains[i];
	if (r.ampMax > r.P.live.cap * 1.0001) fails.push(tag + ': ampMax ' + r.ampMax.toExponential(2) + ' > cap');
	if (r.med / twin.med < 0.90 || r.med / twin.med > 1.10) fails.push(tag + ': median R x' + (r.med / twin.med).toFixed(3));
	if (r.pm > twin.pm * 1.25) fails.push(tag + ': radial peak/mean ' + r.pm.toFixed(2));
	if (r.inner < 0.7 * twin.inner) fails.push(tag + ': inner coherent ' + r.inner.toFixed(3) + ' < 0.7x twin ' + twin.inner.toFixed(3));
	if (r.qmin < 1.5) fails.push(tag + ': min Q ' + r.qmin.toFixed(2) + ' < 1.5');
});
fails.forEach(function(f) { L.fail('check-selfgrav-loop ' + f); });

/* decision rule, printed for the worklog */
var outerSeries = runs.map(function(r) { return r.outer; });
var mono = true;
for (var i = 1; i < outerSeries.length; i++) if (outerSeries[i] < outerSeries[i - 1]) mono = false;
var clears = outerSeries.every(function(v) { return v > twin.outer + 0.04; });
console.log('decision: outer late A2 twin=' + twin.outer.toFixed(3) + ' ladder=[' +
	outerSeries.map(function(v) { return v.toFixed(3); }).join(', ') + ']');
console.log('  monotonic in g: ' + mono + '   clears twin+0.04 everywhere: ' + clears +
	'   inner gate: ' + runs.every(function(r) { return r.inner >= 0.7 * twin.inner; }));
console.log('  -> earns nonzero default only if both true AND inner >= 0.7x (plan 4.3)');
L.pass('check-selfgrav-loop stability gates hold; decision numbers above');
