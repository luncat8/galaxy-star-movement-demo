'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
P.align = 0;
var Rs = [0.3, 0.8, 1.5, 2.5, 4.0], phis = [0, 0.7, 2.1], zs = [0, 0.4, 1.0];
var h = 1e-5, t = 3.7, o = { bar: true, spiral: true, ramp: 1 };
var out = [0, 0, 0], maxRel = 0, maxAbs = 0, worst = '';
var ri, pi, zi, R, phi, x, y, z, a;
for (ri = 0; ri < Rs.length; ri++) {
	for (pi = 0; pi < phis.length; pi++) {
		for (zi = 0; zi < zs.length; zi++) {
			R = Rs[ri]; phi = phis[pi]; z = zs[zi];
			x = R * Math.cos(phi); y = R * Math.sin(phi);
			Galaxy.accelSingle(x, y, z, t, P, o, out);
			var dims = [
				[Galaxy.potential(x + h, y, z, t, P, o), Galaxy.potential(x - h, y, z, t, P, o), out[0]],
				[Galaxy.potential(x, y + h, z, t, P, o), Galaxy.potential(x, y - h, z, t, P, o), out[1]],
				[Galaxy.potential(x, y, z + h, t, P, o), Galaxy.potential(x, y, z - h, t, P, o), out[2]]
			];
			for (a = 0; a < 3; a++) {
				var num = -(dims[a][0] - dims[a][1]) / (2 * h);
				var ana = dims[a][2];
				var abs = Math.abs(ana - num);
				var rel = abs / Math.max(Math.abs(ana), 1e-3);
				if (abs > maxAbs) maxAbs = abs;
				if (rel > maxRel) {
					maxRel = rel;
					worst = 'R=' + R + ' phi=' + phi + ' z=' + z + ' dim=' + a + ' ana=' + ana + ' num=' + num;
				}
				if (rel > 1e-4 && abs > 1e-7)
					L.fail('grad mismatch ' + worst + ' rel=' + rel + ' abs=' + abs);
			}
		}
	}
}
console.log('static modes: maxRel=' + maxRel.toExponential(2) + ' maxAbs=' + maxAbs.toExponential(2) + ' worst: ' + worst);
L.pass('check-gradient static modes analytic vs numeric within 1e-4');

/* Live mode force must equal -grad of the live potential, including the
 * measured dtheta/dR term in the radial wavenumber. Synthetic analytic profile
 * written straight into the table (freeze), so the check is about the gradient
 * algebra and the C1 table interpolation, not about the response measurement. */
(function liveGradient() {
	var Pl = Galaxy.defaultParams();
	Pl.align = 0;
	Pl.bar.g = 0; Pl.spiral.g = 1; Pl.live.gfb = 1;
	Pl.live.freeze = true;
	var stl = Galaxy.createState(1);
	var Lv = stl.live, i, R;
	for (i = 0; i < Lv.nb; i++) {
		R = Lv.rc[i];
		Lv.amp[i] = 0.02 * Math.exp(-(R - 2.5) * (R - 2.5) / 6) + 0.004;
		Lv.th[i] = -2.5 * R + 0.3 * Math.sin(R);
	}
	var o2 = { bar: false, spiral: true, ramp: 1, live: Lv };
	var t2 = 2.3, h2 = 1e-5, maxRel2 = 0, maxAbs2 = 0, worst2 = '', out2 = [0, 0, 0];
	var Rs2 = [0.5, 1.1, 2.2, 3.4, 4.6, 5.9], phis2 = [0.2, 1.9, 4.1], zs2 = [0, 0.5];
	Rs2.forEach(function(RR) { phis2.forEach(function(pp) { zs2.forEach(function(zz) {
		var X = RR * Math.cos(pp), Y = RR * Math.sin(pp);
		Galaxy.accelSingle(X, Y, zz, t2, Pl, o2, out2);
		[
			[Galaxy.potential(X + h2, Y, zz, t2, Pl, o2), Galaxy.potential(X - h2, Y, zz, t2, Pl, o2), out2[0]],
			[Galaxy.potential(X, Y + h2, zz, t2, Pl, o2), Galaxy.potential(X, Y - h2, zz, t2, Pl, o2), out2[1]],
			[Galaxy.potential(X, Y, zz + h2, t2, Pl, o2), Galaxy.potential(X, Y, zz - h2, t2, Pl, o2), out2[2]]
		].forEach(function(d, dim) {
			var num = -(d[0] - d[1]) / (2 * h2);
			var abs = Math.abs(d[2] - num), rel = abs / Math.max(Math.abs(d[2]), 1e-3);
			if (abs > maxAbs2) maxAbs2 = abs;
			if (rel > maxRel2) { maxRel2 = rel; worst2 = 'R=' + RR + ' dim=' + dim + ' ana=' + d[2] + ' num=' + num; }
			if (rel > 1e-4 && abs > 1e-7) L.fail('live grad mismatch ' + worst2 + ' rel=' + rel + ' abs=' + abs);
		});
	}); }); });
	console.log('live mode  : maxRel=' + maxRel2.toExponential(2) + ' maxAbs=' + maxAbs2.toExponential(2) + ' worst: ' + worst2);
	L.pass('check-gradient live m=2 term analytic vs numeric within 1e-4');
})();

