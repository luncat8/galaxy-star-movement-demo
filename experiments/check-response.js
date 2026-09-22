'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
var N = 4000, dt = 0.01, T = 150;
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

function isDisk(c) {
	return c === 0 || c === 1 || c === 5;
}

function metrics() {
	var i, R, ph, br = 0, bi = 0, bc = 0, sr = 0, si = 0, sc = 0;
	var yr = 0, yi = 0, yc = 0;
	var nb = [0, 0, 0, 0, 0, 0, 0, 0], nc = 0;
	var yb = [0, 0, 0, 0, 0, 0, 0, 0], ny = 0;
	for (i = 0; i < N; i++) {
		if (!isDisk(st.cls[i])) continue;
		R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
		ph = Math.atan2(st.y[i], st.x[i]);
		if (R > 0.9 && R < 1.9) {
			var a = 2 * (ph - P.bar.om * st.t);
			br += Math.cos(a); bi += Math.sin(a); bc++;
		}
		if (R > 2.0 && R < 4.0) {
			var b = 2 * (ph - P.spiral.om * st.t - p * Lof(R));
			sr += Math.cos(b); si += Math.sin(b); sc++;
		}
		if (st.cls[i] === 5 && R > 1.6 && R < 2.2) {
			var yb2 = 2 * (ph - P.spiral.om * st.t - p * Lof(R));
			yr += Math.cos(yb2); yi += Math.sin(yb2); yc++;
		}
		if (R > 1.6 && R < 2.2) {
			var w = (ph - P.spiral.om * st.t - p * Lof(R)) % Math.PI;
			if (w < 0) w += Math.PI;
			nb[Math.min(7, Math.floor(w / Math.PI * 8))]++;
			nc++;
			if (st.cls[i] === 5) { yb[Math.min(7, Math.floor(w / Math.PI * 8))]++; ny++; }
		}
	}
	var mx = 0, mn = 1e9, yx = 0, yn = 1e9;
	for (i = 0; i < 8; i++) {
		if (nb[i] > mx) mx = nb[i];
		if (nb[i] < mn) mn = nb[i];
		if (yb[i] > yx) yx = yb[i];
		if (yb[i] < yn) yn = yb[i];
	}
	return {
		bar: Math.sqrt(br * br + bi * bi) / bc,
		spiral: Math.sqrt(sr * sr + si * si) / sc,
		contrast: (mx - mn) / (nc / 8),
		young: Math.sqrt(yr * yr + yi * yi) / yc,
		youngC: (yx - yn) / (ny / 8)
	};
}

var m0 = metrics(), k;
for (k = 0; k < Math.round(T / dt); k++) Galaxy.step(st, P, dt, true, true);
var m1 = metrics();
console.log('settle: bar=' + m0.bar.toFixed(3) + ' spiral=' + m0.spiral.toFixed(3) + ' contrast=' + m0.contrast.toFixed(2) +
	' young=' + m0.young.toFixed(3) + ' youngC=' + m0.youngC.toFixed(2));
console.log('T=150:  bar=' + m1.bar.toFixed(3) + ' spiral=' + m1.spiral.toFixed(3) + ' contrast=' + m1.contrast.toFixed(2) +
	' young=' + m1.young.toFixed(3) + ' youngC=' + m1.youngC.toFixed(2));
if (m1.bar < 0.08) L.fail('bar faded to ' + m1.bar.toFixed(3));
if (m1.spiral < 0.10) L.fail('spiral faded to ' + m1.spiral.toFixed(3));
if (m1.contrast < 0.5) L.fail('arm contrast faded to ' + m1.contrast.toFixed(2));
if (m1.spiral < m0.spiral * 0.4) L.fail('spiral faded more than 60%');
if (m1.young < 0.30) L.fail('young arms faded to ' + m1.young.toFixed(3));
if (m1.youngC < 1.2) L.fail('young contrast faded to ' + m1.youngC.toFixed(2));
if (m1.young < m0.young * 0.6) L.fail('young arms faded more than 40%');
L.pass('check-response structures persist past the settling transient');
