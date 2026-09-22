'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

/* Gates bounded secular evolution (not zero evolution: the patterns physically
 * heat/redistribute the disk). The axisymmetric control separates numerical
 * heating (must be ~nil) from pattern-driven heating (allowed, bounded). */
function run(barOn, spirOn) {
	var P = Galaxy.defaultParams();
	var N = 4000, dt = 0.01, T = 100;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, barOn, spirOn);
	var buf = new Float64Array(N);
	var hR0 = L.hist(L.radii(st, buf), N, 0, 6, 20);
	var hZ0 = L.hist(L.absZ(st, buf), N, 0, 2, 10);
	var m0 = L.median(L.radii(st, buf), N);
	var steps = Math.round(T / dt), k;
	for (k = 0; k < steps; k++) Galaxy.step(st, P, dt, barOn, spirOn);
	var hR1 = L.hist(L.radii(st, buf), N, 0, 6, 20);
	var hZ1 = L.hist(L.absZ(st, buf), N, 0, 2, 10);
	var m1 = L.median(L.radii(st, buf), N);
	function peakMean(h) {
		var pk = 0, i;
		for (i = 0; i < h.length; i++) if (h[i] > pk) pk = h[i];
		return pk / (1 / h.length);
	}
	return {
		l2R: L.relL2(hR0, hR1), l2Z: L.relL2(hZ0, hZ1),
		pm0: peakMean(hR0), pm1: peakMean(hR1), med: m1 / m0, caps: st.caps
	};
}

var pat = run(true, true), ax = run(false, false);
console.log('patterns: L2R=' + (100 * pat.l2R).toFixed(1) + '% L2Z=' + (100 * pat.l2Z).toFixed(1) +
	'% peak/mean ' + pat.pm0.toFixed(2) + '->' + pat.pm1.toFixed(2) +
	' medR x' + pat.med.toFixed(3) + ' caps=' + pat.caps);
console.log('axisym:   L2R=' + (100 * ax.l2R).toFixed(1) + '% L2Z=' + (100 * ax.l2Z).toFixed(1) +
	'% peak/mean ' + ax.pm0.toFixed(2) + '->' + ax.pm1.toFixed(2) +
	' medR x' + ax.med.toFixed(3) + ' caps=' + ax.caps);
if (ax.l2Z > 0.05) L.fail('axisym control heated vertically ' + (100 * ax.l2Z).toFixed(1) + '% (numerical!)');
if (pat.pm1 > pat.pm0 * 1.25) L.fail('peak/mean grew (clumping)');
if (Math.abs(pat.med - 1) > 0.10) L.fail('median R moved x' + pat.med.toFixed(3));
if (pat.l2R > 0.25 || pat.l2Z > 0.25) L.fail('secular evolution unbounded');
L.pass('check-no-clumping bounded evolution, integrator clean, nothing piles up');
