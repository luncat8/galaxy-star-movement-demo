'use strict';
/* Perf budgets (0.5.0): global-on substep <= 1.2x the WKB live-on substep
 * at N=10k (the variant's own delta over the shipping loop); kernel
 * precompute <= 100 ms; live-off reported informationally. */
var L = require('./lib.js'), Galaxy = L.Galaxy;
var SelfGrav = require('../selfgrav.js');
var P = Galaxy.defaultParams();
P.align = 0;
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0; P.bar.g = 0; P.spiral.g = 1;
/* calm config: bar off keeps liveGain > 0, so the "live-on" timings below
 * actually run the live branch (bar on would zero it and time the wrong path) */
var N = 10000;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(2 / 0.02), 0.02, false, true);
var k, t0;
for (k = 0; k < 5; k++) Galaxy.step(st, P, 0.01, false, true);   /* JIT warmup */

function timeSubsteps(tag, fn) {
	t0 = Date.now();
	for (k = 0; k < 10; k++) fn();
	var ms = (Date.now() - t0) / 10;
	console.log(tag + ': ' + ms.toFixed(3) + 'ms/substep -> ' + (1000 / ms).toFixed(0) + 'fps sim-only');
	return ms;
}

var off = timeSubsteps('live-off   ', function() { Galaxy.step(st, P, 0.01, false, true); });

/* WKB live-on: gfb set, freeze off (galaxy.js refreshes every substep) */
P.live.gfb = 1;
var wkb = timeSubsteps('WKB live-on', function() { Galaxy.step(st, P, 0.01, false, true); });

/* global-on: freeze + SelfGrav tick per substep (refresh every 4) */
SelfGrav.ensure(P);
P.sg.solver = 1;
P.live.freeze = true;
P.live.cap = P.sg.cap;
SelfGrav.reset();
var glob = timeSubsteps('global-on  ', function() {
	Galaxy.step(st, P, 0.01, false, true);
	SelfGrav.step(st, P, st.t, 0.01, 1, Galaxy.liveGain(P, true, false));
});

t0 = Date.now();
P.sg.eps = 0.17;                       /* new signature -> cold rebuild */
SelfGrav.ensure(P);
var buildMs = Date.now() - t0;
console.log('kernel rebuild: ' + buildMs + ' ms');

console.log('global/WKB = ' + (glob / wkb).toFixed(2) + 'x (gate <=1.2x); global/off = ' +
	(glob / off).toFixed(2) + 'x (informational)');
if (glob > 1.2 * wkb) L.fail('global-on substep ' + glob.toFixed(3) + ' > 1.2x WKB ' + wkb.toFixed(3));
if (buildMs > 100) L.fail('kernel build ' + buildMs + 'ms > 100ms');
if (glob * 10 > 8) console.log('WARN: sim exceeds 8ms/frame budget at 10k (use timeScale/N levers)');
L.pass('check-perf global-on <= 1.2x WKB-on, kernel <= 100ms');
