/* Narrow-annulus m=2 response profile: amplitude + phase vs R, settle vs T=150.
 * Shows where the wave is coherent and where the disk is disorganized. */
'use strict';
var Galaxy = require('../galaxy.js');
var P = Galaxy.defaultParams();
var N = 10000, dt = 0.01;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);
var p = Galaxy.spiralP(P), r1 = P.spiral.r1;

function Lof(R) {
	if (R <= r1 - 0.3) return 0;
	if (R >= r1 + 0.3) return Math.log(R / r1);
	var x = (R - (r1 - 0.3)) / 0.6, lr = Math.log(R / r1);
	return x * x * (3 - 2 * x) * lr;
}
function profile(label) {
	var ar = new Float64Array(16), ai = new Float64Array(16), ac = new Float64Array(16);
	var i, R, ph, b, c = 0;
	for (i = 0; i < N; i++) {
		if (st.cls[i] === 2 || st.cls[i] === 3 || st.cls[i] === 4) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < 0.4 || R > 6) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		b = Math.min(15, Math.floor((R - 0.4) / 5.6 * 16));
		var a = 2 * (ph - P.spiral.om * st.t - p * Lof(R));
		ar[b] += Math.cos(a); ai[b] += Math.sin(a); ac[b]++;
		c++;
	}
	var s = label + '\n';
	for (var k = 0; k < 16; k++) {
		if (ac[k] < 30) continue;
		var amp = Math.sqrt(ar[k] * ar[k] + ai[k] * ai[k]) / ac[k];
		var psi = Math.atan2(ai[k], ar[k]) / 2 * 180 / Math.PI;
		var Rb = (0.4 + (k + 0.5) / 16 * 5.6).toFixed(2);
		s += 'R=' + Rb + '\tamp=' + amp.toFixed(3) + '\tdpsi=' + (psi < -90 ? psi + 180 : psi > 90 ? psi - 180 : psi).toFixed(1) + '\u00b0\n';
	}
	console.log(s);
}
profile('at settle (t=' + st.t.toFixed(0) + ')');
for (var k = 0; k < Math.round(150 / dt); k++) Galaxy.step(st, P, dt, true, true);
profile('at T=150 (t=' + st.t.toFixed(0) + ')');
