/* Phase audit: where does the disk's m=2 density crest sit relative to the
 * potential's own hill and well? (0.4.1 next step: the inner response read
 * "~pi" off the winding-law reference at t=30 - real physics or convention?
 * Answer, 0.4.2: convention. The reference is the hill; the response crests
 * in the well, in phase with the forcing. Shipping seed moved to the well.)
 *
 *   node experiments/check-arm-phase.js            # gate + tables
 *   env: NSTARS (10000), SEED, PHASE (part C seed azimuth, deg from the hill;
 *   default P.alignPhase = 0 = shipping, 90 = seed at the well)
 *
 * A. potential geometry, no stars: scan phi at fixed R and locate the hill
 *    (max Phi) and the well (min Phi) of the spiral term relative to the
 *    reference azimuth ref(R) = Om*t + p*L(R) that every script here (and
 *    alignEpicycles) calls the "crest". Same for the bar (ref = Om_b*t).
 * B. response: align=0 run (the potential's own response, nothing seeded),
 *    narrow annuli, per class: azimuth of the m=2 density crest relative to
 *    the WELL, folded to (-90, 90]. 0 = crest in the trough, +-90 = on the
 *    hill. Snapshot at settle plus the coherent T=75-150 window (finding 23).
 * C. seeding: with the shipping ICs, the warm classes' crest right after
 *    initStars (t=0: the pure S2 seed signature) and the S2b boundary seed's
 *    own signature (outer warm phasor just before vs just after the event),
 *    both against the well - and against the young disk, which is never
 *    seeded and marks where the disk itself responds.
 * D. bar: bar-only run (check-resonances config), unfolded bar-frame phasor
 *    of the x1 zone against the bar's hill/well.
 *
 * Verdict is printed at the end; archive/0.4.2-worklog.md has the numbers.
 * Gates: potential geometry (hill at ref, well 90 deg off), inner ILR-CR
 * response within 25 deg of the well (young + all, settle and late), bar x1
 * body along the bar well, and the shipping seed's own signature (part C)
 * within 60 deg of the well in the outer band.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

var N = parseInt(process.env.NSTARS || '10000', 10);
var SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 0;
var PHASE = process.env.PHASE !== undefined ? parseFloat(process.env.PHASE) * Math.PI / 180 : undefined;
var DT = 0.01, SAMPLE = 5, TMAX = 150, TLATE = 75;
var RLO = 0.75, DR = 0.25, NB = 17;                 /* annuli 0.75 .. 5.0 */
var GROUPS = ['all', 'young', 'thin', 'thick'];      /* mass-weighted disk, cls 5, cls 0, cls 1 */
var DEG = 180 / Math.PI;
var CORE_LO = 1.5, CORE_HI = 2.75;                   /* ILR-CR core zone gated in B */
var GATE_CORE_DEG = 25;

function fold90(d) { return ((d + 90) % 180 + 180) % 180 - 90; }
function fmt(v, n) { return (v >= 0 ? ' ' : '') + v.toFixed(n === undefined ? 1 : n); }

function calm() {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	return P;
}

function Lof(P, R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

function refSpiral(P, R, t) { return P.spiral.om * t + Galaxy.spiralP(P) * Lof(P, R); }

/* ---- A. potential geometry ------------------------------------------------ */

/* Azimuth offsets (deg, folded to m=2) of the hill and the well of the
 * non-axisymmetric term from the reference azimuth, by brute-force phi scan. */
function hillWell(P, R, t, ref, o) {
	var best = Infinity, worst = -Infinity, bphi = 0, wphi = 0, k, phi, v;
	for (k = 0; k < 1440; k++) {
		phi = k / 1440 * 2 * Math.PI;
		v = Galaxy.potential(R * Math.cos(phi), R * Math.sin(phi), 0, t, P, o);
		if (v < best) { best = v; wphi = phi; }
		if (v > worst) { worst = v; bphi = phi; }
	}
	return { hill: fold90((bphi - ref) * DEG), well: fold90((wphi - ref) * DEG), depth: worst - best };
}

var geomFail = [];
function partA() {
	var P = calm(), Pb = Galaxy.defaultParams(), o = { bar: false, spiral: true, ramp: 1 }, ob = { bar: true, spiral: false, ramp: 1 };
	var radii = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0], times = [0, 30, 47.3], i, j, R, t, hw;
	console.log('A. spiral term: Phi_s = +As*f(R)*cos(2*(phi - ref)), As=' + P.spiral.as + ' > 0, ref = Om*t + p*L(R)');
	console.log('   R      t     hill-ref   well-ref   depth');
	for (i = 0; i < radii.length; i++) {
		R = radii[i];
		for (j = 0; j < times.length; j++) {
			t = times[j];
			hw = hillWell(P, R, t, refSpiral(P, R, t), o);
			if (j === 1) console.log('  ' + R.toFixed(2) + '   ' + fmt(t, 1) + '   ' + fmt(hw.hill) + '      ' + fmt(hw.well) + '     ' + hw.depth.toExponential(2));
			if (Math.abs(hw.hill) > 2) geomFail.push('spiral hill off ref by ' + hw.hill.toFixed(1) + ' deg at R=' + R + ' t=' + t);
			if (Math.abs(Math.abs(hw.well) - 90) > 2) geomFail.push('spiral well not 90 deg from ref at R=' + R + ' t=' + t);
		}
	}
	console.log('   bar term: Phi_b = +ab*f(R)*cos(2*(phi - Om_b*t)), ab=' + Pb.bar.ab + ' > 0, ref = Om_b*t');
	radii = [0.8, 1.2, 1.6];
	for (i = 0; i < radii.length; i++) {
		R = radii[i]; t = 30;
		hw = hillWell(Pb, R, t, Pb.bar.om * t, ob);
		console.log('  ' + R.toFixed(2) + '   ' + fmt(t, 1) + '   ' + fmt(hw.hill) + '      ' + fmt(hw.well) + '     ' + hw.depth.toExponential(2));
		if (Math.abs(hw.hill) > 2) geomFail.push('bar hill off ref by ' + hw.hill.toFixed(1) + ' deg at R=' + R);
	}
	console.log('   => the reference azimuth every script calls the "crest" is the potential HILL;');
	console.log('      the trough (well) is 90 deg away in azimuth = pi in the m=2 phasor.\n');
}

