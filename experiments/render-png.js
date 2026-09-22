/* Headless PNG render of a run, replicating the page render path (sprites,
 * additive blend, tilt projection) including the glow underlay. Node+zlib.
 * Usage: node render-png.js legacy|calm   -> experiments/logs/render-<name>-<t>tu.png */
'use strict';
var zlib = require('zlib'), fs = require('fs'), path = require('path');
var Galaxy = require('../galaxy.js');
var L = require('./lib.js');

var W = 560, H = 560, CX = W / 2, CY = H / 2, SCZ = (Math.min(W, H) / 2 - 24) / 6.5;
var TILT = 20 * Math.PI / 180;
var N = 10000, DT = 0.01;
var COL = [[255, 244, 224], [255, 207, 158], [255, 154, 102], [143, 168, 216], [84, 246, 255], [127, 184, 255]];
var CLS_A = [0.85, 0.32, 0.35, 0.16, 0.9, 1.0];
var CLS_S = [7, 6, 6, 5, 7, 8];

var name = process.argv[2] || 'calm';
var P = Galaxy.defaultParams();
if (name === 'calm') {
	P.spiral.om = 0.30; P.spiral.as = 0.06;
} else if (name !== 'legacy') {
	console.error('variant must be legacy or calm');
	process.exit(1);
}
var barOn = name === 'legacy';

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
		var a = d < 0.3 ? 0.30 * (1 - d / 0.3 * 0.73) : 0.08 * (1 - d);
		addPx(CX + x | 0, CY + y | 0, 255 / 255, 190 / 255, 130 / 255, a * 0.55);
	}
}

/* Glow underlay: same algorithm as the page (bin in pattern frame -> decay
 * accumulate -> DoG -> soft clip). */
var GN = 96, GEXT = 6.8, GSCALE = GN / (2 * GEXT), GLOW_K = 0.8, GLOW_TAU = 2;
var gRaw = new Float32Array(GN * GN), gScr = new Float32Array(GN * GN);
var gFine = new Float32Array(GN * GN), gWide = new Float32Array(GN * GN);

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

/* Glow cell values (soft-clipped DoG excess), then bilinear sample onto fb.
 * Bins accumulate in the PATTERN FRAME with decay: noise averages out, the
 * rotating wave pattern stays sharp. */
var GN = 96, GEXT = 6.8, GSCALE = GN / (2 * GEXT), GLOW_K = 0.8, GLOW_TAU = 2;
var gRaw = new Float32Array(GN * GN), gScr = new Float32Array(GN * GN);
var gFine = new Float32Array(GN * GN), gWide = new Float32Array(GN * GN);
var gAcc = new Float32Array(GN * GN), gVal = new Float32Array(GN * GN);

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
		gVal[i] = 0.82 * e + 0.22 * gWide[i] / (gWide[i] + 1);
	}
	blurBox(gVal, gScr, gFine, 2);
	var tmp = gVal; gVal = gFine; gFine = tmp;
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
			v = (gVal[ya * GN + xa] * (1 - tx) + gVal[ya * GN + xb] * tx) * (1 - ty) +
				(gVal[yb * GN + xa] * (1 - tx) + gVal[yb * GN + xb] * tx) * ty;
			v *= 0.85;
			if (v < 0.004) continue;
			addPx(x, y, 170 / 255, 200 / 255, 1, v);
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
	writePng(path.join(__dirname, 'logs', 'render-' + name + '-' + tag + '.png'), W, H, null);
}

var omGlow = name === 'legacy' ? P.bar.om : P.spiral.om;
var st = Galaxy.createState(N);
st.n = N;
Galaxy.initStars(st, P, P.seed);
Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, barOn, true);
var k;
for (k = 0; k < Math.round(P.tsettle / DT); k++) accumulateGlow(st, omGlow, DT);
snapshot(st, omGlow, 'settle');
var mid = Math.round(75 / DT), end = Math.round(150 / DT);
for (k = 0; k < mid; k++) {
	Galaxy.step(st, P, DT, barOn, true);
	accumulateGlow(st, omGlow, DT);
}
snapshot(st, omGlow, '75tu');
for (k = mid; k < end; k++) {
	Galaxy.step(st, P, DT, barOn, true);
	accumulateGlow(st, omGlow, DT);
}
snapshot(st, omGlow, '150tu');
L.pass('render-png ' + name + ' done');
