/* 0.5.0 audit 1: the PRODUCTION kernel (selfgrav.js) vs dense quadrature.
 *
 *   node experiments/check-poisson.js
 *   env: EPSSCAN=0.08,0.15,0.30 (default), PROBE range via constants below
 *
 * Gates (0.5.0 plan section 5):
 *   - m=0 on Sigma = S0 exp(-R/Rd): kernel matrix product vs an 800x2048
 *     dense quadrature over the SAME R range (the grid starts at LIVE_RLO =
 *     0.3 and the mass inside it is real — a m=0 solve that starts at 0
 *     instead reads a fake error, so both are printed and only the same-range
 *     pair is gated), max relative error <= 5e-3.
 *   - m=2 on a synthetic Sig2(R) cos 2phi: same dense check at phi=0 (the
 *     real part of the solved harmonic), same 5e-3 gate.
 *   - eps scan 0.08/0.15/0.30 reported (outer-disk answers must not be a
 *     softening artifact; inner amplitude moves, that is the knob).
 *   - the R<0.3 inner-hole bias printed so the m=0 exclusion stays documented.
 */
'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var SelfGrav = require('../selfgrav.js');

var NB = Galaxy.LIVE_NB, RLO = Galaxy.LIVE_RLO, RHI = Galaxy.LIVE_RHI;
var DR = (RHI - RLO) / NB;
var rc = new Float64Array(NB), i;
for (i = 0; i < NB; i++) rc[i] = RLO + (i + 0.5) * DR;

var S0 = 0.08, Rd = 0.8;                 /* m=0 test profile */
var S2 = 0.02, R2c = 2.5, S2w = 1.2;     /* m=2 test profile: gaussian ring */
var NRQ = 800, NPQ = 2048;
var dRq = (RHI - RLO) / NRQ, dPq = 2 * Math.PI / NPQ;
var dRq0 = RHI / NRQ;                    /* dense from R=0, for the hole bias */
var EPSLIST = (process.env.EPSSCAN || '0.08,0.15,0.30').split(',').map(parseFloat);

function sig2of(R) { var x = (R - R2c) / S2w; return S2 * Math.exp(-x * x); }

/* Dense: Phi(R, phi=0) = -G int_{Rlo}^{Rhi} int Sig(R',phi') / dist R' dphi' dR',
 * m=0 on exp profile, m=2 with Sig' = Sig2(R') cos 2phi'. */
function dense(P, m, rProbe, rlo0) {
	var acc0 = 0, k, jq, Rq = rlo0 === 0 ? dRq0 : dRq, rlo = rlo0 === 0 ? 0 : RLO;
	for (jq = 0; jq < NRQ; jq++) {
		var Rqj = rlo + (jq + 0.5) * Rq;
		var src = m === 0 ? S0 * Math.exp(-Rqj / Rd) : sig2of(Rqj);
		if (src === 0) continue;
		var a = 0;
		for (k = 0; k < NPQ; k++) {
			var ph = dPq * (k + 0.5);
			var w = m === 0 ? 1 : Math.cos(2 * ph);
			if (w === 0) continue;
			var dx = rProbe - Rqj * Math.cos(ph), dy = -Rqj * Math.sin(ph);
			a += w / Math.sqrt(dx * dx + dy * dy + P.sg.eps * P.sg.eps);
		}
		acc0 -= P.G * src * a * dPq * Rqj * Rq;
	}
	return acc0;
}

function gateRange(m, K, tag) {
	var worst = 0, worstR = 0, ii;
	for (ii = 0; ii < NB; ii++) {
		if (rc[ii] < 1.0 || rc[ii] > 6.2) continue;
		var phQ = dense(P0, m, rc[ii], 1);
		var a, re = 0;
		for (var j = 0; j < NB; j++) {
			a = m === 0 ? S0 * Math.exp(-rc[j] / Rd) : sig2of(rc[j]);
			re += K[ii * NB + j] * a;
		}
		var e = Math.abs(re - phQ) / Math.abs(phQ);
		if (e > worst) { worst = e; worstR = rc[ii]; }
	}
	console.log('  m=' + m + ' ' + tag + ': max rel err ' + worst.toExponential(2) +
		' at R=' + worstR.toFixed(2) + (worst <= 5e-3 ? '  PASS' : '  FAIL (>5e-3)'));
	if (worst > 5e-3) L.fail('check-poisson m=' + m + ' ' + tag);
	return worst;
}

var P0 = Galaxy.defaultParams();
SelfGrav.ensure(P0);

console.log('check-poisson: production kernel vs ' + NRQ + 'x' + NPQ + ' dense quadrature, same R range (R 1-6.2)');
EPSLIST.forEach(function(eps) {
	P0.sg.eps = eps;
	var Km0 = SelfGrav.harmonic(P0, 0), K2 = SelfGrav.harmonic(P0, 2);
	gateRange(0, Km0, 'eps=' + eps);
	gateRange(2, K2, 'eps=' + eps);
});

/* hole bias: dense m=0 from R=0 vs the grid product (grid starts at 0.3) */
P0.sg.eps = 0.15;
var K = SelfGrav.harmonic(P0, 0);
var holeWorst = 0, holeR = 0;
for (i = 0; i < NB; i++) {
	if (rc[i] < 1.0 || rc[i] > 6.2) continue;
	var full = dense(P0, 0, rc[i], 0);
	var same = dense(P0, 0, rc[i], 1);
	var e = Math.abs(same - full) / Math.abs(full);
	if (e > holeWorst) { holeWorst = e; holeR = rc[i]; }
}
console.log('inner hole (R<0.3 missing mass) biases the m=0 term by up to ' +
	(holeWorst * 100).toFixed(1) + '% at R=' + holeR.toFixed(2) +
	'  (why m=0 stays out of the solve, plan 3.3)');

/* kernel build budget: time a cold rebuild */
K = null;
var tb = Date.now();
P0.sg.eps = 0.16;                          /* force a rebuild signature */
SelfGrav.ensure(P0);
var buildMs = Date.now() - tb;
console.log('kernel precompute (32x32, nsub 8, nq 256): ' + buildMs + ' ms' +
	(buildMs <= 100 ? '  PASS (<=100)' : '  FAIL (>100)'));
if (buildMs > 100) L.fail('kernel build ' + buildMs + 'ms > 100ms');
L.pass('check-poisson kernel discretization <= 5e-3 at every eps, hole bias documented');
