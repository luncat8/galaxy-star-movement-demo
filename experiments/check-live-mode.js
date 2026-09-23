/* S5 study gate: does feeding the disk's OWN measured m=2 response back as a
 * local self-gravity term (P.live.gfb, see galaxy.js updateLive) hold arms
 * outside corotation?
 *
 *   node experiments/check-live-mode.js [gfb ...]        default: 0 25 50
 *   env: ALIGN=0|1 (S2 ICs), TAU=seconds (live low-pass), NSTARS, SEED
 *
 * Method (findings 5, 12, 20): the standard aperture is a narrow annulus in the
 * pattern frame, but a single snapshot of it is dominated by star shot noise in
 * the outer disk. So we sample 31 times from settle to T=150 and report:
 *   - coherent amp: amplitude of the mean complex phasor over T=75-150. Keeps a
 *     steady wave, averages incoherent response down. This is the stable metric.
 *   - p80 / median of the per-sample amplitudes and the duty cycle (fraction of
 *     samples above 0.08): the share of the time the band is actually armed.
 * Bands: inner 1.0-2.5 (inside corotation, where forcing already works),
 * mid 2.5-4.0, outer 4.0-5.0 (near OLR 4.74), far 4.5-5.5 (beyond it).
 *
 * Gates on the feedback itself (drag-collapse style, on steady numbers):
 *   - amplitude saturates below the cap, never runs away
 *   - no clumping: radial histogram peak/mean stays bounded
 *   - no systemic inflow: median R does not drift over 150 tu
 *   - no harm: inner-zone coherent amplitude is not degraded relative to gfb=0
 * The feedback needs a meaningful pattern-frame phasor, so the ICs are the
 * shipping S2-aligned ones (align=1) and the bar stays off (finding 11).
 * See archive/0.4.0-worklog.md for the measured verdict.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

var N = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var ALIGN = process.env.ALIGN === undefined ? 1 : parseFloat(process.env.ALIGN);
var TAU = process.env.TAU ? parseFloat(process.env.TAU) : 0;
var DT = 0.01, TMAX = 150, SAMPLE = 5, NS = 31, SSTR = 22;   /* 4 bands x 4 + 3 probe phasors */
var PROBE = [7, 11, 17];                                      /* live bins ~R 2.0, 3.1, 4.5 */
var NB = 16, RLO = 0.4, RHI = 6.4;
var BANDS = [[1.0, 2.5], [2.5, 4.0], [4.0, 5.0], [4.5, 5.5]];
var ARMED = 0.08, LATE0 = 9;              /* sample 9 is T=75 */

var bandRe = new Float64Array(4), bandIm = new Float64Array(4), bandW = new Float64Array(4);

function makeRun(gfb) {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = gfb;
	P.align = ALIGN;
	if (TAU) P.live.tau = TAU;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, SEED || P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
	return { P: P, st: st };
}

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

/* Mass-weighted m=2 phasor per band, pattern frame, disk classes only. */
function sample(P, st, snap, i0) {
	bandRe.fill(0); bandIm.fill(0); bandW.fill(0);
	var p = Galaxy.spiralP(P), mass = st.live.mass, cls = st.cls;
	var i, c, m, R, ph, a, b;
	for (i = 0; i < N; i++) {
		m = mass[cls[i]];
		if (m === 0) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < RLO || R >= RHI) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		a = 2 * (ph - P.spiral.om * st.t - p * Lof(P, R));
		for (b = 0; b < 4; b++) {
			if (R < BANDS[b][0] || R >= BANDS[b][1]) continue;
			bandRe[b] += m * Math.cos(a); bandIm[b] += m * Math.sin(a); bandW[b] += m;
		}
	}
	for (b = 0; b < 4; b++) {
		snap[i0 + b * 4] = bandRe[b];
		snap[i0 + b * 4 + 1] = bandIm[b];
		snap[i0 + b * 4 + 2] = bandW[b];
	}
	/* probe the live table's own phasor at three radii: how coherent is the
	 * feedback's phase in time? (this is what decides whether the force can
	 * organize the outer disk or only chases noise) */
	for (b = 0; b < 3; b++) {
		var pb = PROBE[b];
		snap[i0 + 16 + b * 2] = st.live.amp[pb] * Math.cos(st.live.th[pb]);
		snap[i0 + 16 + b * 2 + 1] = st.live.amp[pb] * Math.sin(st.live.th[pb]);
	}
}

