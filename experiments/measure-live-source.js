/* Open-loop source measurement for the S5 study: how much m=2 potential does the
 * disk's OWN density moment carry, per annulus, in the units the live feedback
 * uses (2 pi G Sigma2 / k, k = 2p/R)? Compare with the external spiral wave in
 * the same annulus. This is the number that decides whether a self-gravity
 * feedback has anything to amplify at a given radius.
 *
 *   node experiments/measure-live-source.js [settle|150]      default: both
 *
 * Calm preset, gfb=0 (open loop: no feedback), shipping ICs. Mass-weighted
 * moment with the same per-class shares as the potential (liveMassTable), so the
 * numbers are directly comparable to P.live's estimate.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

var N = parseInt(process.env.NSTARS || '10000', 10);
var DT = 0.01, NB = 16, RLO = 0.8, RHI = 6.4;

var P = Galaxy.defaultParams();
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
P.live.gfb = 0;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);

var p = Galaxy.spiralP(P), dR = (RHI - RLO) / NB;
function Lof(R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

function report(label) {
	var mr = new Float64Array(NB), mi = new Float64Array(NB), w0 = new Float64Array(NB);
	var i, c, m, R, ph, b, a;
	for (i = 0; i < N; i++) {
		c = st.cls[i];
		m = st.live.mass[c];
		if (m === 0) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < RLO || R >= RHI) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		a = 2 * (ph - P.spiral.om * st.t - p * Lof(R));
		b = Math.min(NB - 1, Math.floor((R - RLO) / dR));
		mr[b] += m * Math.cos(a); mi[b] += m * Math.sin(a); w0[b] += m;
	}
	var res = Galaxy.resonances(P);
	console.log(label + ' (spiral ILR ' + res.spiral.ilr.map(function(v) { return v.toFixed(2); }).join('/') +
		', CR ' + res.spiral.cr.map(function(v) { return v.toFixed(2); }).join('/') +
		', OLR ' + res.spiral.olr.map(function(v) { return v.toFixed(2); }).join('/') + ')');
	console.log('     R    Sigma0     f2    dpsi(deg)   Phi_self   Phi_ext    ratio');
	for (b = 0; b < NB; b++) {
		R = RLO + (b + 0.5) * dR;
		var area = 2 * Math.PI * R * dR;
		var S0 = w0[b] / area;
		var amp = Math.sqrt(mr[b] * mr[b] + mi[b] * mi[b]);
		var f2 = amp / Math.max(w0[b], 1e-30);
		var dpsi = Math.atan2(mi[b], mr[b]) / 2 * 180 / Math.PI;
		var Phi = 2 * Math.PI * S0 * f2 * R / (2 * p);
		var lr = Math.log(R / P.spiral.rp) / P.spiral.sig;
		var ext = P.spiral.as * Math.exp(-0.5 * lr * lr);
		console.log('  ' + R.toFixed(2) + '  ' + S0.toExponential(2) + '  ' + f2.toFixed(3) + '  ' +
			(dpsi < -90 ? dpsi + 180 : dpsi > 90 ? dpsi - 180 : dpsi).toFixed(1) + '     ' +
			Phi.toExponential(2) + '   ' + ext.toExponential(2) + '   ' + (100 * Phi / ext).toFixed(1) + '%');
	}
}

report('at settle t=' + st.t.toFixed(0));
for (var k = 0; k < Math.round(150 / DT); k++) Galaxy.step(st, P, DT, false, true);
report('at T=150');
L.pass('measure-live-source: open-loop m=2 source amplitudes reported');
