'use strict';
var L = require('./lib.js'), Galaxy = L.Galaxy;
var P = Galaxy.defaultParams();
var R0 = 1, vR0 = 0.02, T = 120, dt = 0.005, steps = Math.round(T / dt);
var st = Galaxy.createState(1);
st.n = 1;
st.x[0] = R0; st.y[0] = 0; st.z[0] = 0;
st.vx[0] = vR0; st.vy[0] = Galaxy.vc(R0, P); st.vz[0] = 0;
st.t = 0;
Galaxy.computeAccel(st, P, 0, false, false);
var prevR = R0, prevPhi = 0, totPhi = 0, k, tNow = 0;
var cross = [];
for (k = 0; k < steps; k++) {
	Galaxy.step(st, P, dt, false, false);
	tNow += dt;
	var R = Math.sqrt(st.x[0] * st.x[0] + st.y[0] * st.y[0]);
	var phi = Math.atan2(st.y[0], st.x[0]);
	var dp = phi - prevPhi;
	if (dp > Math.PI) dp -= 2 * Math.PI;
	if (dp < -Math.PI) dp += 2 * Math.PI;
	totPhi += dp;
	if (prevR < R0 && R >= R0) cross.push(tNow);
	prevR = R; prevPhi = phi;
}
if (cross.length < 3) L.fail('only ' + cross.length + ' radial crossings');
var trad = (cross[cross.length - 1] - cross[0]) / (cross.length - 1);
var kapM = 2 * Math.PI / trad, omM = totPhi / T;
var kapT = Galaxy.kappa(R0, P), omT = Galaxy.omega(R0, P);
var qM = kapM / omM, qT = kapT / omT, err = Math.abs(qM - qT) / qT;
console.log('radial cyc=' + cross.length + ' azim cyc=' + (totPhi / 2 / Math.PI).toFixed(2) +
	' kap/om meas=' + qM.toFixed(4) + ' theory=' + qT.toFixed(4) + ' err=' + (100 * err).toFixed(2) + '%');
if (err > 0.02) L.fail('epi ratio err ' + (100 * err).toFixed(2) + '% > 2%');
L.pass('check-epi-ratio radial/azimuthal frequencies match theory');
