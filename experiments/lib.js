'use strict';
var Galaxy = require('../galaxy.js');

function fail(msg) {
	console.error('FAIL: ' + msg);
	process.exit(1);
}

function pass(msg) {
	console.log('PASS: ' + msg);
}

function hist(vals, n, lo, hi, nbins) {
	var h = new Float64Array(nbins), w = (hi - lo) / nbins, i, b;
	for (i = 0; i < n; i++) {
		b = Math.floor((vals[i] - lo) / w);
		if (b < 0) b = 0;
		if (b >= nbins) b = nbins - 1;
		h[b]++;
	}
	for (i = 0; i < nbins; i++) h[i] /= n;
	return h;
}

function relL2(a, b) {
	var s = 0, t = 0, i;
	for (i = 0; i < a.length; i++) {
		var d = a[i] - b[i];
		s += d * d; t += a[i] * a[i];
	}
	if (t === 0) return s === 0 ? 0 : 1e9;
	return Math.sqrt(s / t);
}

function median(vals, n) {
	var c = Array.prototype.slice.call(vals, 0, n);
	c.sort(function(a, b) { return a - b; });
	return c[Math.floor(n / 2)];
}

function linSlope(ys, xs) {
	var n = ys.length, sx = 0, sy = 0, sxx = 0, sxy = 0, i;
	for (i = 0; i < n; i++) {
		sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
	}
	var den = n * sxx - sx * sx;
	if (den === 0) return 0;
	return (n * sxy - sx * sy) / den;
}

function radii(st, out) {
	var i;
	for (i = 0; i < st.n; i++) out[i] = Math.sqrt(st.x[i] * st.x[i] + st.y[i] * st.y[i]);
	return out;
}

function absZ(st, out) {
	var i;
	for (i = 0; i < st.n; i++) out[i] = Math.abs(st.z[i]);
	return out;
}

module.exports = { Galaxy: Galaxy, fail: fail, pass: pass, hist: hist, relL2: relL2, median: median, linSlope: linSlope, radii: radii, absZ: absZ };
