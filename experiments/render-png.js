/* Headless PNG render of a run, replicating the page render path (sprites,
 * additive blend, tilt projection) including the glow underlay. Node+zlib.
 * Usage: node render-png.js calm|align|noalign -> experiments/logs/render-<name>-<t>tu.png
 *   calm    shipping default preset (spiral-only, P.align as committed)
 *   align   S2 kinematic-aligned ICs experiment (P.align=1)
 *   noalign calm with alignment off (P.align=0) - S2 A/B baseline
 *   live    calm + S5 live m=2 feedback (P.live.gfb, env LIVE, default 50)
 *   live-noalign  live with S2 alignment off (does the seeded field feed it?)
 * env: SPLIT=<R> overrides P.alignSplit (0 = legacy t=0 seeding);
 *      PHASE=<deg> overrides P.alignPhase (0 = seed at the potential hill,
 *      90 = at the well, where the forced response crests - check-arm-phase).
 */
'use strict';
var zlib = require('zlib'), fs = require('fs'), path = require('path');
var Galaxy = require('../galaxy.js');
var L = require('./lib.js');

var W = 560, H = 560, CX = W / 2, CY = H / 2, SCZ = (Math.min(W, H) / 2 - 24) / 6.5;
var TILT = 20 * Math.PI / 180;
var N = 10000, DT = 0.01;
var COL = [[255, 232, 200], [255, 199, 142], [255, 138, 85], [143, 168, 216], [84, 246, 255], [111, 170, 255]];
var CLS_A = [0.85, 0.32, 0.35, 0.16, 0.9, 1.0];
var CLS_S = [7, 6, 6, 5, 7, 8];

var name = process.argv[2] || 'calm';
var P = Galaxy.defaultParams();
P.spiral.om = 0.30; P.spiral.as = 0.06; P.bar.ab = 0;
if (name === 'align') P.align = 1;
else if (name === 'noalign') P.align = 0;
else if (name === 'live') P.live.gfb = parseFloat(process.env.LIVE || '50');
else if (name === 'live-noalign') { P.live.gfb = parseFloat(process.env.LIVE || '50'); P.align = 0; }
else if (name !== 'calm') {
	console.error('variant must be calm, align, noalign, live or live-noalign');
	process.exit(1);
}
if (process.env.SPLIT !== undefined) P.alignSplit = parseFloat(process.env.SPLIT);
if (process.env.PHASE !== undefined) P.alignPhase = parseFloat(process.env.PHASE) * Math.PI / 180;
P.bar.g = 0; P.spiral.g = 1;

/* Framebuffer (linear, additive) + z-free planar projection. */
var fb = new Float32Array(W * H * 3);
var ct = Math.cos(TILT), st_ = Math.sin(TILT);

function clearFb() {
	var i;
	for (i = 0; i < W * H * 3; i += 3) { fb[i] = 0.016; fb[i + 1] = 0.016; fb[i + 2] = 0.039; }
}
function addPx(px, py, r, g, b, a) {
	if (px < 0 || px >= W || py < 0 || py >= H) return;
	var i = (py * W + px) * 3;
	fb[i] += r * a; fb[i + 1] += g * a; fb[i + 2] += b * a;
}
function coreGlow() {
	var rad = 150, x, y;
	for (y = -rad; y <= rad; y++) for (x = -rad; x <= rad; x++) {
		var d = Math.sqrt(x * x + y * y) / rad;
		if (d > 1) continue;
		var a = d < 0.3 ? 0.34 * (1 - d / 0.3 * 0.7) : 0.09 * (1 - d);
		addPx(CX + x | 0, CY + y | 0, 255 / 255, 200 / 255, 140 / 255, a * 0.6);
	}
}

/* Glow underlay: same algorithm as the page (bin in pattern frame -> decay
 * accumulate -> DoG -> soft clip), plus the radial warm-core/blue-rim color
 * ramp: the DoG excess (arms) tints bluer than the base disk light. */
