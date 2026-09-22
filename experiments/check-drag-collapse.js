'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

function medianR(st, buf) {
	return L.median(L.radii(st, buf), st.n);
}

function run(eta) {
	var P = Galaxy.defaultParams();
	var N = 1000, dt = 0.01, T = 50;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);
	var buf = new Float64Array(N), rng = Galaxy.RNG(999);
	var m0 = medianR(st, buf), k, j;
	var steps = Math.round(T / dt);
	for (k = 0; k < steps; k++) {
		Galaxy.step(st, P, dt, true, true);
		if (k % 10 === 9) Galaxy.applyDrag(st, 0.1, eta, 0, rng);
	}
	return medianR(st, buf) / m0;
}

var drag = run(0.05), ctrl = run(0);
console.log('medianR ratio: drag=' + drag.toFixed(3) + ' control=' + ctrl.toFixed(3));
if (drag > 0.7) L.fail('drag run medianR ratio ' + drag.toFixed(3) + ' > 0.7 (no collapse)');
if (Math.abs(ctrl - 1) > 0.1) L.fail('control drifted ' + ctrl.toFixed(3));
L.pass('check-drag-collapse pure friction piles stars inward, control steady');
