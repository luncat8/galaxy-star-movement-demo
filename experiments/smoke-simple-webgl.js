'use strict';
/* Headless smoke run of simple/simple-friction-field-webGL.html with a stub
 * WebGL2 context + DOM. Catches syntax errors, uniforms the shaders never
 * declare, and gates the 0.6.0 HDR path:
 *   - the page must take a webgl2 context and a float color buffer;
 *   - exposure/saturation sliders must reach the present pass;
 *   - trails must switch the bg pass to the float fade mode;
 *   - the slow-field fan and the arm tint still toggle correctly.
 *
 *   node experiments/smoke-simple-webgl.js          # gate
 *   node experiments/smoke-simple-webgl.js --png    # + full-pipeline preview
 *   node experiments/smoke-simple-webgl.js --stats  # + scene-luma table
 *
 * --png replays the shipped shader maths (bg + bulge + disk sprites,
 * additive, then the present pass) on the captured frame state into
 * experiments/logs/hdr-simple-*.png: browserless eyeball of the HDR grade
 * (finding 26).
 */
var fs = require('fs'), path = require('path'), zlib = require('zlib'), L = require('./lib.js');

var WANT_PNG = process.argv.indexOf('--png') >= 0;
var WANT_STATS = process.argv.indexOf('--stats') >= 0;
var PAGE = __dirname + '/../simple/simple-friction-field-webGL.html';

