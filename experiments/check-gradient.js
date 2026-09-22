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
console.log('maxRel=' + maxRel.toExponential(2) + ' maxAbs=' + maxAbs.toExponential(2) + ' worst: ' + worst);
L.pass('check-gradient analytic vs numeric within 1e-4');
