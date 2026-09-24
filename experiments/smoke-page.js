'use strict';
/* Headless smoke run of index.html's inline script with DOM + WebGL2 stubs.
 * Catches syntax/reference errors, uniforms the shaders never declare,
 * exercises controls + settle + frames, and gates the 0.6.0 HDR path:
 *   - the page must take a webgl2 context and a float color buffer;
 *   - exposure/saturation sliders must reach the present pass (2^EV / 1:1);
 *   - trails must switch the bg pass to the float fade mode;
 *   - the star draw count must follow the stream toggle (compaction).
 *
 *   node experiments/smoke-page.js          # gate
 *   node experiments/smoke-page.js --png    # + full-pipeline preview renders
 *   node experiments/smoke-page.js --stats  # + scene-luma calibration table
 *
 * --png replays the SHIPPED shader maths (bg + glow texture + star sprites,
 * additive, then the present pass) on the captured frame state into
 * experiments/logs/hdr-index-*.png: browserless eyeball of the HDR grade
 * (finding 26). One render at the default exposure, one at -1.5 EV.
 */
var fs = require('fs'), path = require('path'), zlib = require('zlib'), L = require('./lib.js');
global.Galaxy = L.Galaxy;
global.SelfGrav = require('../selfgrav.js');

var WANT_PNG = process.argv.indexOf('--png') >= 0;

/* ---- WebGL2 stub that captures the per-program state the frame path sets ---- */
function decls(src, kw) {
	var out = [], re = new RegExp('^\\s*' + kw + '\\s+\\w+\\s+([^;=]+);', 'gm'), m;
	while ((m = re.exec(src))) {
		m[1].split(',').forEach(function(n) {
			n = n.trim().replace(/\[.*\]$/, '');   /* array suffix: GL names it [0] */
			if (n && out.indexOf(n) < 0) out.push(n);
		});
	}
	return out;
}
var log = {
	missing: [], ext: [], ctxs: [], draws: 0,
	star: null, glow: null, bg: null, present: null
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
		if (curProg.star)
			log.star = { n: log.drawCount, u: snap(curProg), buf: curVao.attrs[0].buf.data };
		if (curProg.bg) log.bg = { u: snap(curProg) };
		if (curProg.present) log.present = { u: snap(curProg) };
		if (curProg.glow) log.glow = { u: snap(curProg), tex: boundTex ? boundTex.data : null };
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
			p.star = p.attribs.indexOf('aPos') >= 0;
			p.bg = p.uniforms.indexOf('uMode') >= 0;
			p.present = p.uniforms.indexOf('uExposure') >= 0;
			p.glow = p.uniforms.indexOf('uCos') >= 0;
		},
		getProgramParameter: function(p, what) {
			if (what === consts.ACTIVE_UNIFORMS) return p.uniforms.length;
			if (what === consts.ACTIVE_ATTRIBUTES) return p.attribs.length;
			return true;
		},
		getProgramInfoLog: function() { return ''; },
		getActiveUniform: function(p, i) {
			var n = p.uniforms[i];
			/* GL reports array uniforms with a [0] suffix */
			return { name: /uCls|uSize/.test(n) ? n + '[0]' : n };
		},
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
		uniform1fv: function(l, arr) { if (curProg) curProg.state[locName[l]] = Float32Array.from(arr); },
		uniform4fv: function(l, arr) { if (curProg) curProg.state[locName[l]] = Float32Array.from(arr); },
		drawArrays: function(mode, first, count) {
			log.draws++;
			log.drawCount = count;
			capture();
		},
		createBuffer: function() { return { data: null }; },
		bindBuffer: function(t, b) { bound[t] = b; },
		bufferData: function(t, data) { if (bound[t]) bound[t].data = data; },
		bufferSubData: function(t, off, data) { if (bound[t]) bound[t].data = data; },
		createVertexArray: function() { return { attrs: {} }; },
		bindVertexArray: function(v) { curVao = v; },
		enableVertexAttribArray: function() {}, disableVertexAttribArray: function() {},
		vertexAttribPointer: function(loc) {
			if (curVao) curVao.attrs[loc] = { buf: bound[consts.ARRAY_BUFFER] };
		},
		createTexture: function() { return { data: null }; },
		bindTexture: function(t, x) { boundTex = x; },
		texImage2D: function(t, level, ifmt, w, h, border, fmt, type, data) {
			if (data && boundTex) boundTex.data = data;
		},
		texParameteri: function() {},
		createFramebuffer: function() { return {}; }, bindFramebuffer: function() {},
		framebufferTexture2D: function() {}, deleteTexture: function() {}, deleteFramebuffer: function() {},
		viewport: function() {}, enable: function() {}, disable: function() {},
		blendFunc: function() {}, activeTexture: function() {}, lineWidth: function() {}
	});
}
var gl = fakeGL();

