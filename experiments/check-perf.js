'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
var N = 10000;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(2 / 0.02), 0.02, true, true);
var k, t0 = Date.now();
for (k = 0; k < 10; k++) Galaxy.step(st, P, 0.01, true, true);
var ms = (Date.now() - t0) / 10;
console.log('N=10k one frame (10 substeps): sim=' + (ms * 10).toFixed(1) + 'ms total, ' +
	ms.toFixed(2) + 'ms/substep -> ' + (1000 / (ms * 10)).toFixed(0) + 'fps sim-only budget');
if (ms * 10 > 8) console.log('WARN: sim exceeds 8ms/frame budget at 10k (use timeScale/N levers)');
L.pass('check-perf measured (informational)');
