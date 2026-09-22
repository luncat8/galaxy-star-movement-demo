/* Calm-preset scan: spiral-only (bar off) Omega/as grid.
 * Reports coherent-arm boundary, outer-zone amplitude, phase twist, vertical heat. */
'use strict';
var Galaxy = require('../galaxy.js');
var P = Galaxy.defaultParams();
var N = 10000, dt = 0.01;

var oms = [0.36, 0.32, 0.30, 0.28, 0.26];
var ass = [0.04, 0.05, 0.06];

function run(om, as) {
	P.spiral.om = om; P.spiral.as = as;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
	var m0 = profile(st, P);
	var k;
	for (k = 0; k < Math.round(150 / dt); k++) Galaxy.step(st, P, dt, false, true);
	var m1 = profile(st, P);
	var zmed = 0, zs = [], i;
	for (i = 0; i < N; i++) if (st.cls[i] === 0) zs.push(Math.abs(st.z[i]));
	zs.sort(function(a, b) { return a - b; });
	zmed = zs[Math.floor(zs.length / 2)];
	var res = Galaxy.resonances(P);
	console.log('om=' + om.toFixed(2) + ' as=' + as.toFixed(2) +
		' CR=' + res.spiral.cr.map(function(r) { return r.toFixed(2); }).join('/') +
		' ILR=' + res.spiral.ilr.map(function(r) { return r.toFixed(2); }).join('/') +
		' OLR=' + res.spiral.olr.map(function(r) { return r.toFixed(2); }).join('/'));
	console.log('  settle: ' + m0);
	console.log('  T=150 : ' + m1 + '  zmed(thin)=' + zmed.toFixed(3));
}

/* Narrow-annulus m=2 in spiral frame; summarize amps per band. */
function profile(st, P) {
	var p = Galaxy.spiralP(P), r1 = P.spiral.r1;
	var bands = [[1.0, 1.6], [1.6, 2.2], [2.2, 2.8], [2.8, 3.4], [3.4, 4.0], [4.0, 5.0]];
	var br = new Float64Array(6), bi = new Float64Array(6), bc = new Float64Array(6);
	var i, R, ph, b;
	for (i = 0; i < N; i++) {
		if (st.cls[i] === 2 || st.cls[i] === 3 || st.cls[i] === 4) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		if (R < 0.4 || R > 5.5) continue;
		ph = Math.atan2(st.y[i], st.x[i]);
		for (b = 0; b < 6; b++) {
			if (R < bands[b][0] || R >= bands[b][1]) continue;
			var a = 2 * (ph - P.spiral.om * st.t - p * Lof(R));
			br[b] += Math.cos(a); bi[b] += Math.sin(a); bc[b]++;
		}
	}
	var s = '';
	for (b = 0; b < 6; b++)
		s += bands[b][0] + '-' + bands[b][1] + ':' + (Math.sqrt(br[b] * br[b] + bi[b] * bi[b]) / Math.max(1, bc[b])).toFixed(2) + ' ';
	return s;
}
function Lof(R) {
	if (R <= P.spiral.r1 - 0.3) return 0;
	if (R >= P.spiral.r1 + 0.3) return Math.log(R / P.spiral.r1);
	var x = (R - (P.spiral.r1 - 0.3)) / 0.6, lr = Math.log(R / P.spiral.r1);
	return x * x * (3 - 2 * x) * lr;
}

var i, j;
for (i = 0; i < oms.length; i++)
	for (j = 0; j < ass.length; j++)
		run(oms[i], ass[j]);