function stubCtx() {
	var grad = { addColorStop: function() {} };
	return new Proxy({
		canvas: null,
		createRadialGradient: function() { return grad; },
		createImageData: function(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		getBoundingClientRect: undefined
	}, {
		get: function(t, k) {
			if (k in t) return t[k];
			if (k === 'setTransform') return function() {};
			return function() { return grad; };
		},
		set: function(t, k, v) { t[k] = v; return true; }
	});
}

function stubEl(id) {
	var handlers = {};
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '', hidden: false,
		style: {}, dataset: { n: '4000' },
		width: 300, height: 150,
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
		addEventListener: function(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
		fire: function(k) { (handlers[k] || []).forEach(function(fn) { fn({ target: els[id] }); }); },
		setPointerCapture: function() {}, releasePointerCapture: function() {},
		getContext: function(name) { log.ctxs.push(name); return name === 'webgl2' ? gl : stubCtx(); },
		getBoundingClientRect: function() { return { width: 800, height: 600 }; },
		querySelectorAll: function() { return []; },
		click: function() {}, blur: function() {}
	};
}

var els = {};
var SLIDER_VALUES = {
	's-speed': '0.03', 's-ab': '0.06', 's-as': '0.06', 's-ob': '0.36',
	's-os': '0.30', 's-eta': '0.05', 's-sig': '0.1', 's-tilt': '20', 's-gfb': '0',
	's-exp': '-0.7', 's-sat': '1'
};
global.document = {
	getElementById: function(id) {
		if (!els[id]) {
			els[id] = stubEl(id);
			if (SLIDER_VALUES[id]) els[id].value = SLIDER_VALUES[id];
		}
		return els[id];
	},
	createElement: function() { return stubEl('dyn'); },
	querySelectorAll: function() { return []; },
	body: stubEl('body')
};
var rafCb = null, simNow = 0;
global.window = global;
global.devicePixelRatio = 1;
global.requestAnimationFrame = function(cb) { rafCb = cb; return 1; };
global.performance = { now: function() { return simNow; } };
global.addEventListener = function() {};

var html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
var scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!scripts.length) L.fail('no inline script found');
var src = scripts[scripts.length - 1].replace(/<\/?script>/g, '');
if (src.indexOf('\ninit();\n})();') < 0) L.fail('page structure changed: init()/IIFE tail not found');
src = src.replace('\ninit();\n})();', '\ninit();\nglobal.__hooks = { P: P, st: st, ui: ui };\n})();');

var hooks = null;
try {
	eval(src);
	hooks = global.__hooks;
} catch (e) {
	L.fail('inline script threw at init: ' + (e && e.stack || e));
}
if (log.missing.length) L.fail('uniform used but not declared in its shader: ' + log.missing.join(', '));
if (log.ctxs.indexOf('webgl2') < 0) L.fail('expected a webgl2 context request, got ' + log.ctxs.join(', '));
if (!/EXT_color_buffer_(half_)?float/.test(log.ext.join(' ')))
	L.fail('page did not request a float color buffer extension: ' + log.ext.join(' '));

function frame() {
	simNow += 16.7;
	var cb = rafCb;
	rafCb = null;
	if (!cb) L.fail('rAF chain broke');
	cb(simNow);
}
function sample() {
	log.draws = 0;
	frame();
	return { draws: log.draws };
}