var GN = 96, GEXT = 6.8, GSCALE = GN / (2 * GEXT), GLOW_K = 0.8, GLOW_TAU = 2;
var gRaw = new Float32Array(GN * GN), gScr = new Float32Array(GN * GN);
var gFine = new Float32Array(GN * GN), gWide = new Float32Array(GN * GN);
var gAcc = new Float32Array(GN * GN), gVal = new Float32Array(GN * GN);
var gArmE = new Float32Array(GN * GN), gArmF = new Float32Array(GN * GN);
var gLutR = new Float32Array(GN * GN), gLutG = new Float32Array(GN * GN), gLutB = new Float32Array(GN * GN);
var ARM_R = 150, ARM_G = 186, ARM_B = 255, ARM_T = 0.55;
(function buildGlowLut() {
	var NEUTRAL = [222, 224, 238], WARM = [255, 224, 178], COOL = [158, 194, 255];
	function sstep(a, b, x) {
		var t = (x - a) / (b - a);
		t = t < 0 ? 0 : t > 1 ? 1 : t;
		return t * t * (3 - 2 * t);
	}
	var gx, gy, i = 0, xp, yp, R, wW, wC;
	for (gy = 0; gy < GN; gy++) for (gx = 0; gx < GN; gx++, i++) {
		xp = (gx + 0.5) / GSCALE - GEXT; yp = (gy + 0.5) / GSCALE - GEXT;
		R = Math.sqrt(xp * xp + yp * yp);
		wW = 1 - sstep(1.2, 2.6, R);
		wC = sstep(3.4, 5.6, R);
		gLutR[i] = NEUTRAL[0] + (WARM[0] - NEUTRAL[0]) * wW;
		gLutG[i] = NEUTRAL[1] + (WARM[1] - NEUTRAL[1]) * wW;
		gLutB[i] = NEUTRAL[2] + (WARM[2] - NEUTRAL[2]) * wW;
		gLutR[i] += (COOL[0] - gLutR[i]) * wC;
		gLutG[i] += (COOL[1] - gLutG[i]) * wC;
		gLutB[i] += (COOL[2] - gLutB[i]) * wC;
	}
})();