/* ---- phasor accumulation -------------------------------------------------- */

function Acc() {
	return { re: new Float64Array(4 * NB), im: new Float64Array(4 * NB), w: new Float64Array(4 * NB), n: new Float64Array(4 * NB) };
}

/* Add one snapshot: phasor exp(2i(phi - ref)) per annulus and group. */
function accumulate(a, P, st) {
	var mass = st.live.mass, i, c, m, R, b, ph, ang, cr, sr, g;
	for (i = 0; i < st.n; i++) {
		c = st.cls[i];
		if (c !== 0 && c !== 1 && c !== 5) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		b = Math.floor((R - RLO) / DR);
		if (b < 0 || b >= NB) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		ang = 2 * (ph - refSpiral(P, R, st.t));
		cr = Math.cos(ang); sr = Math.sin(ang);
		m = mass[c];
		a.re[b] += m * cr; a.im[b] += m * sr; a.w[b] += m; a.n[b]++;
		g = c === 5 ? 1 : c === 0 ? 2 : 3;
		a.re[g * NB + b] += cr; a.im[g * NB + b] += sr; a.w[g * NB + b] += 1; a.n[g * NB + b]++;
	}
}

/* amplitude and crest offset from the WELL (deg, folded) of group g, bin b */
function ampOf(a, g, b) {
	var k = g * NB + b;
	return a.w[k] > 0 ? Math.sqrt(a.re[k] * a.re[k] + a.im[k] * a.im[k]) / a.w[k] : 0;
}
function wellOf(a, g, b) {
	var k = g * NB + b;
	return fold90(Math.atan2(a.im[k], a.re[k]) * DEG / 2 - 90);
}

function printTable(a, label) {
	var b, g, s;
	console.log(label);
	console.log('   R       n     ' + GROUPS.map(function(n) { return (n + '       ').slice(0, 6) + 'amp dWell'; }).join('   '));
	for (b = 0; b < NB; b++) {
		s = '  ' + (RLO + (b + 0.5) * DR).toFixed(2) + '  ' + ('      ' + a.n[b].toFixed(0)).slice(-6) + '   ';
		for (g = 0; g < 4; g++) {
			if (a.n[g * NB + b] < 30) { s += '      --    --    '; continue; }
			s += '     ' + ampOf(a, g, b).toFixed(3) + ' ' + ('     ' + fmt(wellOf(a, g, b), 0)).slice(-5) + '  ';
		}
		console.log(s);
	}
}

function coreCheck(a, tag, fails) {
	var b, g, R, d;
	for (b = 0; b < NB; b++) {
		R = RLO + (b + 0.5) * DR;
		if (R < CORE_LO || R > CORE_HI) continue;
		for (g = 0; g < 2; g++) {
			d = wellOf(a, g, b);
			if (Math.abs(d) > GATE_CORE_DEG)
				fails.push(tag + ' ' + GROUPS[g] + ' R=' + R.toFixed(2) + ' crest ' + d.toFixed(0) + ' deg from the well');
		}
	}
}

/* ---- B. the potential's own response (align=0) --------------------------- */

