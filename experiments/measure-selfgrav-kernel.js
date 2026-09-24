/* 0.5.0 pre-flight: profile the production SelfGrav pipeline (env S5 SWEEP,
 * kernel input = amplitude x epicyclic x exp(-i(2Om+kap)t) / Q). Kernel was
 * audited standalone by 0.4.1-measure-potential-sweep; this one measures the
 * built path. Dump for the worklog: table.json / table.bin / uniform.json.
 *
 *   node experiments/measure-selfgrav-kernel.js           # all three eps
 *   env: NSTARS (20000), TEND (70), EPSSCAN='0.15' (one), SOLVER, LIVE=1, GAIN
 */
'use strict';
var fs = require('fs'), path = require('path'), L = require('./lib.js');
var Galaxy = L.Galaxy, SelfGrav = require('../selfgrav.js');
var N = parseInt(process.env.NSTARS || '20000', 10);
var TEND = process.env.TEND ? parseFloat(process.env.TEND) : 70;
var GAIN = process.env.GAIN ? parseFloat(process.env.GAIN) : 0;   /* measure with force off */
var epsList = (process.env.EPSSCAN || '0.08 0.15 0.30').split(/\s+/).map(parseFloat);
var NB = Galaxy.LIVE_NB;
var outDir = path.join(__dirname, 'logs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

var P = Galaxy.defaultParams();
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0;
/* gfb on (default): moments accumulate through the normal path; GAIN=0 means
 * writeTable drives amp=0, so the field is measured with no force applied */
P.live.gfb = (process.env.LIVE !== undefined ? parseFloat(process.env.LIVE) : 1);

var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);

var eps = parseFloat(process.env.EPS || '0.15');
var t0 = Date.now();
SelfGrav.ensure(P);                       /* creates P.sg (defaults) + builds */
if (P.sg.eps !== eps) { P.sg.eps = eps; SelfGrav.ensure(P); }   /* non-default eps: rebuild */
var buildMs = Date.now() - t0;
if (P.live.gfb > 0) { P.live.freeze = true; P.live.cap = P.sg.cap; P.sg.solver = 1; }
console.log('kernel eps=' + P.sg.eps + ' m=2: ' + buildMs + ' ms (build one signature; other eps reuse while fresh)');
if (buildMs > 100) L.fail('kernel build ' + buildMs + 'ms > 100ms gate');

/* settle with the S5 tick, force off (GAIN=0 -> writeTable drives amp=0) */
var c = 0, total = Math.round(P.tsettle / P.dtSettle);
while (c < total) {
	var m = Math.min(P.sg.refresh, total - c);
	Galaxy.settle(st, P, m, P.dtSettle, false, true);
	SelfGrav.step(st, P, st.t, P.dtSettle, m, 0);
	c += m;
}

var phiRe = new Float64Array(NB), phiIm = new Float64Array(NB), nAcc = 0;
var DT = 0.01;
while (st.t < TEND - 1e-9) {
	Galaxy.step(st, P, DT, false, true);
	var ref = SelfGrav.step(st, P, st.t, DT, 1, 0);
	if (ref && st.t > P.tsettle) {
		for (var i = 0; i < NB; i++) { phiRe[i] += SelfGrav.lastPhi.re[i]; phiIm[i] += SelfGrav.lastPhi.im[i]; }
		nAcc++;
	}
}
var uRe = new Float64Array(NB), uIm = new Float64Array(NB);
for (var b = 0; b < NB; b++) { uRe[b] = phiRe[b] / nAcc; uIm[b] = phiIm[b] / nAcc; }
fs.writeFileSync(path.join(outDir, 'selfgrav-table.json'),
	JSON.stringify({ N: N, TEND: TEND, eps: eps, buildMs: buildMs, samples: nAcc,
		uRe: Array.from(uRe), uIm: Array.from(uIm) }, null, 1));

