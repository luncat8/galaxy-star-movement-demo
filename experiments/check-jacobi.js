'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;

function runSingle(name, barOn, spirOn, om) {
	var P = Galaxy.defaultParams();
	P.align = 0;
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
	var dd = [];
	for (i = 0; i < N; i++) {
		var e1 = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, om, o);
		dd.push(Math.abs(e1 - e0[i]) / Math.max(Math.abs(e0[i]), 0.3));
	}
	dd.sort(function(a, b) { return a - b; });
	console.log(name + ': p99|dEJ|/|EJ|=' + dd[990].toExponential(2) +
		' max=' + dd[N - 1].toExponential(2) + ' caps=' + st.caps);
	if (dd[990] > 2e-3) L.fail(name + ' Jacobi p99 ' + dd[990].toExponential(2) + ' > 2e-3');
	if (dd[N - 1] > 1e-2) L.fail(name + ' Jacobi max ' + dd[N - 1].toExponential(2) + ' > 1e-2');
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
	P.align = 0;
	var N = 1000, T = 30;
	var st0 = Galaxy.createState(N);
	st0.n = N;
	Galaxy.initStars(st0, P, P.seed);
	Galaxy.settle(st0, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);
	var A = cloneState(st0), B = cloneState(st0), k, i;
	var o = { bar: true, spiral: true, ramp: 1 };
	var e0 = new Float64Array(N);
	for (i = 0; i < N; i++)
		e0[i] = Galaxy.jacobi1(A.x[i], A.y[i], A.z[i], A.vx[i], A.vy[i], A.vz[i], A.t, P, P.bar.om, o);
	for (k = 0; k < Math.round(T / 0.01); k++) Galaxy.step(A, P, 0.01, true, true);
	for (k = 0; k < Math.round(T / 0.005); k++) Galaxy.step(B, P, 0.005, true, true);
	if (P.bar.om === P.spiral.om) {
		var dd = [];
		for (i = 0; i < N; i++) {
			var e1 = Galaxy.jacobi1(A.x[i], A.y[i], A.z[i], A.vx[i], A.vy[i], A.vz[i], A.t, P, P.bar.om, o);
			dd.push(Math.abs(e1 - e0[i]) / Math.max(Math.abs(e0[i]), 0.3));
		}
		dd.sort(function(a, b) { return a - b; });
		console.log('combined EJ: p99|dEJ|/|EJ|=' + dd[990].toExponential(2) + ' max=' + dd[N - 1].toExponential(2));
		if (dd[990] > 2e-3) L.fail('combined EJ p99 ' + dd[990].toExponential(2) + ' > 2e-3');
		if (dd[N - 1] > 1e-2) L.fail('combined EJ max ' + dd[N - 1].toExponential(2) + ' > 1e-2');
	}
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

/* S5 live mode, frozen: once the measured m=2 profile is fixed (P.live.freeze)
 * the live potential is a single-pattern field like the spiral, so the Jacobi
 * integral with om = spiral.om must be conserved. This tests the live FORCE
 * (including the interpolated dtheta/dR term), not the feedback loop: while the
 * table updates the patterns do work and no invariant exists. */
function runLiveFrozen() {
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = 1;
	var N = 1000, dt = 0.01, T = 60;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
	P.live.freeze = true;
	var o = { bar: false, spiral: true, ramp: 1, live: st.live };
	var e0 = new Float64Array(N), i, k, dd = [];
	for (i = 0; i < N; i++)
		e0[i] = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, P.spiral.om, o);
	for (k = 0; k < Math.round(T / dt); k++) Galaxy.step(st, P, dt, false, true);
	for (i = 0; i < N; i++) {
		var e1 = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, P.spiral.om, o);
		dd.push(Math.abs(e1 - e0[i]) / Math.max(Math.abs(e0[i]), 0.3));
	}
	dd.sort(function(a, b) { return a - b; });
	console.log('live-frozen: p99|dEJ|/|EJ|=' + dd[990].toExponential(2) +
		' max=' + dd[N - 1].toExponential(2) + ' caps=' + st.caps);
	if (dd[990] > 2e-3) L.fail('live-frozen Jacobi p99 ' + dd[990].toExponential(2) + ' > 2e-3');
	if (dd[N - 1] > 1e-2) L.fail('live-frozen Jacobi max ' + dd[N - 1].toExponential(2) + ' > 1e-2');
}

var P0 = Galaxy.defaultParams();
P0.align = 0;
runSingle('bar-only', true, false, P0.bar.om);
runSingle('spiral-only', false, true, P0.spiral.om);
runCombined();
runLiveFrozen();

/* 0.5.0: frozen VARIANT table (SelfGrav, populated through the real refresh)
 * is a static single-pattern field — same invariants as runLiveFrozen.
 * The table is built by ticking the variant during settle, then frozen (no
 * more ticks) for the whole 60-tu run: while it updates no invariant exists. */
function runSelfGravFrozen() {
	var SelfGrav = require('../selfgrav.js');
	var P = Galaxy.defaultParams();
	P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
	P.live.gfb = 1; P.live.freeze = true; P.live.cap = 0.10;
	SelfGrav.ensure(P);
	P.sg.solver = 1;
	var N = 1000, dt = 0.01, T = 60;
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	var c, m;
	for (c = 0; c < Math.round(P.tsettle / P.dtSettle); ) {
		m = Math.min(P.sg.refresh, Math.round(P.tsettle / P.dtSettle) - c);
		Galaxy.settle(st, P, m, P.dtSettle, false, true);
		SelfGrav.step(st, P, st.t, P.dtSettle, m, Galaxy.liveGain(P, true, false));
		c += m;
	}
	/* freeze: no further SelfGrav.step calls — amp/th stay static */
	var o = { bar: false, spiral: true, ramp: 1, live: st.live };
	var e0 = new Float64Array(N), i, k, dd = [], nz = 0;
	for (i = 0; i < st.live.nb; i++) if (st.live.amp[i] > 0) nz++;
	if (!nz) L.fail('selfgrav-frozen: table empty after settle ticks');
	for (i = 0; i < N; i++)
		e0[i] = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, P.spiral.om, o);
	for (k = 0; k < Math.round(T / dt); k++) Galaxy.step(st, P, dt, false, true);
	for (i = 0; i < N; i++) {
		var e1 = Galaxy.jacobi1(st.x[i], st.y[i], st.z[i], st.vx[i], st.vy[i], st.vz[i], st.t, P, P.spiral.om, o);
		dd.push(Math.abs(e1 - e0[i]) / Math.max(Math.abs(e0[i]), 0.3));
	}
	dd.sort(function(a, b) { return a - b; });
	console.log('selfgrav-frozen: p99|dEJ|/|EJ|=' + dd[990].toExponential(2) +
		' max=' + dd[N - 1].toExponential(2) + ' caps=' + st.caps + ' nonzero bins=' + nz + '/32');
	if (dd[990] > 2e-3) L.fail('selfgrav-frozen Jacobi p99 ' + dd[990].toExponential(2) + ' > 2e-3');
	if (dd[N - 1] > 1e-2) L.fail('selfgrav-frozen Jacobi max ' + dd[N - 1].toExponential(2) + ' > 1e-2');
}
runSelfGravFrozen();
L.pass('check-jacobi single-pattern conserved, live-frozen conserved, selfgrav-frozen conserved, combined shadow-converged');
