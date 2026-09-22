/* Rotation-curve + epicyclic precession profile: how fast would apsidally-aligned
 * (kinematic) arms shear, and where do the resonances sit. Diagnostic only. */
'use strict';
var Galaxy = require('../galaxy.js');
var P = Galaxy.defaultParams();

function fmt(x) { return x.toFixed(3); }
console.log('R\tvc\tOmega\tkappa\tk/2\tOm-k/2\td(Om-k/2)/dR');
var prev = null;
for (var i = 1; i <= 60; i++) {
	var R = i * 0.1;
	var O = Galaxy.omega(R, P), k = Galaxy.kappa(R, P);
	var pr = O - k / 2;
	var d = 0;
	if (prev) d = (pr - prev.v) / (R - prev.R);
	console.log(fmt(R) + '\t' + fmt(Galaxy.vc(R, P)) + '\t' + fmt(O) + '\t' + fmt(k) + '\t' + fmt(k / 2) + '\t' + fmt(pr) + '\t' + fmt(d));
	prev = { R: R, v: pr };
}

/* Orbital period map and where alignment persists longest (min |d(Om-k/2)/dR|). */
var best = 0, bestV = 1e9;
for (var j = 5; j <= 55; j++) {
	var R1 = j * 0.1;
	var O1 = Galaxy.omega(R1, P), k1 = Galaxy.kappa(R1, P);
	var h = 0.1;
	var pr1 = O1 - k1 / 2;
	var pr2 = (Galaxy.omega(R1 + h, P) - Galaxy.kappa(R1 + h, P) / 2);
	var slope = Math.abs((pr2 - pr1) / h);
	if (R1 > 0.6 && slope < bestV) { bestV = slope; best = R1; }
}
console.log('\nmin |d(Om-kappa/2)/dR| at R = ' + best.toFixed(2) + ' (kinematic-bar sweet spot)');

/* Resonances for the default pattern speed. */
var res = Galaxy.resonances(P);
console.log('bar  ILR ' + res.bar.ilr.map(fmt).join(',') + '  CR ' + res.bar.cr.map(fmt).join(',') + '  OLR ' + res.bar.olr.map(fmt).join(','));
console.log('spir ILR ' + res.spiral.ilr.map(fmt).join(',') + '  CR ' + res.spiral.cr.map(fmt).join(',') + '  OLR ' + res.spiral.olr.map(fmt).join(','));

/* Time for neighbouring apsidal lines (dR=0.05) to slip by pi/2 = arm decorrelation,
 * relative to the pattern at Om=0.36. Rough kinematic estimate, no forcing. */
console.log('\ndecorr time (t_half, pattern frame) by radius:');
var OmP = P.spiral.om;
for (var q = 6; q <= 54; q += 6) {
	var R0 = q * 0.1;
	var g = function (r) { return Galaxy.omega(r, P) - Galaxy.kappa(r, P) / 2 - OmP; };
	var dd = (g(R0 + 0.05) - g(R0 - 0.05)) / 0.1;
	var t = Math.abs(dd) > 1e-9 ? (Math.PI / 2) / Math.abs(dd) * 0.5 : Infinity;
	console.log(fmt(R0) + '\t' + (t > 1e4 ? 'inf' : t.toFixed(0)) + ' tu');
}