function decls(src, kw) {
	var out = [], re = new RegExp('^\\s*' + kw + '\\s+\\w+\\s+([^;=]+);', 'gm'), m;
	while ((m = re.exec(src))) {
		m[1].split(',').forEach(function(n) {
			n = n.trim().replace(/\[.*\]$/, '');
			if (n && out.indexOf(n) < 0) out.push(n);
		});
	}
	return out;
}
var log = {
	missing: [], ext: [], ctxs: [], draws: 0, fieldInst: 0,
	bg: null, present: null, disk: null, bulge: null
};
function fakeGL() {
	var consts = {}, locId = 0, locName = {}, bound = {}, boundTex = null, curVao = null, curProg = null;
	['ARRAY_BUFFER', 'TEXTURE_2D', 'FRAMEBUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'POINTS',
	 'BLEND', 'TRIANGLE_STRIP', 'TEXTURE0', 'RGBA', 'ONE', 'NEAREST', 'LINEAR', 'CLAMP_TO_EDGE',
	 'FLOAT', 'HALF_FLOAT', 'RGBA16F', 'COLOR_ATTACHMENT0', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER',
	 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER',
	 'FRAGMENT_SHADER', 'ACTIVE_UNIFORMS', 'ACTIVE_ATTRIBUTES'
	].forEach(function(k, i) { consts[k] = 0x1000 + i; });
	function snap(p) {
		var o = {};
		for (var k in p.state) o[k] = p.state[k];
		return o;
	}
	function capture() {
		if (!curProg) return;
		if (curProg.bg) log.bg = { u: snap(curProg) };
		if (curProg.present) log.present = { u: snap(curProg) };
		if (curProg.disk) log.disk = { u: snap(curProg), theta: curVao.attrs[0].buf.data,
			aA: curVao.attrs[1].buf.data, aB: curVao.attrs[2].buf.data };
		if (curProg.bulge) log.bulge = { u: snap(curProg), theta: curVao.attrs[0].buf.data,
			aA: curVao.attrs[1].buf.data, aB: curVao.attrs[2].buf.data };
	}
	return Object.assign({}, consts, {
		getExtension: function(n) { log.ext.push(n); return /float/i.test(n) ? {} : null; },
		createShader: function() { return { src: '' }; },
		shaderSource: function(s, src) { s.src = src; },
		compileShader: function() {}, getShaderParameter: function() { return true; },
		getShaderInfoLog: function() { return ''; }, deleteShader: function() {},
		createProgram: function() { return { state: {}, uniforms: [], attribs: [] }; },
		attachShader: function(p, s) { p.src = (p.src || '') + s.src; },
		bindAttribLocation: function() {},
		linkProgram: function(p) {
			p.uniforms = decls(p.src, 'uniform');
			p.attribs = decls(p.src, 'attribute');
			p.bg = p.uniforms.indexOf('uMode') >= 0;
			p.present = p.uniforms.indexOf('uExposure') >= 0;
			p.disk = p.uniforms.indexOf('uArmTint') >= 0;
			p.bulge = p.uniforms.indexOf('uEccMax') >= 0 && !p.disk;
			p.field = p.uniforms.indexOf('uR0') >= 0;
		},
		getProgramParameter: function(p, what) {
			if (what === consts.ACTIVE_UNIFORMS) return p.uniforms.length;
			if (what === consts.ACTIVE_ATTRIBUTES) return p.attribs.length;
			return true;
		},
		getProgramInfoLog: function() { return ''; },
		getActiveUniform: function(p, i) { return { name: p.uniforms[i] }; },
		getActiveAttrib: function(p, i) { return { name: p.attribs[i] }; },
		getUniformLocation: function(p, name) {
			var base = name.replace(/\[0\]$/, '');
			if (p.uniforms.indexOf(base) < 0) { log.missing.push(name); return null; }
			locName[++locId] = name;
			return locId;
		},
		getAttribLocation: function(p, name) { return p.attribs.indexOf(name); },
		useProgram: function(p) { curProg = p; },
		uniform1f: function(l, v) { if (curProg) curProg.state[locName[l]] = v; },
		uniform1i: function(l, v) { if (curProg) curProg.state[locName[l]] = v; },
		uniform2f: function(l, a, b) { if (curProg) curProg.state[locName[l]] = [a, b]; },
		drawArrays: function(mode, first, count) {
			log.draws++;
			capture();
		},
		drawArraysInstanced: function(mode, first, count, instCount) {
			log.draws++;
			if (curProg && curProg.field) log.fieldInst += instCount;
		},
		createBuffer: function() { return { data: null }; },
		bindBuffer: function(t, b) { bound[t] = b; },
		bufferData: function(t, data) { if (bound[t]) bound[t].data = data; },
		bufferSubData: function(t, off, data) { if (bound[t]) bound[t].data = data; },
		createVertexArray: function() { return { attrs: {} }; },
		bindVertexArray: function(v) { curVao = v; },
		enableVertexAttribArray: function() {}, disableVertexAttribArray: function() {},
		vertexAttribPointer: function(loc, size, type, norm, stride, offs) {
			if (curVao) curVao.attrs[loc] = { buf: bound[consts.ARRAY_BUFFER] };
		},
		vertexAttribDivisor: function() {},
		createTexture: function() { return { data: null }; },
		bindTexture: function(t, x) { boundTex = x; },
		texImage2D: function() {}, texParameteri: function() {},
		createFramebuffer: function() { return {}; }, bindFramebuffer: function() {},
		framebufferTexture2D: function() {}, deleteTexture: function() {}, deleteFramebuffer: function() {},
		viewport: function() {}, enable: function() {}, disable: function() {},
		blendFunc: function() {}, activeTexture: function() {}
	});
}
var gl = fakeGL();

function stubEl(id) {
	var handlers = {};
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '', hidden: false,
		style: {}, dataset: {}, width: 300, height: 150,
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
		addEventListener: function(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
		fire: function(k) { (handlers[k] || []).forEach(function(fn) { fn({}); }); },
		setPointerCapture: function() {}, releasePointerCapture: function() {},
		getContext: function(name) { log.ctxs.push(name); return gl; },
		getBoundingClientRect: function() { return { width: 800, height: 600 }; },
		querySelectorAll: function() { return []; }
	};
}
var els = {}, rafCb = null, now = 0;
global.document = {
	getElementById: function(id) { return (els[id] = els[id] || stubEl(id)); },
	addEventListener: function() {}
};
global.window = global;
global.devicePixelRatio = 1;
global.innerWidth = 900;
global.innerHeight = 700;
global.addEventListener = function() {};
global.requestAnimationFrame = function(cb) { rafCb = cb; return 1; };
global.performance = { now: function() { return now; } };