var frames = 0;
try {
	for (frames = 0; frames < 200; frames++) {
		simNow += 16.7;
		var cb = rafCb; rafCb = null;
		cb(simNow);
		if (!rafCb) L.fail('rAF chain broke at frame ' + frames);
	}
} catch (e) {
	L.fail('frame ' + frames + ' threw: ' + (e && e.stack || e));
}
console.log('ran ' + frames + ' headless frames incl. full settle, hud="' +
	(String(els.hud ? els.hud.textContent : '')).slice(0, 60) + '"');

/* ---- HDR gates: the sliders must reach the present pass, and the frame
 * path must talk to the float scene pass the way the shaders expect. ---- */
try {
	sample();
	if (!log.star) L.fail('no star (point) draw captured');
	if (log.star.n !== 4000) L.fail('star draw count ' + log.star.n + ' != ui.n 4000');
	if (!log.bg || !log.present) L.fail('bg/present passes not captured');
	if (log.bg.u.uMode !== 0) L.fail('bg pass not in background mode at boot');

	els['s-exp'].value = '1.5';
	els['s-exp'].fire('input');
	sample();
	if (Math.abs(log.present.u.uExposure - Math.pow(2, 1.5)) > 1e-4)
		L.fail('exposure slider did not reach the present pass: ' + log.present.u.uExposure);
	els['s-exp'].value = '-2';
	els['s-exp'].fire('input');
	sample();
	if (Math.abs(log.present.u.uExposure - 0.25) > 1e-6)
		L.fail('exposure -2 EV must scale radiance by 0.25, got ' + log.present.u.uExposure);
	els['s-exp'].value = '-0.7';
	els['s-exp'].fire('input');
	sample();
	if (Math.abs(log.present.u.uExposure - Math.pow(2, -0.7)) > 1e-4)
		L.fail('default exposure -0.7 EV not applied: ' + log.present.u.uExposure);

	els['s-sat'].value = '1.6';
	els['s-sat'].fire('input');
	sample();
	if (Math.abs(log.present.u.uSaturation - 1.6) > 1e-6)
		L.fail('saturation slider did not reach the present pass: ' + log.present.u.uSaturation);
	els['s-sat'].value = '1';
	els['s-sat'].fire('input');
	sample();

	/* stream toggle must compact the star draw (2% of 4000 = 80 stream stars) */
	els['c-stream'].checked = false;
	els['c-stream'].fire('change');
	sample();
	if (log.star.n !== 3920) L.fail('stream off: star count ' + log.star.n + ', want 3920');
	els['c-stream'].checked = true;
	els['c-stream'].fire('change');
	sample();
	if (log.star.n !== 4000) L.fail('stream back on: star count ' + log.star.n + ', want 4000');

	/* trails must switch the bg pass to the float fade mode */
	els['c-trails'].checked = true;
	els['c-trails'].fire('change');
	sample();
	if (log.bg.u.uMode !== 1) L.fail('trails on: bg uMode ' + log.bg.u.uMode + ', want 1');
	els['c-trails'].checked = false;
	els['c-trails'].fire('change');
	sample();
	if (log.bg.u.uMode !== 0) L.fail('trails off: bg uMode ' + log.bg.u.uMode + ', want 0');

	/* the star upload must carry the class channel last (shader reads it) */
	var clsArr = log.star.u;
	if (!clsArr || !clsArr['uCls[0]']) L.fail('star program missing the uCls[0] uniform');
	if (clsArr['uCls[0]'].length !== 24) L.fail('uCls must be 6 vec4, got ' + clsArr['uCls[0]'].length);
} catch (e) {
	L.fail('HDR gate threw: ' + (e && e.stack || e));
}