var respFail = [];
function partB() {
	var P = calm(), st = Galaxy.createState(N), settle = Acc(), late = Acc(), k, s, t0 = Date.now();
	P.align = 0;
	st.n = N;
	Galaxy.initStars(st, P, SEED || P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
	accumulate(settle, P, st);
	for (s = 1; st.t < TMAX - 1e-9; s++) {
		for (k = 0; k < Math.round(SAMPLE / DT); k++) Galaxy.step(st, P, DT, false, true);
		if (st.t >= TLATE - 1e-9) accumulate(late, P, st);
	}
	console.log('B. align=0 (no seeding): m=2 crest offset from the potential WELL, deg folded to (-90,90]');
	console.log('   spiral ILR ' + Galaxy.resonances(P).spiral.ilr[0].toFixed(2) + '  CR ' + Galaxy.resonances(P).spiral.cr[0].toFixed(2) +
		'  OLR ' + Galaxy.resonances(P).spiral.olr[0].toFixed(2) + '  N=' + N + ' (~' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
	printTable(settle, '   at settle t=30 (snapshot):');
	printTable(late, '   coherent window T=75-150 (mean phasor of 16 samples):');
	coreCheck(settle, 'settle', respFail);
	coreCheck(late, 'late', respFail);
	console.log('');
}

/* ---- C. what the S2 / S2b seeding puts where ------------------------------ */

function bandPhasor(a, g, lo, hi) {
	var re = 0, im = 0, w = 0, b, R, k;
	for (b = 0; b < NB; b++) {
		R = RLO + (b + 0.5) * DR;
		if (R < lo || R > hi) continue;
		k = g * NB + b;
		re += a.re[k]; im += a.im[k]; w += a.w[k];
	}
	return { re: re, im: im, w: w, amp: w > 0 ? Math.sqrt(re * re + im * im) / w : 0,
		well: fold90(Math.atan2(im, re) * DEG / 2 - 90) };
}

var seedInfo = {}, seedPhaseDeg = 0;
function partC() {
	var P = calm(), st = Galaxy.createState(N), a = Acc(), t0 = Date.now();
	var steps = Math.round(P.tsettle / P.dtSettle), g, s, line;
	if (PHASE !== undefined) P.alignPhase = PHASE;
	seedPhaseDeg = P.alignPhase * DEG;
	st.n = N;
	Galaxy.initStars(st, P, SEED || P.seed);              /* shipping ICs: align=1, alignSplit=3 */
	accumulate(a, P, st);
	console.log('C. shipping ICs (align=' + P.align + ', alignSplit=' + P.alignSplit + ', alignPhase=' +
		(P.alignPhase * DEG).toFixed(0) + 'deg from the hill): seed signature vs the well');
	console.log('   t=0 right after initStars (inner seed only, R<=' + P.alignSplit + '; young never seeded):');
	line = '     R 1.25-2.75  ';
	for (g = 1; g < 4; g++) { s = bandPhasor(a, g, 1.25, 2.75); line += GROUPS[g] + ' amp ' + s.amp.toFixed(3) + ' dWell ' + fmt(s.well, 0) + '   '; }
	console.log(line);
	seedInfo.t0thin = bandPhasor(a, 2, 1.25, 2.75); seedInfo.t0thick = bandPhasor(a, 3, 1.25, 2.75);
	/* S2b event: the outer warm phasor one substep before and right after */
	Galaxy.settle(st, P, steps - 1, P.dtSettle, false, true);
	if (st.seededOuter) L.fail('S2b event fired before the boundary');
	var pre = Acc(), post = Acc();
	accumulate(pre, P, st);
	Galaxy.settle(st, P, 1, P.dtSettle, false, true);
	if (!st.seededOuter) L.fail('S2b event did not fire at the boundary');
	accumulate(post, P, st);
	console.log('   t=30 boundary seed (R>' + P.alignSplit + '), outer band 3.25-5.0:');
	line = '     before   ';
	for (g = 1; g < 4; g++) { s = bandPhasor(pre, g, 3.25, 5.0); line += GROUPS[g] + ' amp ' + s.amp.toFixed(3) + ' dWell ' + fmt(s.well, 0) + '   '; }
	console.log(line);
	line = '     after    ';
	for (g = 1; g < 4; g++) { s = bandPhasor(post, g, 3.25, 5.0); line += GROUPS[g] + ' amp ' + s.amp.toFixed(3) + ' dWell ' + fmt(s.well, 0) + '   '; }
	console.log(line);
	/* the seed's own contribution = phasor difference (same stars, same weights) */
	var pt = bandPhasor(pre, 2, 3.25, 5.0), qt = bandPhasor(post, 2, 3.25, 5.0);
	var dre = qt.re - pt.re, dim = qt.im - pt.im;
	seedInfo.s2b = { amp: Math.sqrt(dre * dre + dim * dim) / qt.w, well: fold90(Math.atan2(dim, dre) * DEG / 2 - 90) };
	console.log('     thin seed signature (after - before): amp ' + seedInfo.s2b.amp.toFixed(3) + ' dWell ' + fmt(seedInfo.s2b.well, 0));
	seedInfo.young30 = bandPhasor(post, 1, 3.25, 5.0);
	/* relock check: inner warm classes after the settle, against the well */
	line = '   t=30 inner 1.25-2.75 after the settle: ';
	for (g = 1; g < 4; g++) { s = bandPhasor(post, g, 1.25, 2.75); line += GROUPS[g] + ' amp ' + s.amp.toFixed(3) + ' dWell ' + fmt(s.well, 0) + '   '; }
	console.log(line + '(~' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
}

/* ---- D. bar-only: unfolded x1 orientation --------------------------------- */

var barInfo = {};
function partD() {
	var P = Galaxy.defaultParams(), Nb = 4000, st = Galaxy.createState(Nb), k, i, t0 = Date.now();
	P.align = 0;
	st.n = Nb;
	Galaxy.initStars(st, P, SEED || P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, false);
	for (k = 0; k < Math.round(100 / DT); k++) Galaxy.step(st, P, DT, true, false);
	var barAng = P.bar.om * st.t, re = 0, im = 0, cnt = 0, along = 0, across = 0;
	for (i = 0; i < Nb; i++) {
		if (st.cls[i] !== 0 && st.cls[i] !== 1 && st.cls[i] !== 5) continue;
		var R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < 0.9 || R > 1.9) continue;
		var ph = Math.atan2(st.y[i], st.x[i]) - barAng;
		re += Math.cos(2 * ph); im += Math.sin(2 * ph); cnt++;
		var xb = st.x[i] * Math.cos(barAng) + st.y[i] * Math.sin(barAng), yb = -st.x[i] * Math.sin(barAng) + st.y[i] * Math.cos(barAng);
		if (Math.abs(xb) > 1.5 * Math.abs(yb)) along++;
		if (Math.abs(yb) > 1.5 * Math.abs(xb)) across++;
	}
	barInfo.amp = Math.sqrt(re * re + im * im) / cnt;
	barInfo.hill = fold90(Math.atan2(im, re) * DEG / 2);
	barInfo.well = fold90(barInfo.hill - 90);
	console.log('D. bar only (Om_b ' + P.bar.om + ', ab ' + P.bar.ab + '), disk 0.9<R<1.9 at T=100: bar-frame m=2 amp ' + barInfo.amp.toFixed(3) +
		', crest ' + fmt(barInfo.hill, 0) + ' deg from the hill (Om_b*t), ' + fmt(barInfo.well, 0) + ' deg from the well');
	console.log('   stars elongated along the hill axis |xb|>1.5|yb|: ' + along + ', across it |yb|>1.5|xb|: ' + across +
		' of ' + cnt + ' (~' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
}

partA();
partB();
partC();
partD();

/* ---- verdict + gates ------------------------------------------------------ */
console.log('verdict:');
console.log(' - convention: ref = Om*t + p*L(R) is the potential HILL (+As cos), the arm trough is ref +- 90 deg.');
console.log(' - the inner response (align=0, ILR-CR) sits in the trough: its m=2 phasor is pi from ref = 0 from the well.');
console.log('   That is the in-phase forced response inside corotation - disk physics, not an artifact; the "~pi" was the');
console.log('   reference (hill) being read as the crest. Beyond CR the crest swings toward the hill (anti-phase zone).');
console.log(' - seed (alignPhase ' + (seedPhaseDeg).toFixed(0) + ' deg from the hill): inner warm seed t=0 dWell thin ' + fmt(seedInfo.t0thin.well, 0) + ' thick ' + fmt(seedInfo.t0thick.well, 0) +
	'; S2b boundary seed dWell ' + fmt(seedInfo.s2b.well, 0) + ' vs the young disk there ' + fmt(seedInfo.young30.well, 0) + '.');
console.log(' - bar x1 zone crest ' + fmt(barInfo.hill, 0) + ' deg from Om_b*t: the bar body lies along the WELL (Om_b*t + 90 deg).');
geomFail.forEach(function(m) { L.fail('A: ' + m); });
respFail.forEach(function(m) { L.fail('B: ' + m); });
if (PHASE === undefined && Math.abs(seedInfo.s2b.well) > 60)
	L.fail('C: shipping S2b seed lands ' + seedInfo.s2b.well.toFixed(0) + ' deg from the well (fights the response)');
if (Math.abs(Math.abs(barInfo.hill) - 90) > 20) L.fail('D: bar x1 crest not along the well: ' + barInfo.hill.toFixed(0) + ' deg from the hill');
L.pass('check-arm-phase: ref is the hill, inner arms sit in the trough (in-phase forced response), seed and bar body along the well');
