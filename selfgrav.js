/* 0.5.0 global m=2 self-gravity: a SEPARATE engine variant (galaxy.js untouched).
 *
 * Replaces the local WKB density->force line with a global m=2 Green's-function
 * solve on the same 32-bin live grid. The seam is P.live.freeze: with it set,
 * galaxy.js stops refreshing the force tables but still accumulates the
 * pattern-frame m=2 moment (cr/ci/ms) in its hot loop and still applies the
 * force through the same amp(R), theta(R) interface. This file owns the refresh:
 *
 *   step()  count substeps; every P.sg.refresh run:
 *             scale cr/ci/ms by the ACTUAL window length (they are sums),
 *             Galaxy.updateLive(...)   -- measurement, pattern rotation,
 *                                        smoothing, tau low-pass, mask (0.4.0
 *                                        steps 1-2, no code duplicated),
 *             solve()                  -- kernel product overwrites amp/th.
 *
 * Kernel (precomputed once, 32x32, m=2, Plummer-softened razor-thin layer):
 *   g_m(R,R') = int_0^2pi cos(m psi) / sqrt(R^2+R'^2-2RR'cos psi + eps^2) dpsi
 *   K[i][j]   = -G * int_{bin j} g_m(R_i,R') R' dR'        (NSUB sub-points)
 *   Phi(R_i)  = sum_j K[i][j] * a(R_j),  a = mask * 2 * phasor / area
 *
 * Phase (0.5.0 plan 3.2, gated by check-selfgrav-phase.js): the density crest
 * sits at u = arg(phasor), u = 2*(phi - Om t - p L). K is real NEGATIVE, so
 * arg(K*a) already carries the +pi the shipped WKB rule adds by hand; the
 * force path (hill at theta, well at theta+pi) therefore takes
 * theta = atan2(Phi_im, Phi_re) with NO extra +pi. Gain is baked into the
 * table before the cap saturation (force reads amp directly), and the output
 * is tapered by the grid edge so the R < LIVE_RHI force cut stays smooth.
 */