/* Solver select through the real UI path (unchanged 0.5.0 behaviour). */
try {
	if (hooks.P.live.freeze) L.fail('page booted with P.live.freeze set at solver off');
	els['sel-sg'].value = '1';
	els['sel-sg'].fire('change');
	if (hooks.P.live.gfb <= 0) L.fail('solver WKB left gfb at 0');
	if (hooks.P.live.freeze) L.fail('WKB solver must not set freeze');
	els['s-gfb'].value = '9';
	els['s-gfb'].fire('input');
	if (hooks.P.live.gfb !== 9) L.fail('gfb slider did not set gfb (' + hooks.P.live.gfb + ')');
	els['sel-sg'].value = '2';
	els['sel-sg'].fire('change');
	if (!hooks.P.live.freeze) L.fail('global solver did not set P.live.freeze');
	if (hooks.P.live.cap !== 0.10) L.fail('global solver cap is ' + hooks.P.live.cap + ', want 0.10');
	if (hooks.ui.sg !== 2) L.fail('ui.sg not 2 after select');
	for (var k = 0; k < 120; k++) {
		simNow += 16.7;
		var cb2 = rafCb; rafCb = null;
		cb2(simNow);
	}
	var lv = hooks.st.live, nz = 0;
	for (var bi = 0; bi < lv.nb; bi++) if (lv.amp[bi] > 0) nz++;
	if (!nz) L.fail('global solver armed but the feedback table stayed zero');
	if (!/sg:global/.test(String(els.hud.textContent)))
		L.fail('HUD does not report the solver: "' + els.hud.textContent + '"');
	console.log('global sg: gfb=' + hooks.P.live.gfb + ' gain=' + hooks.P.live.g.toFixed(2) +
		' freeze=' + hooks.P.live.freeze + ' bins with amplitude=' + nz + '/32, hud="' +
		els.hud.textContent.slice(0, 90) + '"');
	els['sel-sg'].value = '0';
	els['sel-sg'].fire('change');
	if (hooks.ui.sg !== 0) L.fail('select off did not clear ui.sg');
	for (var k2 = 0; k2 < 40; k2++) {
		simNow += 16.7;
		var cb3 = rafCb; rafCb = null;
		cb3(simNow);
	}
} catch (e) {
	L.fail('solver-select UI path threw: ' + (e && e.stack || e));
}

/* ---- optional preview: replay the shipped shader maths for one captured
 * frame (bg + glow texture + star sprites, additive, then the present pass)
 * and write PNGs: at the default -0.7 EV and at -2 EV (core structure must
 * survive there — the point of the float pipeline). ---- */