/* 0.5.0: the variant table (SelfGrav.solve from a synthetic measurement) must
 * pass the same gradient gate — exercises the kernel write path, the edge
 * taper and the re-unwrap, then the identical force algebra. */
(function selfGravGradient() {
	var SelfGrav = require('../selfgrav.js');
	var Pg = Galaxy.defaultParams();
	Pg.align = 0;
	Pg.bar.g = 0; Pg.spiral.g = 1; Pg.live.gfb = 1;
	Pg.live.freeze = true; Pg.live.cap = 0.10;
	SelfGrav.ensure(Pg);
	var stg = Galaxy.createState(1), Lg = stg.live, i, R;
	for (i = 0; i < Lg.nb; i++) {
		R = Lg.rc[i];
		var w = Math.exp(-(R - 2.6) * (R - 2.6) / 5);
		/* crest phase varying with R so dtheta/dR is exercised */
		Lg.pr[i] = 0.03 * w * Math.cos(-2.2 * R + 0.4 * Math.sin(R));
		Lg.pi[i] = 0.03 * w * Math.sin(-2.2 * R + 0.4 * Math.sin(R));
		Lg.mask[i] = 1;
	}
	SelfGrav.solve(stg, Pg, 1);
	var o3 = { bar: false, spiral: true, ramp: 1, live: Lg };
	var t3 = 1.9, h3 = 1e-5, maxRel3 = 0, maxAbs3 = 0, worst3 = '', out3 = [0, 0, 0];
	var Rs3 = [0.6, 1.4, 2.6, 3.8, 5.0, 6.2], phis3 = [0.4, 2.6, 5.0], zs3 = [0, 0.6];
	Rs3.forEach(function(RR) { phis3.forEach(function(pp) { zs3.forEach(function(zz) {
		var X = RR * Math.cos(pp), Y = RR * Math.sin(pp);
		Galaxy.accelSingle(X, Y, zz, t3, Pg, o3, out3);
		[
			[Galaxy.potential(X + h3, Y, zz, t3, Pg, o3), Galaxy.potential(X - h3, Y, zz, t3, Pg, o3), out3[0]],
			[Galaxy.potential(X, Y + h3, zz, t3, Pg, o3), Galaxy.potential(X, Y - h3, zz, t3, Pg, o3), out3[1]],
			[Galaxy.potential(X, Y, zz + h3, t3, Pg, o3), Galaxy.potential(X, Y, zz - h3, t3, Pg, o3), out3[2]]
		].forEach(function(d, dim) {
			var num = -(d[0] - d[1]) / (2 * h3);
			var abs = Math.abs(d[2] - num), rel = abs / Math.max(Math.abs(d[2]), 1e-3);
			if (abs > maxAbs3) maxAbs3 = abs;
			if (rel > maxRel3) { maxRel3 = rel; worst3 = 'R=' + RR + ' dim=' + dim + ' ana=' + d[2] + ' num=' + num; }
			if (rel > 1e-4 && abs > 1e-7) L.fail('selfgrav grad mismatch ' + worst3 + ' rel=' + rel + ' abs=' + abs);
		});
	}); }); });
	console.log('selfgrav   : maxRel=' + maxRel3.toExponential(2) + ' maxAbs=' + maxAbs3.toExponential(2) + ' worst: ' + worst3);
	L.pass('check-gradient variant (selfgrav) table analytic vs numeric within 1e-4');
})();