var SelfGrav = (function() {
'use strict';

var Galaxy = (typeof require !== 'undefined') ? require('./galaxy.js') : (typeof window !== 'undefined' ? window.Galaxy : null);

var NB = 32, RLO = 0.3, RHI = 8.0, DR = (RHI - RLO) / NB;
var DEFAULTS = { solver: 0, eps: 0.15, nsub: 8, nq: 256, refresh: 4, cap: 0.10 };

var K = null, kSig = '';            /* m=2 kernel (the production one) + its build signature */
var KC = {};                        /* K_m cache for checks: key m|G|eps|nsub|nq */
var edge = new Float64Array(NB);    /* LIVE_EDGE equivalent: smooth zero at both ends */
var aRe = new Float64Array(NB), aIm = new Float64Array(NB);   /* density harmonic */
var pRe = new Float64Array(NB), pIm = new Float64Array(NB);   /* raw solved Phi (last solve) */
var pendN = 0, pendDt = 0;          /* substeps / elapsed time since last refresh */

function sstep(x) {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	return x * x * (3 - 2 * x);
}

function buildEdge() {
	for (var i = 0; i < NB; i++) {
		var rc = RLO + (i + 0.5) * DR;
		/* inner factor sstep((rc-0.75)/0.15) pins bins 0-1 to EXACT zero:
		 * galaxy.js's liveSample clamps amp to 0 for R < LIVE_RLO with the
		 * derivative zeroed too, so the table must arrive at that boundary
		 * with value AND CR slope = 0 or the kink injects O(dt) EJ jumps at
		 * every crossing (the WKB tables squeak by on amplitude; the global
		 * solve's inner field is 5x stronger and does not). The lost zone is
		 * R < 0.78, inside the ILR — outside the study. */
		edge[i] = sstep((rc - 0.75) / 0.15) * sstep((RHI - 0.4 - rc) / 1.2);
	}
}
buildEdge();   /* grid constants only — no params, once at load */

/* K_m for any m (production uses m=2; checks gate the same quadrature at
 * m=0). Cached per (m, params) signature. */
function harmonic(P, m) {
	var sg = P.sg, nsub = sg.nsub, nq = sg.nq, eps = sg.eps;
	var sig = m + '|' + P.G + '|' + eps + '|' + nsub + '|' + nq;
	if (KC[sig]) return KC[sig];
	var NB1 = Galaxy.LIVE_NB, dr = (Galaxy.LIVE_RHI - Galaxy.LIVE_RLO) / NB1;
	var rc = new Float64Array(NB1);
	var i, j, q;
	for (i = 0; i < NB1; i++) rc[i] = Galaxy.LIVE_RLO + (i + 0.5) * dr;
	var wq = 2 * Math.PI / nq, cosT = new Float64Array(nq), cosP = new Float64Array(nq);
	for (i = 0; i < nq; i++) { cosP[i] = Math.cos(wq * (i + 0.5)); cosT[i] = Math.cos(m * wq * (i + 0.5)); }
	var dRs = dr / nsub, Km = new Float64Array(NB1 * NB1);
	for (i = 0; i < NB1; i++) {
		for (j = 0; j < NB1; j++) {
			var acc = 0, lo = Galaxy.LIVE_RLO + j * dr;
			for (q = 0; q < nsub; q++) {
				var Rp = lo + dRs * (q + 0.5), s = 0, d2 = rc[i] * rc[i] + Rp * Rp + eps * eps, k;
				for (k = 0; k < nq; k++) s += cosT[k] / Math.sqrt(d2 - 2 * rc[i] * Rp * cosP[k]);
				acc += s * wq * Rp * dRs;
			}
			Km[i * NB1 + j] = -P.G * acc;
		}
	}
	KC[sig] = Km;
	if (m === 2) { K = Km; kSig = sig; }
	return Km;
}

/* Attach P.sg (galaxy.js defaultParams never gains the key) and build the
 * m=2 kernel if params changed. Cheap when already built. */
function ensure(P) {
	var k, sg = P.sg;
	if (!sg) {
		sg = {};
		for (k in DEFAULTS) sg[k] = DEFAULTS[k];
		P.sg = sg;
	}
	if (!K || kSig !== 2 + '|' + P.G + '|' + sg.eps + '|' + sg.nsub + '|' + sg.nq) harmonic(P, 2);
	return P.sg;
}

function reset() { pendN = 0; pendDt = 0; }

/* Write amp/th from an explicit complex potential (raw Phi, unsaturated).
 * gain enters BEFORE the cap saturation, as in the WKB line; output carries
 * the edge taper; theta is re-unwrapped for the Catmull-Rom derivative. */
function writeTable(L, P, srcRe, srcIm, gain) {
	var cap = P.live.cap, i, mag, est;
	for (i = 0; i < NB; i++) {
		mag = Math.sqrt(srcRe[i] * srcRe[i] + srcIm[i] * srcIm[i]);
		est = gain * mag;
		L.amp[i] = edge[i] * (cap * est / (est + cap));
		L.th[i] = Math.atan2(srcIm[i], srcRe[i]);
	}
	for (i = 1; i < NB; i++) {
		while (L.th[i] - L.th[i - 1] > Math.PI) L.th[i] -= 2 * Math.PI;
		while (L.th[i] - L.th[i - 1] < -Math.PI) L.th[i] += 2 * Math.PI;
	}
}

/* Solve from the CURRENT (pr, pi, mask) — assumes Galaxy.updateLive has just
 * run so the measurement, low-pass and mask are fresh. Leaves the raw Phi in
 * pRe/pIm (readable as SelfGrav.lastPhi for open-loop averaging). */
function solve(st, P, gain) {
	var L = st.live, nb = L.nb, NB1 = Galaxy.LIVE_NB, i, j, re, im, k;
	for (i = 0; i < nb; i++) {
		aRe[i] = L.mask[i] * 2 * L.pr[i] / L.area[i];
		aIm[i] = L.mask[i] * 2 * L.pi[i] / L.area[i];
	}
	for (i = 0; i < nb; i++) {
		re = 0; im = 0;
		for (j = 0; j < nb; j++) { k = K[i * NB1 + j]; re += k * aRe[j]; im += k * aIm[j]; }
		pRe[i] = re; pIm[i] = im;
	}
	writeTable(L, P, pRe, pIm, gain);
}

/* One tick of n substeps of size dt elapsed since the last tick. Counts them
 * and refreshes every P.sg.refresh (window may be longer on settle chunks —
 * the divide is by the ACTUAL count). gain = Galaxy.liveGain(...): baked into
 * the table here, never multiplied at force time. */
function step(st, P, t, dt, n, gain) {
	ensure(P);
	pendN += n; pendDt += dt;
	if (pendN < P.sg.refresh) return false;
	var L = st.live, inv = 1 / pendN, i;
	for (i = 0; i < L.nb; i++) { L.cr[i] *= inv; L.ci[i] *= inv; L.ms[i] *= inv; }
	Galaxy.updateLive(st, P, t, pendDt, gain);
	pendN = 0; pendDt = 0;
	solve(st, P, gain);
	return true;
}

return {
	defaults: function() { var k, o = {}; for (k in DEFAULTS) o[k] = DEFAULTS[k]; return o; },
	ensure: ensure,
	reset: reset,
	step: step,
	solve: solve,
	writeTable: writeTable,
	kernel: function(P) { ensure(P); return K; },
	harmonic: function(P, m) { ensure(P); return harmonic(P, m); },
	lastPhi: { re: pRe, im: pIm },
	/* raw Phi for a given (pr, pi, mask)-independent input a = mask*2*phasor/area:
	 * used by checks to build a table without running the measurement */
	phiOf: function(P, srcRe, srcIm, outRe, outIm) {
		ensure(P);
		var NB1 = Galaxy.LIVE_NB, i, j, re, im, k;
		for (i = 0; i < NB1; i++) {
			re = 0; im = 0;
			for (j = 0; j < NB1; j++) {
				k = K[i * NB1 + j];
				re += k * srcRe[j]; im += k * srcIm[j];
			}
			outRe[i] = re; outIm[i] = im;
		}
		return outRe;
	}
};

})();

if (typeof module !== 'undefined' && module.exports) module.exports = SelfGrav;