function sstep(a, b, x) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	return t * t * (3 - 2 * t);
}
function aces(x) {
	var v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
	return v < 0 ? 0 : v > 1 ? 1 : v;
}
function srgb(v) {
	return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
var RW = 800, RH = 600, replayFb = new Float32Array(RW * RH * 3);

/* Accumulate one captured frame into replayFb: bg + glow texture + star
 * sprites, additive — the shipped scene shaders replayed in node. */
function replayScene() {
	var W = RW, H = RH, fb = replayFb;
	fb.fill(0);
	var bg = log.bg.u, glow = log.glow, stars = log.star;
	var i, x, y, o;
	/* bg (FS_BG mode 0) */
	for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
		o = (y * W + x) * 3;
		var dx = x - W / 2, dy = y - H / 2;
		var d = Math.sqrt(dx * dx + dy * dy) / (Math.max(W, H) / 2);
		var r = 0.03922 + (0.01569 - 0.03922) * Math.min(1, d / 0.45);
		var g = 0.02353 + (0.01569 - 0.02353) * Math.min(1, d / 0.45);
		var b = 0.07843 + (0.03922 - 0.07843) * Math.min(1, d / 0.45);
		var t2 = Math.min(1, Math.max(0, (d - 0.45) / 0.55));
		r += (0.00392 - r) * t2; g += (0.00392 - g) * t2; b += (0.00784 - b) * t2;
		var t = Math.sqrt(dx * dx + dy * dy) / bg.uGlowR;
		var cc, ga;
		if (t < 0.32) {
			cc = [1.0,
				0.87059 + (0.62745 - 0.87059) * (t / 0.32),
				0.60784 + (0.37255 - 0.60784) * (t / 0.32)];
			ga = 0.36 + (0.10 - 0.36) * (t / 0.32);
		} else {
			cc = [1.0, 0.41176, 0.19608];
			ga = 0.10 * Math.max(0, 1 - (t - 0.32) / 0.68);
		}
		fb[o] = r * (1 - ga) + cc[0] * ga;
		fb[o + 1] = g * (1 - ga) + cc[1] * ga;
		fb[o + 2] = b * (1 - ga) + cc[2] * ga;
	}
	/* glow texture, bilinear over the pattern-frame quad (VS_GLOW/FS_GLOW) */
	if (glow && glow.tex) {
		var gu = glow.u, GEXT = 6.8, GT = glow.tex, GN = 96;
		var c = gu.uCos, s = gu.uSin, ct2 = gu.uCT;
		for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
			var xr = (x - gu.uHalfW) / gu.uScale;
			var yr = (y - gu.uHalfH) / (gu.uScale * ct2) * -1;
			var xp = xr * c - yr * s;
			var yp = xr * s + yr * c;
			var u = (xp + GEXT) / (2 * GEXT), v = (yp + GEXT) / (2 * GEXT);
			if (u < 0 || u > 1 || v < 0 || v > 1) continue;
			var fx = u * GN - 0.5, fy = v * GN - 0.5;
			var x0 = Math.floor(fx), y0 = Math.floor(fy);
			var tx = fx - x0, ty = fy - y0;
			var x1 = Math.min(GN - 1, x0 + 1), y1 = Math.min(GN - 1, y0 + 1);
			x0 = Math.max(0, x0); y0 = Math.max(0, y0);
			o = (y * W + x) * 3;
			for (i = 0; i < 3; i++) {
				var i00 = (y0 * GN + x0) * 4 + i, i10 = (y0 * GN + x1) * 4 + i;
				var i01 = (y1 * GN + x0) * 4 + i, i11 = (y1 * GN + x1) * 4 + i;
				fb[o + i] += (GT[i00] * (1 - tx) + GT[i10] * tx) * (1 - ty) +
					(GT[i01] * (1 - tx) + GT[i11] * tx) * ty;
			}
		}
	}
	/* stars (VS_STAR/FS_STAR), additive sprites */
	if (stars) {
		var su = stars.u, data = stars.buf, n = stars.n;
		var uCls = su['uCls[0]'], uSize = su['uSize[0]'];
		var scb = su.uC, ssb = su.uS, sct = su.uCT, sst = su.uST;
		var sScale = su.uScale, sHW = su.uHalfW, sHH = su.uHalfH, sPx = su.uPx;
		for (i = 0; i < n; i++) {
			var px = data[i * 4], py = data[i * 4 + 1], pz = data[i * 4 + 2];
			var ci = Math.round(data[i * 4 + 3]);
			var dep = 1 - 0.25 * Math.min(Math.abs(pz) / 3, 1);
			var xrv = px * scb + py * ssb;
			var yrv = -px * ssb + py * scb;
			var sx = sHW + sScale * xrv;
			var sy = sHH - sScale * (yrv * sct - pz * sst);
			var size = uSize[ci] * (0.7 + 0.3 * dep) * sPx;
			var rad = size / 2;
			var x0 = Math.max(0, Math.floor(sx - rad)), x1 = Math.min(W - 1, Math.ceil(sx + rad));
			var y0 = Math.max(0, Math.floor(sy - rad)), y1 = Math.min(H - 1, Math.ceil(sy + rad));
			var cr = uCls[ci * 4], cg = uCls[ci * 4 + 1], cb2 = uCls[ci * 4 + 2], ca = uCls[ci * 4 + 3] * dep;
			for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
				var nx = (2 * (x - (sx - rad))) / size - 1;
				var ny = (2 * (y - (sy - rad))) / size - 1;
				var r2 = nx * nx + ny * ny;
				if (r2 > 1) continue;
				var rr = Math.sqrt(r2);
				var w = 1 - sstep(0.25, 1, rr);
				var mixc = sstep(0, 0.25, rr);
				o = (y * W + x) * 3;
				fb[o]     += (1 + (cr - 1) * mixc) * w * ca;
				fb[o + 1] += (1 + (cg - 1) * mixc) * w * ca;
				fb[o + 2] += (1 + (cb2 - 1) * mixc) * w * ca;
			}
		}
	}
	return fb;
}