/* --- pre-flight tables for the worklog: Q(R) and the mean |Phi| profile --- */
var bins = 16, RLO = Galaxy.LIVE_RLO, RHI = Galaxy.LIVE_RHI, dr = (RHI - RLO) / bins;
var m0 = new Float64Array(bins), vr1 = new Float64Array(bins), vr2 = new Float64Array(bins), cnt = new Float64Array(bins);
for (i = 0; i < st.n; i++) {
	var mm = st.live.mass[st.cls[i]];
	if (mm === 0) continue;
	var Rr = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
	var bi = Math.floor((Rr - RLO) / dr);
	if (bi < 0 || bi >= bins) continue;
	var vR = (st.x[i] * st.vx[i] + st.y[i] * st.vy[i]) / Rr;
	m0[bi] += mm; vr1[bi] += mm * vR; vr2[bi] += mm * vR * vR; cnt[bi]++;
}
console.log('Q profile (mass-weighted moments, Toomre):');
for (i = 0; i < bins; i++) {
	var rlo = RLO + i * dr, rc = rlo + dr / 2, area = Math.PI * ((rlo + dr) * (rlo + dr) - rlo * rlo);
	if (cnt[i] < 40 || m0[i] <= 0) continue;
	var mu = vr1[i] / m0[i], sigR = Math.sqrt(Math.max(0, vr2[i] / m0[i] - mu * mu));
	var sig0 = m0[i] / area;
	var Q = Galaxy.kappa(rc, P) * sigR / (3.36 * P.G * sig0);
	console.log('  R=' + rc.toFixed(2) + '  sigR=' + sigR.toFixed(3) + '  Sig=' + sig0.toExponential(2) +
		'  Q=' + Q.toFixed(2));
}
console.log('mean |Phi| (m=2, gain-0 pipeline, As=' + P.spiral.as + ' reference):');
var kB;
for (kB = 0; kB < NB; kB++) {
	var rcb = Galaxy.LIVE_RLO + (kB + 0.5) * ((Galaxy.LIVE_RHI - Galaxy.LIVE_RLO) / NB);
	var absPhi = Math.sqrt(uRe[kB] * uRe[kB] + uIm[kB] * uIm[kB]);
	console.log('  R=' + rcb.toFixed(2) + '  |Phi|=' + absPhi.toExponential(2) +
		'  /As=' + (absPhi / P.spiral.as).toFixed(3));
}

function ampOf(v) { return Math.sqrt(v.re * v.re + v.im * v.im); }
var s = { amp: [], th: [] }, g, i2;
for (g = 0; g < NB; g++) { s.amp.push(ampOf({ re: uRe[g], im: uIm[g] })); s.th.push(Math.atan2(uIm[g], uRe[g])); }
fs.writeFileSync(path.join(outDir, 'selfgrav-uniform.json'), JSON.stringify(s));
var arr = new Float32Array(NB * 2);
for (g = 0; g < NB; g++) { arr[g * 2] = s.amp[g]; arr[g * 2 + 1] = s.th[g]; }
fs.writeFileSync(path.join(outDir, 'selfgrav-table.bin'), Buffer.from(arr.buffer));

console.log('T=' + TEND + ' N=' + N + ' eps=' + eps + ' live=' + P.live.gfb + ' gain=' + GAIN +
	' -> table written from ' + nAcc + ' samples');

/* eps dependence: rebuild the kernel at each eps (force stays off) and report
 * row L1 norms (inner row 0, mid row 3, outer row 24) — softening sensitivity
 * of the production kernel; solve-vs-Poisson is gated separately by
 * check-poisson (which scans eps 0.08/0.15/0.30 against the analytic Q). */
var scan = (process.env.EPSSCAN || '0.08 0.15 0.30').split(/\s+/).map(parseFloat);
var rows = scan.map(function(e) {
	P.sg.eps = e;
	var tb = Date.now();
	SelfGrav.ensure(P);
	var K = SelfGrav.kernel(P), ms = Date.now() - tb;
	function l1(r) { var s = 0; for (var j = 0; j < NB; j++) s += Math.abs(K[r * NB + j]); return s; }
	return { eps: e, inner: l1(0), mid: l1(3), outer: l1(24), ms: ms };
});
var refRow = rows.filter(function(r) { return r.eps === 0.15; })[0] || rows[0];
rows.forEach(function(r) {
	console.log('eps=' + r.eps + ' rebuild ' + r.ms + 'ms  K row L1: inner ' + r.inner.toFixed(3) +
		'  mid ' + r.mid.toFixed(3) + '  outer ' + r.outer.toFixed(3) +
		(r === refRow && r.eps === 0.15 ? '  (reference)' : '  outer/eps0.15=' + (r.outer / refRow.outer).toFixed(3)));
	if (r.ms > 100) L.fail('kernel rebuild at eps=' + r.eps + ' took ' + r.ms + 'ms > 100ms');
});
L.pass('0.5.0-measure-selfgrav-kernel');