var html = fs.readFileSync(PAGE, 'utf8');
var scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!scripts.length) L.fail('no inline script found');
try {
	eval(scripts[scripts.length - 1].replace(/<\/?script>/g, ''));
} catch (e) {
	L.fail('inline script threw at init: ' + (e && e.stack || e));
}
if (log.missing.length) L.fail('uniform used but not declared in its shader: ' + log.missing.join(', '));
if (log.ctxs.indexOf('webgl2') < 0) L.fail('expected a webgl2 context request, got ' + log.ctxs.join(', '));
if (!/EXT_color_buffer_(half_)?float/.test(log.ext.join(' ')))
	L.fail('page did not request a float color buffer extension: ' + log.ext.join(' '));

function frame() {
	now += 16.7;
	var cb = rafCb;
	rafCb = null;
	if (!cb) L.fail('rAF chain broke');
	cb(now);
}
function sample() {
	log.draws = 0;
	log.fieldInst = 0;
	frame();
}

/* let the density jam form: 500 frames at the 50 ms clamp */
for (var i = 0; i < 500; i++) { now += 50; frame(); }
sample();
if (log.draws < 3) L.fail('frame drew only ' + log.draws + ' times, want bg+bulge+disk+present');
if (!log.disk || !log.bulge || !log.bg || !log.present)
	L.fail('missing captures: ' + ['disk', 'bulge', 'bg', 'present'].filter(function(k) { return !log[k]; }).join(', '));

/* ---- HDR gates ---- */
try {
	var GAIN = 1.5;   /* the page's SCENE_GAIN calibration */
	els['exposure'].value = '1.5';
	els['exposure'].fire('input');
	sample();
	if (Math.abs(log.present.u.uExposure - GAIN * Math.pow(2, 1.5)) > 1e-4)
		L.fail('exposure slider did not reach the present pass: ' + log.present.u.uExposure);
	els['exposure'].value = '-1';
	els['exposure'].fire('input');
	sample();
	if (Math.abs(log.present.u.uExposure - GAIN * 0.5) > 1e-6)
		L.fail('exposure -1 EV must halve radiance, got ' + log.present.u.uExposure);
	els['exposure'].value = '0';
	els['exposure'].fire('input');

	els['sat'].value = '1.5';
	els['sat'].fire('input');
	sample();
	if (Math.abs(log.present.u.uSaturation - 1.5) > 1e-6)
		L.fail('saturation slider did not reach the present pass: ' + log.present.u.uSaturation);
	els['sat'].value = '1';
	els['sat'].fire('input');

	/* trails: float fade mode on/off */
	els['btn-trails'].fire('click');
	sample();
	if (log.bg.u.uMode !== 1) L.fail('trails on: bg uMode ' + log.bg.u.uMode + ', want 1');
	els['btn-trails'].fire('click');
	sample();
	if (log.bg.u.uMode !== 0) L.fail('trails off: bg uMode ' + log.bg.u.uMode + ', want 0');

	/* slow-field fan: 7 arcs x 2 arms when on, 0 when off */
	sample();
	if (log.fieldInst !== 0) L.fail('field hidden but drew ' + log.fieldInst + ' instances');
	els['btn-field'].fire('click');
	sample();
	if (log.fieldInst !== 14) L.fail('field on: ' + log.fieldInst + ' instances, want 7x2');
	els['btn-field'].fire('click');
	sample();

	/* arm tint: the disk shader's uArmTint flips with the button */
	sample();
	if (log.disk.u.uArmTint !== 1) L.fail('Arm Tint ships on, uArmTint=' + log.disk.u.uArmTint);
	els['btn-tint'].fire('click');
	sample();
	if (log.disk.u.uArmTint !== 0) L.fail('Arm Tint off, uArmTint=' + log.disk.u.uArmTint);
	els['btn-tint'].fire('click');
	sample();
	if (log.disk.u.uArmTint !== 1) L.fail('Arm Tint back on, uArmTint=' + log.disk.u.uArmTint);
} catch (e) {
	L.fail('HDR gate threw: ' + (e && e.stack || e));
}

