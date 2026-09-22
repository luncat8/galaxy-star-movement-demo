/* Galaxy star-movement demo: physics only, no DOM.
 * Fixed multi-component potential + rigidly rotating m=2 bar and spiral.
 * Symplectic leapfrog test particles. Units: G=1, v0=1, R0=1.
 */
var Galaxy = (function() {
'use strict';

function defaultParams() {
	return {
		G: 1,
		thin: { md: 0.50, a: 0.50, b: 0.10 },
		thick: { md: 0.30, a: 1.00, b: 0.30 },
		bulge: { mb: 0.20, s: 0.20 },
		halo: { vh2: 0.536, rc: 0.50 },
		bar: { ab: 0.060, rb: 1.20, hb: 0.30, om: 0.36, g: 1 },
		spiral: { as: 0.040, rp: 2.80, sig: 0.50, pitch: 15 * Math.PI / 180, r1: 1.00, zs: 0.50, om: 0.36, g: 1 },
		fade: 8,
		rmin: 0.02,
		vmax: 3.0,
		tramp: 20,
		tsettle: 30,
		dtSettle: 0.02,
		seed: 1234567,
		align: 1,
		alignPeak: 0.14,
		alignRin: 0.8,
		alignRpeak: 2.4,
		alignRtau: 2.2,
		alignYoung: 0
	};
}

/* S2 kinematic-aligned epicycle amplitude e(R). Zero inside R_in (bar/ILR zone
 * already organized by forcing); rises linearly to e_peak at R_peak (mid-forced
 * zone); exponential taper beyond. Thick-disk/class multiplier applied by caller. */
function alignEcc(R, P) {
	var Rin = P.alignRin, Rp = P.alignRpeak, Rt = P.alignRtau, ep = P.alignPeak;
	if (R <= Rin) return 0;
	if (R <= Rp) return ep * (R - Rin) / (Rp - Rin);
	return ep * Math.exp(-(R - Rp) / Rt);
}

/* Spiral L(R) = g(R)*ln(R/r1) with C1 smoothstep freeze across r1±w. */
function spiralLD(R, P, out) {
	var r1 = P.spiral.r1, w = 0.3, lo = r1 - w, hi = r1 + w;
	if (R <= lo) { out[0] = 0; out[1] = 0; return out; }
	if (R >= hi) { out[0] = Math.log(R / r1); out[1] = 1 / R; return out; }
	var x = (R - lo) / (hi - lo), lr = Math.log(R / r1);
	var g = x * x * (3 - 2 * x), dg = 6 * x * (1 - x) / (hi - lo);
	out[0] = g * lr; out[1] = dg * lr + g / R;
	return out;
}

function spiralP(P) { return 1 / Math.tan(P.spiral.pitch); }

function createState(nmax) {
	return {
		n: nmax, nmax: nmax, t: 0, caps: 0,
		x: new Float64Array(nmax), y: new Float64Array(nmax), z: new Float64Array(nmax),
		vx: new Float64Array(nmax), vy: new Float64Array(nmax), vz: new Float64Array(nmax),
		ax: new Float64Array(nmax), ay: new Float64Array(nmax), az: new Float64Array(nmax),
		cls: new Uint8Array(nmax)
	};
}

/* Deterministic PRNG: xorshift128 + Box-Muller with cached spare. */
function RNG(seed) {
	var s0 = seed | 0, s1 = (seed * 1664525 + 1013904223) | 0;
	var s2 = (seed * 22695477 + 1) | 0, s3 = (seed * 1103515245 + 12345) | 0;
	var spare = 0, hasSpare = false;
	if ((s0 | s1 | s2 | s3) === 0) s3 = 1;
	function nextU32() {
		var t = s0 ^ (s0 << 11);
		s0 = s1; s1 = s2; s2 = s3;
		s3 = (s3 ^ (s3 >>> 19)) ^ (t ^ (t >>> 8));
		return s3 >>> 0;
	}
	function next() { return nextU32() / 4294967296; }
	function gauss() {
		var u, v, r;
		if (hasSpare) { hasSpare = false; return spare; }
		do { u = next(); } while (u <= 1e-12);
		v = next(); r = Math.sqrt(-2 * Math.log(u));
		spare = r * Math.sin(6.283185307179586 * v); hasSpare = true;
		return r * Math.cos(6.283185307179586 * v);
	}
	function reset(seed2) {
		s0 = seed2 | 0; s1 = (seed2 * 1664525 + 1013904223) | 0;
		s2 = (seed2 * 22695477 + 1) | 0; s3 = (seed2 * 1103515245 + 12345) | 0;
		if ((s0 | s1 | s2 | s3) === 0) s3 = 1;
		hasSpare = false;
	}
	return { next: next, gauss: gauss, reset: reset };
}

function rampFactor(t, P) {
	if (t <= 0) return 0;
	if (t >= P.tramp) return 1;
	var x = t / P.tramp;
	return x * x * (3 - 2 * x);
}

function gainToward(g, target, step) {
	if (g < target) return Math.min(target, g + step);
	if (g > target) return Math.max(target, g - step);
	return g;
}

function updateModeGains(P, dt, barOn, spirOn) {
	var s = dt / P.fade;
	P.bar.g = gainToward(P.bar.g, barOn ? 1 : 0, s);
	P.spiral.g = gainToward(P.spiral.g, spirOn ? 1 : 0, s);
}

/* Axisymmetric circular speed at cylindrical R, z=0 (closed form). */
function vc(R, P) {
	var G = P.G, v2 = 0, d, q;
	d = R * R + (P.thin.a + P.thin.b) * (P.thin.a + P.thin.b);
	v2 += G * P.thin.md * R * R / (d * Math.sqrt(d));
	d = R * R + (P.thick.a + P.thick.b) * (P.thick.a + P.thick.b);
	v2 += G * P.thick.md * R * R / (d * Math.sqrt(d));
	q = R * R + P.bulge.s * P.bulge.s;
	v2 += G * P.bulge.mb * R * R / (q * Math.sqrt(q));
	v2 += P.halo.vh2 * R * R / (R * R + P.halo.rc * P.halo.rc);
	if (v2 <= 0) return 0;
	return Math.sqrt(v2);
}

function omega(R, P) {
	if (R < 1e-6) return vc(1e-3, P) / 1e-3;
	return vc(R, P) / R;
}

function kappa(R, P) {
	var h = 1e-4 * R + 1e-5;
	var Rm = R - h * 0.5; if (Rm < 1e-4) Rm = 1e-4;
	var o2p = omega(R + h, P), o2m = omega(Rm, P);
	var d = (o2p * o2p - o2m * o2m) / (R + h - Rm);
	var k2 = R * d + 4 * omega(R, P) * omega(R, P);
	if (k2 <= 0) return 0;
	return Math.sqrt(k2);
}

var spiralScratch = [0, 0];

/* Full potential (diagnostics/energy). Not the hot path. */
function potential(x, y, z, t, P, o) {
	var barOn = !o || o.bar !== false, spirOn = !o || o.spiral !== false;
	var ramp = (o && o.ramp !== undefined) ? o.ramp : rampFactor(t, P);
	var R2 = x * x + y * y, R = Math.sqrt(R2), r2 = R2 + z * z;
	var G = P.G, ph = 0, S, D, q, phi, u, u2, fb, Zb, L, lr, fs, Zs, p;
	S = Math.sqrt(P.thin.b * P.thin.b + z * z);
	D = Math.sqrt(R2 + (P.thin.a + S) * (P.thin.a + S));
	ph += -G * P.thin.md / D;
	S = Math.sqrt(P.thick.b * P.thick.b + z * z);
	D = Math.sqrt(R2 + (P.thick.a + S) * (P.thick.a + S));
	ph += -G * P.thick.md / D;
	ph += -G * P.bulge.mb / Math.sqrt(r2 + P.bulge.s * P.bulge.s);
	ph += 0.5 * P.halo.vh2 * Math.log(r2 + P.halo.rc * P.halo.rc);
	if (R < P.rmin) return ph;
	phi = Math.atan2(y, x);
	if (barOn && ramp > 0 && P.bar.ab !== 0) {
		u = R / P.bar.rb; u2 = u * u;
		fb = u2 / (1 + u2 * u2);
		Zb = Math.exp(-z * z / (P.bar.hb * P.bar.hb));
		ph += ramp * P.bar.g * P.bar.ab * fb * Zb * Math.cos(2 * (phi - P.bar.om * t));
	}
	if (spirOn && ramp > 0 && P.spiral.as !== 0) {
		p = spiralP(P);
		L = spiralLD(R, P, spiralScratch)[0];
		lr = Math.log(R / P.spiral.rp) / P.spiral.sig;
		fs = Math.exp(-0.5 * lr * lr);
		Zs = Math.exp(-z * z / (P.spiral.zs * P.spiral.zs));
		ph += ramp * P.spiral.g * P.spiral.as * fs * Zs * Math.cos(2 * (phi - P.spiral.om * t - p * L));
	}
	return ph;
}

/* Single-point acceleration (diagnostics, gradient check). Hot loop is inlined in step(). */
function accelSingle(x, y, z, t, P, o, out) {
	var barOn = !o || o.bar !== false, spirOn = !o || o.spiral !== false;
	var ramp = (o && o.ramp !== undefined) ? o.ramp : rampFactor(t, P);
	var R2 = x * x + y * y, R = Math.sqrt(R2), r2 = R2 + z * z;
	var G = P.G, rmin = P.rmin;
	var ax = 0, ay = 0, az = 0, S, D2, D, com, q, c;
	S = Math.sqrt(P.thin.b * P.thin.b + z * z);
	D2 = R2 + (P.thin.a + S) * (P.thin.a + S); D = Math.sqrt(D2);
	com = -G * P.thin.md / (D2 * D);
	ax += com * x; ay += com * y; az += com * (P.thin.a + S) * z / S;
	S = Math.sqrt(P.thick.b * P.thick.b + z * z);
	D2 = R2 + (P.thick.a + S) * (P.thick.a + S); D = Math.sqrt(D2);
	com = -G * P.thick.md / (D2 * D);
	ax += com * x; ay += com * y; az += com * (P.thick.a + S) * z / S;
	q = r2 + P.bulge.s * P.bulge.s;
	c = -G * P.bulge.mb / (q * Math.sqrt(q));
	ax += c * x; ay += c * y; az += c * z;
	c = -P.halo.vh2 / (r2 + P.halo.rc * P.halo.rc);
	ax += c * x; ay += c * y; az += c * z;
	if (R >= rmin && ramp > 0) {
		var Rc = R, R2c = Rc * Rc;
		var c2 = (x * x - y * y) / R2c, s2 = 2 * x * y / R2c;
		var C, S2, fR, fp, fz, A, f, df, Z, dZ;
		if (barOn && P.bar.ab !== 0) {
			var u = R / P.bar.rb, u2 = u * u, den = 1 + u2 * u2;
			f = u2 / den;
			df = 2 * u * (1 - u2 * u2) / (P.bar.rb * den * den);
			Z = Math.exp(-z * z / (P.bar.hb * P.bar.hb));
			dZ = Z * (-2 * z / (P.bar.hb * P.bar.hb));
			var bb = 2 * P.bar.om * t, cb = Math.cos(bb), sb = Math.sin(bb);
			C = c2 * cb + s2 * sb; S2 = s2 * cb - c2 * sb;
			A = ramp * P.bar.g * P.bar.ab;
			fR = -A * Z * df * C;
			fp = A * Z * f * 2 * S2 / Rc;
			fz = -A * f * C * dZ;
			ax += fR * (x / Rc) - fp * (y / Rc);
			ay += fR * (y / Rc) + fp * (x / Rc);
			az += fz;
		}
		if (spirOn && P.spiral.as !== 0) {
			var p = spiralP(P);
			spiralLD(R, P, spiralScratch);
			var L = spiralScratch[0], dL = spiralScratch[1];
			var lrp = Math.log(R / P.spiral.rp) / P.spiral.sig;
			f = Math.exp(-0.5 * lrp * lrp);
			df = f * (-Math.log(R / P.spiral.rp) / (P.spiral.sig * P.spiral.sig * R));
			Z = Math.exp(-z * z / (P.spiral.zs * P.spiral.zs));
			dZ = Z * (-2 * z / (P.spiral.zs * P.spiral.zs));
			var bs = 2 * (P.spiral.om * t + p * L), cs = Math.cos(bs), ss = Math.sin(bs);
			C = c2 * cs + s2 * ss; S2 = s2 * cs - c2 * ss;
			A = ramp * P.spiral.g * P.spiral.as;
			fR = -A * Z * (df * C + f * 2 * S2 * p * dL);
			fp = A * Z * f * 2 * S2 / Rc;
			fz = -A * f * C * dZ;
			ax += fR * (x / Rc) - fp * (y / Rc);
			ay += fR * (y / Rc) + fp * (x / Rc);
			az += fz;
		}
	}
	out[0] = ax; out[1] = ay; out[2] = az;
	return out;
}

/* Fill ax/ay/az for all active stars at time t. Internal workhorse. */
function computeAccel(st, P, t, barOn, spirOn) {
	var x = st.x, y = st.y, z = st.z, ax = st.ax, ay = st.ay, az = st.az;
	var n = st.n, G = P.G, rmin = P.rmin;
	var ramp = rampFactor(t, P);
	var bb = 2 * P.bar.om * t, cb = Math.cos(bb), sb = Math.sin(bb);
	var bs0 = 2 * P.spiral.om * t, p = spiralP(P);
	var cs0 = Math.cos(bs0), ss0 = Math.sin(bs0);
	var Ab = barOn ? ramp * P.bar.g * P.bar.ab : 0, As = spirOn ? ramp * P.spiral.g * P.spiral.as : 0;
	var rb = P.bar.rb, hb2 = P.bar.hb * P.bar.hb;
	var rp = P.spiral.rp, sig = P.spiral.sig, sig2 = sig * sig, r1 = P.spiral.r1;
	var r1lo = r1 - 0.3, r1hi = r1 + 0.3, lrp1c = Math.log(rp / r1);
	var zs2 = P.spiral.zs * P.spiral.zs;
	var i, R2, R, r2, S, D2, D, com, q, c, Rc, R2c, c2, s2;
	var u, u2, den, fb, dfb, Zb, dZb, C, S2, fR, fp, fz;
	var L, dL, pdL, lx, llr, lg, lrp, lraw, fs, dfs, Zs, dZs, bs, cs, ss;
	var doModes = ramp > 0 && (Ab !== 0 || As !== 0);
	for (i = 0; i < n; i++) {
		var xi = x[i], yi = y[i], zi = z[i];
		R2 = xi * xi + yi * yi; R = Math.sqrt(R2); r2 = R2 + zi * zi;
		var axi, ayi, azi;
		S = Math.sqrt(P.thin.b * P.thin.b + zi * zi);
		D2 = R2 + (P.thin.a + S) * (P.thin.a + S); D = Math.sqrt(D2);
		com = -G * P.thin.md / (D2 * D);
		axi = com * xi; ayi = com * yi; azi = com * (P.thin.a + S) * zi / S;
		S = Math.sqrt(P.thick.b * P.thick.b + zi * zi);
		D2 = R2 + (P.thick.a + S) * (P.thick.a + S); D = Math.sqrt(D2);
		com = -G * P.thick.md / (D2 * D);
		axi += com * xi; ayi += com * yi; azi += com * (P.thick.a + S) * zi / S;
		q = r2 + P.bulge.s * P.bulge.s;
		c = -G * P.bulge.mb / (q * Math.sqrt(q));
		axi += c * xi; ayi += c * yi; azi += c * zi;
		c = -P.halo.vh2 / (r2 + P.halo.rc * P.halo.rc);
		axi += c * xi; ayi += c * yi; azi += c * zi;
		if (doModes && R >= rmin) {
			Rc = R; R2c = Rc * Rc;
			c2 = (xi * xi - yi * yi) / R2c; s2 = 2 * xi * yi / R2c;
			if (Ab !== 0) {
				u = R / rb; u2 = u * u; den = 1 + u2 * u2;
				fb = u2 / den;
				dfb = 2 * u * (1 - u2 * u2) / (rb * den * den);
				Zb = Math.exp(-zi * zi / hb2);
				C = c2 * cb + s2 * sb; S2 = s2 * cb - c2 * sb;
				fR = -Ab * Zb * dfb * C;
				fp = Ab * Zb * fb * 2 * S2 / Rc;
				dZb = Zb * (-2 * zi / hb2);
				fz = -Ab * fb * C * dZb;
				axi += fR * (xi / Rc) - fp * (yi / Rc);
				ayi += fR * (yi / Rc) + fp * (xi / Rc);
				azi += fz;
			}
			if (As !== 0) {
				lraw = Math.log(R / rp);
				lrp = lraw / sig;
				fs = Math.exp(-0.5 * lrp * lrp);
				dfs = fs * (-lraw / (sig2 * R));
				Zs = Math.exp(-zi * zi / zs2);
				if (R <= r1lo) { cs = cs0; ss = ss0; pdL = 0; }
				else {
					if (R >= r1hi) { L = lraw + lrp1c; dL = 1 / R; }
					else {
						lx = (R - r1lo) / (r1hi - r1lo); llr = lraw + lrp1c;
						lg = lx * lx * (3 - 2 * lx);
						L = lg * llr;
						dL = 6 * lx * (1 - lx) / (r1hi - r1lo) * llr + lg / R;
					}
					bs = bs0 + 2 * p * L;
					cs = Math.cos(bs); ss = Math.sin(bs);
					pdL = p * dL;
				}
				C = c2 * cs + s2 * ss; S2 = s2 * cs - c2 * ss;
				fR = -As * Zs * (dfs * C + fs * 2 * S2 * pdL);
				fp = As * Zs * fs * 2 * S2 / Rc;
				dZs = Zs * (-2 * zi / zs2);
				fz = -As * fs * C * dZs;
				axi += fR * (xi / Rc) - fp * (yi / Rc);
				ayi += fR * (yi / Rc) + fp * (xi / Rc);
				azi += fz;
			}
		}
		ax[i] = axi; ay[i] = ayi; az[i] = azi;
	}
}

function step(st, P, dt, barOn, spirOn) {
	var n = st.n, h = dt * 0.5;
	var x = st.x, y = st.y, z = st.z, vx = st.vx, vy = st.vy, vz = st.vz;
	var ax = st.ax, ay = st.ay, az = st.az;
	var vmax2 = P.vmax * P.vmax, i;
	for (i = 0; i < n; i++) {
		vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
	}
	for (i = 0; i < n; i++) {
		x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
	}
	st.t += dt;
	computeAccel(st, P, st.t, barOn, spirOn);
	for (i = 0; i < n; i++) {
		var nvx = vx[i] + ax[i] * h, nvy = vy[i] + ay[i] * h, nvz = vz[i] + az[i] * h;
		var v2 = nvx * nvx + nvy * nvy + nvz * nvz;
		if (v2 > vmax2) {
			var s = P.vmax / Math.sqrt(v2);
			nvx *= s; nvy *= s; nvz *= s;
			st.caps++;
		}
		vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
	}
}

/* Teaching-tool dissipation, applied once per frame (not per substep). */
function applyDrag(st, h, eta, sig, rng) {
	var n = st.n, vx = st.vx, vy = st.vy, vz = st.vz, i;
	var damp = eta > 0 ? Math.exp(-eta * h) : 1;
	var s = sig > 0 ? sig * Math.sqrt(h) : 0;
	if (damp === 1 && s === 0) return;
	if (s === 0) {
		for (i = 0; i < n; i++) { vx[i] *= damp; vy[i] *= damp; vz[i] *= damp; }
		return;
	}
	for (i = 0; i < n; i++) {
		vx[i] = vx[i] * damp + s * rng.gauss();
		vy[i] = vy[i] * damp + s * rng.gauss();
		vz[i] = vz[i] * damp + s * rng.gauss();
	}
}

function buildDiskTable(h, rlo, rhi, size) {
	var rs = new Float64Array(size), cdf = new Float64Array(size), i;
	var acc = 0, prevR = rlo, prevP = rlo * Math.exp(-rlo / h), r, pdf;
	for (i = 0; i < size; i++) {
		r = rlo + (rhi - rlo) * i / (size - 1);
		pdf = r * Math.exp(-r / h);
		if (i > 0) acc += 0.5 * (prevP + pdf) * (r - prevR);
		rs[i] = r; cdf[i] = acc;
		prevR = r; prevP = pdf;
	}
	for (i = 0; i < size; i++) cdf[i] /= acc;
	return { rs: rs, cdf: cdf };
}

function sampleDisk(tab, u) {
	var rs = tab.rs, cdf = tab.cdf, lo = 0, hi = cdf.length - 1, mid;
	if (u <= 0) return rs[0];
	if (u >= 1) return rs[hi];
	while (hi - lo > 1) {
		mid = (lo + hi) >> 1;
		if (cdf[mid] < u) lo = mid; else hi = mid;
	}
	var t = (u - cdf[lo]) / (cdf[hi] - cdf[lo] + 1e-12);
	return rs[lo] + t * (rs[hi] - rs[lo]);
}

/* 0 thin 30%, 5 young 25%, 1 thick 25%, 2 bulge 10%, 3 halo 8%, 4 stream 2%. */
function classFor(i) {
	var m = i % 100;
	if (m < 30) return 0;
	if (m < 55) return 5;
	if (m < 80) return 1;
	if (m < 90) return 2;
	if (m < 98) return 3;
	return 4;
}

function foldPrograde(st, i) {
	var x = st.x[i], y = st.y[i], R = Math.sqrt(x * x + y * y);
	if (R < 1e-6) return;
	var vR = (x * st.vx[i] + y * st.vy[i]) / R;
	var vp = Math.abs((x * st.vy[i] - y * st.vx[i]) / R);
	st.vx[i] = vR * x / R - vp * y / R;
	st.vy[i] = vR * y / R + vp * x / R;
}

/* S2: nudge disk stars onto epicyclic ellipses whose major axes lie along the
 * spiral crest phi_spiral(R) at t=0 (same winding law as the potential, pattern
 * frame). For each thin/young/thick star we apply a small (dR, dvR, dvp)
 * perturbation: radial shift outward near crests, inward near troughs (so
 * orbits compress at the apocenter side = arm); matching epicyclic velocity
 * puts the star on a near-closed ellipse. Random dispersions are preserved.
 * Inner disk is relocked by forcing during the 30-tu settle; outer disk starts
 * with full-disk arms that shear over ~20-70 tu (curve-precession.js t_decorr)
 * — an honest transient unwind, not a render fake. */
function alignEpicycles(st, P) {
	if (!P.align) return;
	var n = st.n, i;
	var p = spiralP(P), r1 = P.spiral.r1;
	var r1lo = r1 - 0.3, r1hi = r1 + 0.3;
	for (i = 0; i < n; i++) {
		var c = st.cls[i];
		if (c !== 0 && c !== 1 && c !== 5) continue;
		var xi = st.x[i], yi = st.y[i];
		var vxi = st.vx[i], vyi = st.vy[i];
		var R2 = xi * xi + yi * yi, R = Math.sqrt(R2);
		if (R < 0.3 || R > 7) continue;
		/* Crest azimuth phi_spiral(R) at t=0 (inertial frame). */
		var L, lx, lr, lg;
		if (R <= r1lo) L = 0;
		else if (R >= r1hi) L = Math.log(R / r1);
		else {
			lx = (R - r1lo) / (r1hi - r1lo); lr = Math.log(R / r1);
			lg = lx * lx * (3 - 2 * lx); L = lg * lr;
		}
		var phiC = p * L;
		/* Class multiplier: cold young disk is left alone (alignYoung=0) — its own
		 * linear response already carries arms past R=4 (amp 0.4-0.86); crest-phase
		 * seeding on top was measured to fight it (young outer amp drops to 0.20).
		 * Thick disk is warm and barely responsive: 0.4. */
		var mult = c === 5 ? P.alignYoung : c === 1 ? 0.4 : 1.0;
		var e = alignEcc(R, P) * mult;
		if (e <= 0.003) continue;
		var a = e * R; /* radial epicycle amplitude */
		var phi = Math.atan2(yi, xi);
		/* Nearest of the two m=2 crests: chi in [-pi/2, pi/2]. */
		var dphi = phi - phiC;
		dphi = ((dphi + Math.PI) % (2 * Math.PI)) - Math.PI;
		if (dphi > Math.PI / 2) dphi -= Math.PI;
		else if (dphi < -Math.PI / 2) dphi += Math.PI;
		var ca = Math.cos(dphi), sa = Math.sin(dphi);
		/* Crest-pointing unit vector (points toward nearest arm direction). */
		var cam = Math.cos(phiC + (Math.abs(phi - phiC) > Math.PI / 2 + 1e-6 ? Math.PI : 0));
		var sam = Math.sin(phiC + (Math.abs(phi - phiC) > Math.PI / 2 + 1e-6 ? Math.PI : 0));
		/* Radial shift dR = a*ca: moves star outward if near crest (ca>0), inward
		 * if near trough (ca<0). Compresses azimuthal spacing on the crest side
		 * where orbits crowd (apocenter pile-up). Shift along the radial direction
		 * at the star's current azimuth, NOT along the crest vector, to preserve
		 * approximate angle and avoid azimuthal translation. */
		var cf = xi / R, sf = yi / R;
		var dR = a * ca;
		var nR = R + dR;
		if (nR < 0.05) continue;
		var nx = nR * cf, ny = nR * sf;
		/* Decompose existing velocity into (vR, vp) polar at old position; preserve
		 * random component, apply epicyclic velocity at new phase dphi.
		 * Linear epicycle (BT sec 3.2.3): guiding center at Rg, chi is epicycle
		 * phase (chi=0 -> apocenter, chi=pi -> pericenter).
		 *   dR =  -a * cos(chi)         [signed; max + at apocenter]
		 *   vR =   a * kappa * sin(chi)
		 *   vp = vc(Rg) - (Gamma1) * ...  tangential epicycle
		 * where standard closed epicycle in the axisymmetric potential gives
		 * tangential amplitude b = (2*Omega/kappa)*a, so dvp = -Omega * a * cos(chi)
		 * at apocenter (conservation of L: Rg*vc = (Rg+a)*vp -> vp ~ vc - Omega*a). */
		var vR0 = vxi * cf + vyi * sf;
		var vp0 = -vxi * sf + vyi * cf;
		var k = kappa(R, P), Om = omega(R, P);
		/* Epicyclic vR added; existing vR0 already includes random radial dispersion. */
		var nvR = vR0 + a * k * sa * 0.5;
		/* Tangential velocity at new radius: conserve the random part of angular
		 * momentum (vp0*R) so stars don't get a torquing kick, and add the
		 * epicyclic tangential component at the new apocenter/pericenter phase. */
		var vpCirc = vc(nR, P);
		var Lrand = vp0 * R - vc(R, P) * R; /* random angular momentum excess */
		var dvpEpi = -Om * a * ca; /* cos term: slow at apocenter, fast at pericenter */
		var nvp = vpCirc + Lrand / nR + dvpEpi;
		st.x[i] = nx; st.y[i] = ny;
		st.vx[i] = nvR * (nx / nR) - nvp * (ny / nR);
		st.vy[i] = nvR * (ny / nR) + nvp * (nx / nR);
	}
}

function initStars(st, P, seed) {
	var rng = RNG(seed === undefined ? P.seed : seed);
	var tabThin = buildDiskTable(1.0, 0.05, 6, 1024);
	var tabThick = buildDiskTable(1.6, 0.05, 7, 1024);
	var nmax = st.nmax, i;
	var s0x = 3.0, s0y = 0, s0z = 1.0, svx = -0.10, svy = 0.55, svz = 0.15;
	for (i = 0; i < nmax; i++) {
		var c = classFor(i), R, phi, vR, vp, zz, vvz, cf, sf;
		st.cls[i] = c;
		if (c === 0 || c === 1 || c === 5) {
			var thick = c === 1, young = c === 5;
			R = sampleDisk(thick ? tabThick : tabThin, rng.next());
			phi = 6.283185307179586 * rng.next();
			cf = Math.cos(phi); sf = Math.sin(phi);
			vp = vc(R, P) + (thick ? 0.20 : young ? 0.05 : 0.14) * rng.gauss();
			vR = (thick ? 0.15 : young ? 0.05 : 0.12) * rng.gauss();
			zz = (thick ? 0.15 * R : young ? 0.02 : 0.06) * rng.gauss();
			vvz = (thick ? 0.12 : young ? 0.025 : 0.07) * rng.gauss();
			st.x[i] = R * cf; st.y[i] = R * sf; st.z[i] = zz;
			st.vx[i] = vR * cf - vp * sf;
			st.vy[i] = vR * sf + vp * cf;
			st.vz[i] = vvz;
		} else if (c === 2) {
			var u = 1e-4 + (0.999 - 1e-4) * rng.next();
			var rb = P.bulge.s / Math.sqrt(Math.pow(u, -2 / 3) - 1);
			var zc = 2 * rng.next() - 1, pa = 6.283185307179586 * rng.next();
			var sp = Math.sqrt(1 - zc * zc);
			st.x[i] = rb * sp * Math.cos(pa);
			st.y[i] = rb * sp * Math.sin(pa);
			st.z[i] = rb * zc;
			st.vx[i] = 0.55 * rng.gauss();
			st.vy[i] = 0.55 * rng.gauss();
			st.vz[i] = 0.55 * rng.gauss();
			foldPrograde(st, i);
		} else if (c === 3) {
			var uh = rng.next(), ih = uh * (0.3780 - 1.1180) + 1.1180;
			var rh = 1 / (ih * ih);
			var zh = 2 * rng.next() - 1, ph2 = 6.283185307179586 * rng.next();
			var sh = Math.sqrt(1 - zh * zh);
			st.x[i] = rh * sh * Math.cos(ph2);
			st.y[i] = rh * sh * Math.sin(ph2);
			st.z[i] = rh * zh;
			st.vx[i] = 0.50 * rng.gauss();
			st.vy[i] = 0.50 * rng.gauss();
			st.vz[i] = 0.50 * rng.gauss();
			foldPrograde(st, i);
		} else {
			st.x[i] = s0x + 0.03 * rng.gauss();
			st.y[i] = s0y + 0.03 * rng.gauss();
			st.z[i] = s0z + 0.03 * rng.gauss();
			st.vx[i] = svx + 0.01 * rng.gauss();
			st.vy[i] = svy + 0.01 * rng.gauss();
			st.vz[i] = svz + 0.01 * rng.gauss();
		}
	}
	/* S2: seed aligned epicycles BEFORE initial accel computation. */
	alignEpicycles(st, P);
	st.n = nmax; st.t = 0; st.caps = 0;
	computeAccel(st, P, 0, true, true);
	return rng;
}

function settle(st, P, steps, dt, barOn, spirOn) {
	for (var k = 0; k < steps; k++) step(st, P, dt, barOn, spirOn);
}

function energy1(x, y, z, vx, vy, vz, t, P, o) {
	return 0.5 * (vx * vx + vy * vy + vz * vz) + potential(x, y, z, t, P, o);
}

function jacobi1(x, y, z, vx, vy, vz, t, P, om, o) {
	return energy1(x, y, z, vx, vy, vz, t, P, o) - om * (x * vy - y * vx);
}

function omFn(R, P, om, kind) {
	var O = omega(R, P);
	if (kind === 0) return O - om;
	if (kind === 1) return O - 0.5 * kappa(R, P) - om;
	return O + 0.5 * kappa(R, P) - om;
}

function findRoots(P, om, kind) {
	var out = [], N = 400, lo = 0.2, hi = 6, i;
	var prevR = lo, prevV = omFn(lo, P, om, kind), R, v, a, b, fa, m, fm, k;
	for (i = 1; i <= N; i++) {
		R = lo + (hi - lo) * i / N;
		v = omFn(R, P, om, kind);
		if (prevV === 0) out.push(prevR);
		else if (v * prevV < 0) {
			a = prevR; b = R; fa = prevV;
			for (k = 0; k < 40; k++) {
				m = 0.5 * (a + b); fm = omFn(m, P, om, kind);
				if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
			}
			out.push(0.5 * (a + b));
		}
		prevR = R; prevV = v;
	}
	return out;
}

function resonances(P) {
	return {
		bar:  { ilr: findRoots(P, P.bar.om, 1), cr: findRoots(P, P.bar.om, 0), olr: findRoots(P, P.bar.om, 2) },
		spiral: { ilr: findRoots(P, P.spiral.om, 1), cr: findRoots(P, P.spiral.om, 0), olr: findRoots(P, P.spiral.om, 2) }
	};
}

return {
	defaultParams: defaultParams,
	createState: createState,
	initStars: initStars,
	settle: settle,
	step: step,
	computeAccel: computeAccel,
	accelSingle: accelSingle,
	potential: potential,
	applyDrag: applyDrag,
	vc: vc, omega: omega, kappa: kappa,
	resonances: resonances,
	energy1: energy1, jacobi1: jacobi1,
	rampFactor: rampFactor, updateModeGains: updateModeGains, spiralP: spiralP,
	alignEcc: alignEcc, alignEpicycles: alignEpicycles,
	buildDiskTable: buildDiskTable, sampleDisk: sampleDisk,
	classFor: classFor,
	RNG: RNG
};

})();

if (typeof module !== 'undefined' && module.exports) module.exports = Galaxy;