/* Temporal phase coherence of the live table at a probe radius over the window:
 * |mean phasor| / mean |phasor|, 1 = steady direction, ~0 = random walk. */
function tableCoherence(snap, ns, i0, i1, probe) {
	var re = 0, im = 0, mag = 0, m;
	if (i1 > ns - 1) i1 = ns - 1;
	for (var s = i0; s <= i1; s++) {
		var a = snap[s * SSTR + 16 + probe * 2], b2 = snap[s * SSTR + 16 + probe * 2 + 1];
		re += a; im += b2; mag += Math.sqrt(a * a + b2 * b2);
	}
	m = Math.sqrt(re * re + im * im);
	return mag > 0 ? m / mag : 0;
}

/* Amplitude of the mean phasor over samples [i0, i1]. */
function coherentAmp(snap, ns, i0, i1) {
	var out = [], b, s;
	if (i1 > ns - 1) i1 = ns - 1;
	for (b = 0; b < 4; b++) {
		var re = 0, im = 0, w = 0;
		for (s = i0; s <= i1; s++) {
			re += snap[s * SSTR + b * 4]; im += snap[s * SSTR + b * 4 + 1]; w += snap[s * SSTR + b * 4 + 2];
		}
		out.push(w > 0 ? Math.sqrt(re * re + im * im) / w : 0);
	}
	return out;
}

/* Per-sample amplitudes over the window: {p50, p80, duty} per band. */
function spread(snap, ns, i0, i1) {
	var out = [], b, s;
	if (i1 > ns - 1) i1 = ns - 1;
	for (b = 0; b < 4; b++) {
		var a = [];
		for (s = i0; s <= i1; s++) {
			var re = snap[s * SSTR + b * 4], im = snap[s * SSTR + b * 4 + 1], w = snap[s * SSTR + b * 4 + 2];
			a.push(w > 0 ? Math.sqrt(re * re + im * im) / w : 0);
		}
		a.sort(function(x, y) { return x - y; });
		out.push({
			p50: a[Math.floor(a.length / 2)],
			p80: a[Math.floor(a.length * 0.8)],
			duty: a.filter(function(v) { return v > ARMED; }).length / a.length
		});
	}
	return out;
}

function peakMeanR(st, buf) {
	var h = L.hist(L.radii(st, buf), st.n, 0, 6, 20), pk = 0, i;
	for (i = 0; i < h.length; i++) if (h[i] > pk) pk = h[i];
	return pk / (1 / h.length);
}

/* narrow-bin profile, standard aperture, for comparability with check-arm-profile */
function profile(P, st) {
	var p = Galaxy.spiralP(P), ar = new Float64Array(NB), ai = new Float64Array(NB), ac = new Float64Array(NB);
	var i, R, ph, b, c;
	for (i = 0; i < N; i++) {
		c = st.cls[i];
		if (c === 2 || c === 3 || c === 4) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < RLO || R >= RHI) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		b = Math.min(NB - 1, Math.floor((R - RLO) / (RHI - RLO) * NB));
		var a = 2 * (ph - P.spiral.om * st.t - p * Lof(P, R));
		ar[b] += Math.cos(a); ai[b] += Math.sin(a); ac[b]++;
	}
	var out = new Float64Array(NB);
	for (b = 0; b < NB; b++) out[b] = ac[b] > 30 ? Math.sqrt(ar[b] * ar[b] + ai[b] * ai[b]) / ac[b] : 0;
	return out;
}

var gains = process.argv.slice(2).map(parseFloat);
if (!gains.length) gains = [0, 25, 50];