function blurBox(src, scratch, dst, r) {
	var x, y, k, acc, row, norm = 1 / (2 * r + 1);
	for (y = 0; y < GN; y++) {
		row = y * GN; acc = 0;
		for (k = -r; k <= r; k++) acc += src[row + Math.min(GN - 1, Math.max(0, k))];
		for (x = 0; x < GN; x++) {
			scratch[row + x] = acc * norm;
			acc += src[row + Math.min(GN - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
		}
	}
	for (x = 0; x < GN; x++) {
		acc = 0;
		for (k = -r; k <= r; k++) acc += scratch[Math.min(GN - 1, Math.max(0, k)) * GN + x];
		for (y = 0; y < GN; y++) {
			dst[y * GN + x] = acc * norm;
			acc += scratch[Math.min(GN - 1, y + r + 1) * GN + x] - scratch[Math.max(0, y - r) * GN + x];
		}
	}
}

function accumulateGlow(st, om, dt) {
	var i, gx, gy, c, w, R, xp, yp, xt;
	var psi = om * st.t;
	var cps = Math.cos(psi), sps = Math.sin(psi);
	gRaw.fill(0);
	for (i = 0; i < st.n; i++) {
		c = st.cls[i];
		w = c === 5 ? 1 : c === 0 ? 0.75 : c === 1 ? 0.45 : 0;
		if (w === 0) continue;
		xp = st.x[i]; yp = st.y[i];
		R = Math.sqrt(xp * xp + yp * yp);
		if (R > GEXT) continue;
		w *= Math.min(1, (GEXT - R) / 0.7);
		xt = xp * cps + yp * sps; yp = -xp * sps + yp * cps; xp = xt;
		gx = (xp + GEXT) * GSCALE | 0;
		if (gx < 0 || gx >= GN) continue;
		gy = (yp + GEXT) * GSCALE | 0;
		if (gy < 0 || gy >= GN) continue;
		gRaw[gy * GN + gx] += w;
	}
	var dec = Math.exp(-dt / GLOW_TAU), inj = 1 - dec;
	for (i = 0; i < GN * GN; i++) gAcc[i] = gAcc[i] * dec + gRaw[i] * inj;
}

function drawGlow(st, om, ag) {
	var i, x, y, e, v;
	var psi = om * st.t;
	blurBox(gAcc, gScr, gFine, 4);
	blurBox(gAcc, gScr, gWide, 12);
	for (i = 0; i < GN * GN; i++) {
		e = (gFine[i] - gWide[i]) * 4;
		e = e > 0 ? e / (e + GLOW_K) : 0;
		gFine[i] = 0.82 * e + 0.22 * gWide[i] / (gWide[i] + 1);
		gArmE[i] = e;
	}
	blurBox(gFine, gScr, gWide, 2);
	blurBox(gArmE, gScr, gArmF, 2);
	var tmp = gVal; gVal = gWide; gWide = tmp;
	var cbg = Math.cos(ag - psi), sbg = Math.sin(ag - psi);
	for (y = 0; y < H; y++) {
		var wy = (y - CY) / (SCZ * ct);
		for (x = 0; x < W; x++) {
			var wx = (x - CX) / SCZ;
			var rx = wx * cbg - wy * sbg, ry = wx * sbg + wy * cbg;
			if (rx * rx + ry * ry > GEXT * GEXT) continue;
			var fx = (rx + GEXT) * GSCALE - 0.5, fy = (ry + GEXT) * GSCALE - 0.5;
			var x0 = Math.floor(fx), y0 = Math.floor(fy);
			var tx = fx - x0, ty = fy - y0;
			var xa = Math.max(0, Math.min(GN - 1, x0)), xb = Math.max(0, Math.min(GN - 1, x0 + 1));
			var ya = Math.max(0, Math.min(GN - 1, y0)), yb = Math.max(0, Math.min(GN - 1, y0 + 1));
			var va = gVal[ya * GN + xa] * (1 - tx) + gVal[ya * GN + xb] * tx;
			var vb2 = gVal[yb * GN + xa] * (1 - tx) + gVal[yb * GN + xb] * tx;
			v = (va * (1 - ty) + vb2 * ty) * 0.85;
			if (v < 0.004) continue;
			var ea = gArmF[ya * GN + xa] * (1 - tx) + gArmF[ya * GN + xb] * tx;
			var eb = gArmF[yb * GN + xa] * (1 - tx) + gArmF[yb * GN + xb] * tx;
			var tA = (ea * (1 - ty) + eb * ty) * ARM_T;
			if (tA > ARM_T) tA = ARM_T;
			/* bilinear base color from the static radial LUT + blue arm tint */
			var cr = gLutR[ya * GN + xa] * (1 - tx) + gLutR[ya * GN + xb] * tx;
			var cg = gLutG[ya * GN + xa] * (1 - tx) + gLutG[ya * GN + xb] * tx;
			var cbv = gLutB[ya * GN + xa] * (1 - tx) + gLutB[ya * GN + xb] * tx;
			var cr2 = gLutR[yb * GN + xa] * (1 - tx) + gLutR[yb * GN + xb] * tx;
			var cg2 = gLutG[yb * GN + xa] * (1 - tx) + gLutG[yb * GN + xb] * tx;
			var cbv2 = gLutB[yb * GN + xa] * (1 - tx) + gLutB[yb * GN + xb] * tx;
			var br = (cr * (1 - ty) + cr2 * ty), bg = (cg * (1 - ty) + cg2 * ty), bb = (cbv * (1 - ty) + cbv2 * ty);
			addPx(x, y,
				(br + (ARM_R - br) * tA) / 255,
				(bg + (ARM_G - bg) * tA) / 255,
				(bb + (ARM_B - bb) * tA) / 255,
				v);
		}
	}
}

function drawStars(st) {
	var i, x, y, c, col, dep, size, ga, u, half, px, py, dx, dy, fall;
	for (i = 0; i < st.n; i++) {
		c = st.cls[i];
		col = COL[c];
		x = st.x[i]; y = st.y[i];
		var xr = x, yr = y;
		dep = 1 - 0.25 * Math.min(Math.abs(st.z[i]) / 3, 1);
		var sx = CX + SCZ * xr, sy = CY + SCZ * (yr * ct);
		size = CLS_S[c] * (0.7 + 0.3 * dep);
		ga = dep * CLS_A[c];
		half = Math.ceil(size / 2);
		px = Math.round(sx); py = Math.round(sy);
		for (dy = -half; dy <= half; dy++) for (dx = -half; dx <= half; dx++) {
			u = Math.sqrt(dx * dx + dy * dy) / (size / 2);
			if (u > 1) continue;
			fall = (1 - u) * (1 - u);
			var mix = u < 0.18 ? 1 - u / 0.18 : 0;
			addPx(px + dx, py + dy,
				(col[0] * (1 - mix) + 255 * mix) / 255,
				(col[1] * (1 - mix) + 255 * mix) / 255,
				(col[2] * (1 - mix) + 255 * mix) / 255,
				fall * ga);
		}
	}
}

/* PNG encode: RGB8, filter 0, zlib deflate. */
var CRC_T = (function() {
	var t = new Int32Array(256), c, n, k;
	for (n = 0; n < 256; n++) {
		c = n;
		for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
function crc32(buf) {
	var c = -1, i;
	for (i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function chunk(type, data) {
	var len = Buffer.alloc(4), out;
	len.writeUInt32BE(data.length);
	out = Buffer.concat([len, Buffer.from(type, 'ascii'), data]);
	var crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(out.slice(4)));
	return Buffer.concat([out, crc]);
}
function writePng(file, w, h, rgb) {
	var raw = Buffer.alloc(h * (1 + w * 3)), i, j;
	for (i = 0; i < h; i++) {
		raw[i * (1 + w * 3)] = 0;
		for (j = 0; j < w * 3; j++) {
			var v = fb[(i * w * 3) + j];
			v = v / (v + 0.35);                      /* soft-clip tone map */
			raw[i * (1 + w * 3) + 1 + j] = Math.max(0, Math.min(255, Math.round(v * 255)));
		}
	}
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	var png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, png);
	console.log('wrote ' + file);
}

function snapshot(st, om, tag) {
	clearFb();
	coreGlow();
	drawGlow(st, om, 0);
	drawStars(st);
	writePng(path.join(__dirname, 'logs', 'render-' + label + '-' + tag + '.png'), W, H, null);
}

var label = name + (process.env.SPLIT !== undefined ? '-s' + process.env.SPLIT : '') +
	(process.env.PHASE !== undefined ? '-p' + process.env.PHASE : '');

var omGlow = P.spiral.om;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, false, true);
var k;
for (k = 0; k < Math.round(P.tsettle / DT); k++) accumulateGlow(st, omGlow, DT);
snapshot(st, omGlow, 'settle');
var mid = Math.round(75 / DT), end = Math.round(150 / DT);
for (k = 0; k < mid; k++) {
	Galaxy.step(st, P, DT, false, true);
	accumulateGlow(st, omGlow, DT);
}
snapshot(st, omGlow, '75tu');
for (k = mid; k < end; k++) {
	Galaxy.step(st, P, DT, false, true);
	accumulateGlow(st, omGlow, DT);
}
snapshot(st, omGlow, '150tu');
L.pass('render-png ' + name + ' done');
