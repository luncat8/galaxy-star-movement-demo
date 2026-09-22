'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
var N = 4000, dt = 0.01, T = 100;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, false);
var steps = Math.round(T / dt), k;
for (k = 0; k < steps; k++) Galaxy.step(st, P, dt, true, false);
/* m=2 response in the bar frame: captured x1 stars align with the bar angle. */
var barAng = P.bar.om * st.t, re = 0, im = 0, cnt = 0, i;
for (i = 0; i < N; i++) {
	if (st.cls[i] !== 0 && st.cls[i] !== 1 && st.cls[i] !== 5) continue;
	var R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
	if (R < 0.9 || R > 1.9) continue;
	var ph = Math.atan2(st.y[i], st.x[i]) - barAng;
	re += Math.cos(2 * ph); im += Math.sin(2 * ph); cnt++;
}
var amp = Math.sqrt(re * re + im * im) / cnt;
var align = Math.abs(Math.atan2(im, re)) / Math.PI;
if (align > 0.5) align = 1 - align;
var res = Galaxy.resonances(P).bar;
console.log('bar-frame m=2: amp=' + amp.toFixed(3) + ' misalign=' + (align * 180).toFixed(1) +
	'deg N=' + cnt + ' ILR=' + res.ilr.map(function(v) { return v.toFixed(2); }) +
	' CR=' + res.cr.map(function(v) { return v.toFixed(2); }));
if (amp < 0.12) L.fail('bar-region m=2 amp ' + amp.toFixed(3) + ' < 0.12 (no capture)');
if (align * 180 > 20) L.fail('response misaligned ' + (align * 180).toFixed(1) + 'deg (not x1)');
L.pass('check-resonances bar captured stars onto aligned orbits');
