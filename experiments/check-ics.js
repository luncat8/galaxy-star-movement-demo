'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
P.align = 0;
var N = 2000;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
var cnt = [0, 0, 0, 0, 0, 0], ret = [0, 0, 0, 0, 0, 0], i;
var sx = 0, sy = 0, sz = 0, sn = 0, rmax = 0, vmax = 0;
for (i = 0; i < N; i++) {
	var c = st.cls[i];
	cnt[c]++;
	var Lz = st.x[i] * st.vy[i] - st.y[i] * st.vx[i];
	if (Lz < 0) ret[c]++;
	var R = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
	var r = Math.sqrt(R * R + st.z[i] * st.z[i]);
	var v = Math.sqrt(st.vx[i] * st.vx[i] + st.vy[i] * st.vy[i] + st.vz[i] * st.vz[i]);
	if (r > rmax) rmax = r;
	if (v > vmax) vmax = v;
	if (c === 4) { sx += st.x[i]; sy += st.y[i]; sz += st.z[i]; sn++; }
}
var want = [0.30, 0.25, 0.10, 0.08, 0.02, 0.25];
for (i = 0; i < 6; i++) {
	var f = cnt[i] / N;
	console.log('cls' + i + ': share=' + (100 * f).toFixed(1) + '% retro=' + (100 * ret[i] / cnt[i]).toFixed(2) + '%');
	if (Math.abs(f - want[i]) > 0.01) L.fail('cls' + i + ' share ' + f.toFixed(3));
	var cap = i < 2 || i > 3 ? 0.005 : 0.01;
	if (ret[i] / cnt[i] > cap) L.fail('cls' + i + ' retrograde ' + (100 * ret[i] / cnt[i]).toFixed(1) + '%');
}
sx /= sn; sy /= sn; sz /= sn;
var spread = 0;
for (i = 0; i < N; i++) {
	if (st.cls[i] !== 4) continue;
	var dx = st.x[i] - sx, dy = st.y[i] - sy, dz = st.z[i] - sz;
	spread += dx * dx + dy * dy + dz * dz;
}
spread = Math.sqrt(spread / sn);
console.log('rmax=' + rmax.toFixed(2) + ' vmax=' + vmax.toFixed(2) + ' streamSpread=' + spread.toFixed(3));
if (rmax > 8 || vmax > 3) L.fail('ICs out of bounds');
if (spread > 0.2) L.fail('stream not tight');
L.pass('check-ics shares, prograde, bounds, tight stream');
