'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

function runSingle(name, barOn, spirOn, om) {
	var P = Galaxy.defaultParams();
	var N = 1000, dt = 0.01, T = 60;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, barOn, spirOn);
	var o = { bar: barOn, spiral: spirOn, ramp: 1 };
	var e0 = new Float64Array(N), i, k;
	for (i = 0; i < N; i++)
		e0[i] = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, om, o);
	var steps = Math.round(T / dt);
	for (k = 0; k < steps; k++) Galaxy.step(st, P, dt, barOn, spirOn);
	var worst = 0;
	for (i = 0; i < N; i++) {
		var e1 = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, om, o);
		var d = Math.abs(e1 - e0[i]) / Math.max(Math.abs(e0[i]), 0.3);
		if (d > worst) worst = d;
	}
	console.log(name + ': max|dEJ|/|EJ|=' + worst.toExponential(2) + ' caps=' + st.caps);
	if (worst > 2e-3) L.fail(name + ' Jacobi drift ' + worst.toExponential(2) + ' > 2e-3');
}

function cloneState(st) {
	var c = Galaxy.createState(st.nmax), fields = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'ax', 'ay', 'az'], f;
	c.n = st.n; c.t = st.t;
	for (f = 0; f < fields.length; f++) c[fields[f]].set(st[fields[f]]);
	c.cls.set(st.cls);
	return c;
}

/* Combined field: no exact invariant exists (two pattern speeds do physical work),
 * so gate on shadow convergence dt vs dt/2 — pure truncation error, no physics. */
function runCombined() {
	var P = Galaxy.defaultParams();
	var N = 1000, T = 30;
	var st0 = Galaxy.createState(N);
	st0.n = N;
	Galaxy.initStars(st0, P, P.seed);
	Galaxy.settle(st0, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);
	var A = cloneState(st0), B = cloneState(st0), k, i;
	for (k = 0; k < Math.round(T / 0.01); k++) Galaxy.step(A, P, 0.01, true, true);
	for (k = 0; k < Math.round(T / 0.005); k++) Galaxy.step(B, P, 0.005, true, true);
	var d = [];
	for (i = 0; i < N; i++) {
		var dx = A.x[i] - B.x[i], dy = A.y[i] - B.y[i], dz = A.z[i] - B.z[i];
		d.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
	}
	d.sort(function(a, b) { return a - b; });
	console.log('combined shadow T=30: median=' + d[500].toExponential(2) +
		' p99=' + d[990].toExponential(2) + ' max=' + d[999].toExponential(2));
	if (d[500] > 5e-4) L.fail('combined shadow median ' + d[500].toExponential(2) + ' > 5e-4');
	if (d[990] > 1e-2) L.fail('combined shadow p99 ' + d[990].toExponential(2) + ' > 1e-2');
	if (d[999] > 0.1) L.fail('combined shadow max ' + d[999].toExponential(2) + ' > 0.1');
}

var P0 = Galaxy.defaultParams();
runSingle('bar-only', true, false, P0.bar.om);
runSingle('spiral-only', false, true, P0.spiral.om);
runCombined();
L.pass('check-jacobi single-pattern conserved, combined shadow-converged');