/* ---- replay of the shipped shaders for one captured frame ---- */
var SC = 900, SH = 700;   /* device px: innerWidth/innerHeight at dpr 1 */
var replayFb = new Float32Array(SC * SH * 3);
function aces(x) {
	var v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
	return v < 0 ? 0 : v > 1 ? 1 : v;
}
function srgb(v) {
	return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
function replayScene() {
	var fb = replayFb, i, x, y, o;
	fb.fill(0);
	var bg = log.bg.u;
	/* FS_BG mode 0: dark base gradient + warm core glow */
	for (y = 0; y < SH; y++) for (x = 0; x < SC; x++) {
		o = (y * SC + x) * 3;
		var dx = x - SC / 2, dy = y - SH / 2;
		var d1 = Math.sqrt(dx * dx + dy * dy) / Math.max(SC, SH);
		d1 = d1 < 0 ? 0 : d1 > 1 ? 1 : d1;
		var r = 0.03922 + (0.00784 - 0.03922) * d1;
		var g = 0.01961 + (0.00392 - 0.01961) * d1;
		var b = 0.07059 + (0.03137 - 0.07059) * d1;
		var d2 = Math.sqrt(dx * dx + dy * dy) / bg.uGlowR;
		var gcol, ga;
		if (d2 < 0.3) {
			var t = d2 / 0.3;
			gcol = [1.0,
				0.86275 + (0.58824 - 0.86275) * t,
				0.58824 + (0.39216 - 0.58824) * t];
			ga = 0.5 + (0.15 - 0.5) * t;
		} else if (d2 < 1.0) {
			var t2 = (d2 - 0.3) / 0.7;
			gcol = [1.0,
				0.58824 + (0.39216 - 0.58824) * t2,
				0.39216 + (0.19608 - 0.39216) * t2];
			ga = 0.15 * (1.0 - t2);
		} else { gcol = [0, 0, 0]; ga = 0; }
		fb[o] = gcol[0] * ga + r * (1 - ga);
		fb[o + 1] = gcol[1] * ga + g * (1 - ga);
		fb[o + 2] = gcol[2] * ga + b * (1 - ga);
	}
	/* VS_BULGE + FS_POINT */
	var bu = log.bulge.u, bth = log.bulge.theta, baA = log.bulge.aA, baB = log.bulge.aB;
	var NB = bu.uPointSize * 1;   /* pointSize in device px (DPR=1) */
	for (i = 0; i < 4000; i++) {
		var th = bth[i];
		var rho = baA[i * 5] * (1 + bu.uEccMax * baA[i * 5 + 1] * Math.cos(th - baA[i * 5 + 2]));
		var x0 = rho * Math.cos(th), y0 = rho * Math.sin(th);
		var cO = Math.cos(baA[i * 5 + 3]), sO = Math.sin(baA[i * 5 + 3]);
		var x1 = x0 * cO - y0 * sO, y1 = x0 * sO + y0 * cO;
		var cI = Math.cos(baB[i * 5]), sI = Math.sin(baB[i * 5]);
		var px = x1, py = y1 * cI, pz = y1 * sI;
		var rx = px * bu.uCosR - py * bu.uSinR, ry = px * bu.uSinR + py * bu.uCosR;
		var pjy = ry * bu.uCosT - pz * bu.uSinT, pjz = ry * bu.uSinT + pz * bu.uCosT;
		var ps = bu.uCamDist / (bu.uCamDist + pjz);
		var sx = SC / 2 + rx * bu.uScale * ps, sy = SH / 2 - pjy * bu.uScale * ps;
		var rad = NB / 2;
		var xa = Math.max(0, Math.floor(sx - rad)), xb = Math.min(SC - 1, Math.ceil(sx + rad));
		var ya = Math.max(0, Math.floor(sy - rad)), yb = Math.min(SH - 1, Math.ceil(sy + rad));
		var ca = 0.8 * ps;
		for (y = ya; y <= yb; y++) for (x = xa; x <= xb; x++) {
			var nx = (2 * (x - (sx - rad))) / NB - 1, ny = (2 * (y - (sy - rad))) / NB - 1;
			var rr = Math.sqrt(nx * nx + ny * ny);
			if (rr > 1) continue;
			var a = rr < 0.5 ? 1 - 0.6 * rr * 2 : 0.4 * (1 - (rr * 2 - 1));
			o = (y * SC + x) * 3;
			fb[o] += 1.0 * a * ca;
			fb[o + 1] += 0.78431 * a * ca;
			fb[o + 2] += 0.39216 * a * ca;
		}
	}
	/* VS_DISK + FS_POINT (arm tint on: pink inside the field) */
	var du = log.disk.u, dth2 = log.disk.theta, daA = log.disk.aA, daB = log.disk.aB;
	var ND = du.uPointSize * 1;
	for (i = 0; i < 15000; i++) {
		var th2 = dth2[i];
		var rho2 = daA[i * 6] * (1 + du.uEccMax * daA[i * 6 + 1] * Math.cos(th2 - daA[i * 6 + 2]));
		var px2 = rho2 * Math.cos(th2), py2 = rho2 * Math.sin(th2);
		var pz2 = daA[i * 6 + 4] * Math.sin(2 * th2 + daA[i * 6 + 5]);
		var rx2 = px2 * du.uCosR - py2 * du.uSinR, ry2 = px2 * du.uSinR + py2 * du.uCosR;
		var pjy2 = ry2 * du.uCosT - pz2 * du.uSinT, pjz2 = ry2 * du.uSinT + pz2 * du.uCosT;
		var ps2 = du.uCamDist / (du.uCamDist + pjz2);
		var sx2 = SC / 2 + rx2 * du.uScale * ps2, sy2 = SH / 2 - pjy2 * du.uScale * ps2;
		var rad2 = ND / 2;
		var xa2 = Math.max(0, Math.floor(sx2 - rad2)), xb2 = Math.min(SC - 1, Math.ceil(sx2 + rad2));
		var ya2 = Math.max(0, Math.floor(sy2 - rad2)), yb2 = Math.min(SH - 1, Math.ceil(sy2 + rad2));
		var dth = th2 - (Math.log(rho2) / du.uTanPitch + du.uPatternPhase);
		dth = ((dth % du.uArmOffset) + du.uArmOffset) % du.uArmOffset;
		if (dth > du.uArmOffset * 0.5) dth -= du.uArmOffset;
		var D = Math.exp(-dth * dth * du.uInv2Sig2);
		var b2 = daA[i * 6 + 3] * (0.4 + ps2 * 0.6);
		var inArm = D > 0.4 ? 1 : 0, tint = du.uArmTint;
		var aTint = inArm ? D * b2 : (1 - D) * b2 * 0.8;
		var cr3 = 0.70588 + (1.0 - 0.70588) * inArm * tint;
		var cg3 = 0.82353 + (0.54902 - 0.82353) * inArm * tint;
		var cb3 = 1.0 + (0.78431 - 1.0) * inArm * tint;
		var ca2 = b2 * 0.8 + (aTint - b2 * 0.8) * tint;
		for (y = ya2; y <= yb2; y++) for (x = xa2; x <= xb2; x++) {
			var nx2 = (2 * (x - (sx2 - rad2))) / ND - 1, ny2 = (2 * (y - (sy2 - rad2))) / ND - 1;
			var rr2 = Math.sqrt(nx2 * nx2 + ny2 * ny2);
			if (rr2 > 1) continue;
			var a2 = rr2 < 0.5 ? 1 - 0.6 * rr2 * 2 : 0.4 * (1 - (rr2 * 2 - 1));
			o = (y * SC + x) * 3;
			fb[o] += cr3 * a2 * ca2;
			fb[o + 1] += cg3 * a2 * ca2;
			fb[o + 2] += cb3 * a2 * ca2;
		}
	}
	return fb;
}
function presentFrame(ev, raw, stride) {
	var fb = replayFb, y, x, o, p = 0;
	var exp = 1.5 * Math.pow(2, ev), sat = 1;   /* SCENE_GAIN baked in, like the page */
	for (y = 0; y < SH; y++) {
		raw[p++] = 0;
		for (x = 0; x < SC; x++) {
			o = (y * SC + x) * 3;
			var cr3 = fb[o] * exp, cg3 = fb[o + 1] * exp, cb3 = fb[o + 2] * exp;
			var l = cr3 * 0.2126 + cg3 * 0.7152 + cb3 * 0.0722;
			raw[p++] = Math.round(255 * srgb(aces(l + (cr3 - l) * sat)));
			raw[p++] = Math.round(255 * srgb(aces(l + (cg3 - l) * sat)));
			raw[p++] = Math.round(255 * srgb(aces(l + (cb3 - l) * sat)));
		}
	}
}
function writePng(file, raw, w, h, stride) {
	function crc32(b) {
		var table = [], n, k2, cc;
		for (n = 0; n < 256; n++) {
			cc = n;
			for (k2 = 0; k2 < 8; k2++) cc = cc & 1 ? 0xEDB88320 ^ (cc >>> 1) : cc >>> 1;
			table[n] = cc >>> 0;
		}
		var crc = 0xFFFFFFFF;
		for (n = 0; n < b.length; n++) crc = table[(crc ^ b[n]) & 0xFF] ^ (crc >>> 8);
		return (crc ^ 0xFFFFFFFF) >>> 0;
	}
	function chunk(type, data) {
		var len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]), cb = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		cb.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, cb]);
	}
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
	console.log('wrote ' + path.relative(process.cwd(), file));
}
if (WANT_PNG) {
	replayScene();
	var stride = SC * 3 + 1, raw = Buffer.alloc(SH * stride);
	presentFrame(0, raw, stride);
	writePng(path.join(__dirname, 'logs', 'hdr-simple-default.png'), raw, SC, SH, stride);
}
if (WANT_STATS) {
	var fb = replayScene(), y, x, o;
	var core = [], arms = [], maxAll = 0;
	for (y = 0; y < SH; y++) for (x = 0; x < SC; x++) {
		o = (y * SC + x) * 3;
		var rp = Math.sqrt((x - 450) * (x - 450) + (y - 350) * (y - 350));
		var lm = fb[o] * 0.2126 + fb[o + 1] * 0.7152 + fb[o + 2] * 0.0722;
		if (lm > maxAll) maxAll = lm;
		if (rp < 40) core.push(lm);
		else if (rp > 120 && rp < 300) arms.push(lm);
	}
	function quant(arr, q) {
		var s = arr.slice().sort(function (a, b) { return a - b; });
		return s[Math.min(s.length - 1, Math.floor(s.length * q))];
	}
	console.log('scene luma (EV 0, gain 1.5): core med', (quant(core, 0.5) * 1.5).toFixed(3),
		'p99', (quant(core, 0.99) * 1.5).toFixed(2),
		'| arm annulus med', (quant(arms, 0.5) * 1.5).toFixed(4), 'p90', (quant(arms, 0.9) * 1.5).toFixed(3),
		'p99', (quant(arms, 0.99) * 1.5).toFixed(3), 'max', (maxAll * 1.5).toFixed(2));
	for (var evs = 1; evs >= -3; evs -= 0.5) {
		var e = 1.5 * Math.pow(2, evs);
		console.log('EV ' + evs.toFixed(1) + ': core med->' + (aces(quant(core, 0.5) * e) * 255).toFixed(0) +
			' p99->' + (aces(quant(core, 0.99) * e) * 255).toFixed(0) +
			' | arm med->' + (aces(quant(arms, 0.5) * e) * 255).toFixed(1) +
			' p90->' + (aces(quant(arms, 0.9) * e) * 255).toFixed(0) +
			' p99->' + (aces(quant(arms, 0.99) * e) * 255).toFixed(0));
	}
}

L.pass('smoke-simple-webgl: page runs, float HDR present pass, sliders, field/tint toggles');