/* Present pass on the replayed scene: exposure (2^EV) -> saturation -> ACES
 * -> sRGB, into raw (stride incl. PNG filter bytes, one row per filter byte). */
function presentFrame(ev, raw, stride) {
	var W = RW, H = RH, fb = replayFb, y, x, o, p = 0;
	var exp = Math.pow(2, ev), sat = 1;
	for (y = 0; y < H; y++) {
		raw[p++] = 0;
		for (x = 0; x < W; x++) {
			o = (y * W + x) * 3;
			var cr3 = fb[o] * exp, cg3 = fb[o + 1] * exp, cb3 = fb[o + 2] * exp;
			var l = cr3 * 0.2126 + cg3 * 0.7152 + cb3 * 0.0722;
			raw[p++] = Math.round(255 * srgb(aces(l + (cr3 - l) * sat)));
			raw[p++] = Math.round(255 * srgb(aces(l + (cg3 - l) * sat)));
			raw[p++] = Math.round(255 * srgb(aces(l + (cb3 - l) * sat)));
		}
	}
}

function renderPng(label, evOverride) {
	var ev = evOverride, stride = RW * 3 + 1, raw = Buffer.alloc(RH * stride);
	presentFrame(ev, raw, stride);
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
	ihdr.writeUInt32BE(RW, 0); ihdr.writeUInt32BE(RH, 4); ihdr[8] = 8; ihdr[9] = 2;
	var file = path.join(__dirname, 'logs', 'hdr-index-' + label + '.png');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
	console.log('wrote ' + path.relative(process.cwd(), file) + ' (EV ' + ev + ', ' + log.star.n + ' stars)');
}
if (WANT_PNG) {
	replayScene();
	renderPng('default', -0.7);
	renderPng('core-detail', -2.0);
}
var WANT_STATS = process.argv.indexOf('--stats') >= 0;
if (WANT_STATS) {
	replayScene();
	var fb = replayFb, y, x, o;
	var core = [], disk = [], maxAll = 0;
	for (y = 0; y < RH; y++) for (x = 0; x < RW; x++) {
		o = (y * RW + x) * 3;
		var rp = Math.sqrt((x - 400) * (x - 400) + (y - 300) * (y - 300));
		var lm = fb[o] * 0.2126 + fb[o + 1] * 0.7152 + fb[o + 2] * 0.0722;
		if (lm > maxAll) maxAll = lm;
		if (rp < 35) core.push(lm);
		else if (rp > 90 && rp < 200) disk.push(lm);
	}
	function quant(arr, q) {
		var s = arr.slice().sort(function (a, b) { return a - b; });
		return s[Math.min(s.length - 1, Math.floor(s.length * q))];
	}
	console.log('scene luma: core med', quant(core, 0.5).toFixed(3),
		'p90', quant(core, 0.9).toFixed(3), 'p99', quant(core, 0.99).toFixed(2), 'max', quant(core, 1).toFixed(2));
	console.log('scene luma: disk med', quant(disk, 0.5).toFixed(4),
		'p90', quant(disk, 0.9).toFixed(4), 'p99', quant(disk, 0.99).toFixed(3), 'max', quant(disk, 1).toFixed(3));
	console.log('global max', maxAll.toFixed(2),
		'core/disk median ratio', (quant(core, 0.5) / quant(disk, 0.5)).toFixed(1));
	for (var evs = 1; evs >= -4; evs -= 0.5) {
		var e = Math.pow(2, evs);
		console.log('EV ' + evs.toFixed(1) + ': core med->' + (aces(quant(core, 0.5) * e) * 255).toFixed(0) +
			' p99->' + (aces(quant(core, 0.99) * e) * 255).toFixed(0) +
			' | disk med->' + (aces(quant(disk, 0.5) * e) * 255).toFixed(1) +
			' p90->' + (aces(quant(disk, 0.9) * e) * 255).toFixed(0));
	}
}

L.pass('smoke-page index.html runs headless: WebGL2 HDR path, exposure/saturation sliders, solver select');
