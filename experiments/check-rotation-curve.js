'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
var R, v, worst = 0, worstR = 0;
for (R = 0.3; R <= 5.001; R += 0.1) {
	v = Galaxy.vc(R, P);
	var dev = v < 0.7 ? 0.7 - v : (v > 1.2 ? v - 1.2 : 0);
	if (dev > worst) { worst = dev; worstR = R; }
	if (dev > 0) L.fail('vc(' + R.toFixed(2) + ')=' + v.toFixed(3) + ' outside [0.7,1.2]');
}
console.log('vc band ok, nearest margin ' + (0.5 - worst).toFixed(3) + ' at R=' + worstR.toFixed(2) +
	' vc(0.3)=' + Galaxy.vc(0.3, P).toFixed(3) + ' vc(1)=' + Galaxy.vc(1, P).toFixed(3) +
	' vc(2.5)=' + Galaxy.vc(2.5, P).toFixed(3) + ' vc(5)=' + Galaxy.vc(5, P).toFixed(3));
for (R = 0.2; R <= 6.001; R += 0.1) {
	if (!(Galaxy.kappa(R, P) > 0)) L.fail('kappa^2<=0 at R=' + R.toFixed(2));
}
var pts = [0.9, 1.0, 1.1], i, q;
for (i = 0; i < pts.length; i++) {
	q = Galaxy.kappa(pts[i], P) / Galaxy.omega(pts[i], P);
	console.log('R=' + pts[i].toFixed(1) + ' kap/om=' + q.toFixed(4));
	if (q < 1.35 || q > 1.50) L.fail('kap/om=' + q + ' outside [1.35,1.50] at R=' + pts[i]);
}
L.pass('check-rotation-curve band + kappa positive + kap/om near sqrt2');