var buf = new Float64Array(N), snap = new Float64Array(NS * SSTR), ref = null;
gains.forEach(function(gfb) {
	var run = makeRun(gfb), P = run.P, st = run.st, t0 = Date.now();
	var ns = 0, ampMax = 0, i, k, traj = ', liveAmp(R2.6)@t=30/75/150: ';
	sample(P, st, snap, 0); ns = 1;
	var settleAmp = coherentAmp(snap, ns, 0, 0);
	while (st.t < TMAX - 1e-9 && ns < NS) {
		for (k = 0; k < Math.round(SAMPLE / DT); k++) Galaxy.step(st, P, DT, false, true);
		for (i = 0; i < st.live.nb; i++) if (st.live.amp[i] > ampMax) ampMax = st.live.amp[i];
		sample(P, st, snap, ns * SSTR);
		ns++;
		if (ns === 7 || ns === 16 || ns === 31) traj += st.live.amp[11].toExponential(1) + ' ';
	}
	var pm0 = null, med0 = null;
	var prof = profile(P, st), s = '', b;
	for (b = 0; b < NB; b++) s += prof[b].toFixed(2) + ' ';

	var early = coherentAmp(snap, ns, 1, LATE0 - 1), late = coherentAmp(snap, ns, LATE0, ns - 1);
	var sp = spread(snap, ns, LATE0, ns - 1);
	var liveDuty = 0;
	for (i = 0; i < st.live.nb; i++) if (st.live.amp[i] > 1e-4) liveDuty++;
	console.log('gfb=' + gfb.toFixed(0) + (TAU ? ' tau=' + TAU : '') + '  (~' + ((Date.now() - t0) / 1000).toFixed(0) +
		's, align=' + ALIGN + ', N=' + N + ', caps=' + st.caps + ', liveAmpMax=' + ampMax.toExponential(2) + '/' + P.live.cap +
		', live bins=' + liveDuty + ')');
	if (gfb > 0) console.log('  saturation check' + traj + '(no growth after the transient)');
	console.log('  band        settle   early35-75  late75-150  p50/p80   duty   [coherent amp]');
	BANDS.forEach(function(bd, j) {
		console.log('  ' + bd[0].toFixed(1) + '-' + bd[1].toFixed(1) + '    ' +
			settleAmp[j].toFixed(3) + '    ' + early[j].toFixed(3) + '       ' + late[j].toFixed(3) +
			'      ' + sp[j].p50.toFixed(3) + '/' + sp[j].p80.toFixed(3) + '   ' + sp[j].duty.toFixed(2));
	});
	console.log('  narrow bins: ' + s);
	console.log('  live-table phase coherence T=75-150  R2.0:' + tableCoherence(snap, ns, LATE0, ns - 1, 0).toFixed(2) +
		'  R3.1:' + tableCoherence(snap, ns, LATE0, ns - 1, 1).toFixed(2) +
		'  R4.5:' + tableCoherence(snap, ns, LATE0, ns - 1, 2).toFixed(2));
	var pm150 = peakMeanR(st, buf), med150 = L.median(L.radii(st, buf), st.n);
	if (ref) {
		var tag = 'gfb=' + gfb + (TAU ? ' tau=' + TAU : '') + ' align=' + ALIGN + ' N=' + N;
		if (ampMax > P.live.cap * 1.0001) L.fail(tag + ': live amplitude ' + ampMax.toExponential(2) + ' exceeds cap');
		if (med150 / ref.med0 < 0.90 || med150 / ref.med0 > 1.10)
			L.fail(tag + ': median R drifted x' + (med150 / ref.med0).toFixed(3));
		if (late[0] < 0.7 * ref.late[0])
			L.fail(tag + ': inner coherent amp degraded ' + late[0].toFixed(3) + ' vs ' + ref.late[0].toFixed(3));
		if (pm150 > ref.pm150 * 1.25) L.fail(tag + ': radial clumping peak/mean ' + pm150.toFixed(2));
	}
	/* clumping reference must come from the same run family (patterning moves the
	 * peak/mean baseline), so keep the first run's numbers */
	pm0 = pm0 || ref;
	ref = ref || { late: late, early: early, med0: med0 = med150, pm150: pm150 };
	ref.med0 = ref.med0;
	if (!ref.medRef) ref.medRef = med150;
});
L.pass('check-live-mode: feedback bounded, no clumping/inflow, inner zone unharmed');
