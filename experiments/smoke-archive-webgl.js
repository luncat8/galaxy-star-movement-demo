/* Headless smoke run of archive/simple-friction-field-webGL.html with a stub
 * WebGL2 context + DOM. Catches syntax errors, uniform locations the shader
 * never declares, the "Slow Field" toggle (instanced arc fan drawn only when
 * on) and the "Arm Tint" toggle (the DISK shader's uArmTint uniform must flip
 * 1 -> 0 -> 1 on click: off = the stars inside the slow field lose the pink
 * highlight and are drawn as plain disk light).
 *
 *   node experiments/smoke-archive-webgl.js        # gate
 *   node experiments/smoke-archive-webgl.js --png  # + preview renders
 *
 * --png replays the captured disk draw (VS_DISK maths on the page's own star
 * state + soft sprite, additive blend) into experiments/logs/webgl-stars-
 * {tint,plain}.png: the only way to eyeball a GPU feature in a browserless
 * sandbox (finding 26). Physics is stepped ~6 tu first so the jam has formed.
 */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib'), L = require('./lib.js');

var WANT_PNG = process.argv.indexOf('--png') >= 0;
var PAGE = __dirname + '/../archive/simple-friction-field-webGL.html';

/* Uniform/attribute names declared per shader, from the source text the page
 * hands to shaderSource — a stub has no compiler to reject bad lookups. */
function decls(src, kw) {
	var out = [], re = new RegExp('^\\s*' + kw + '\\s+\\w+\\s+([^;]+);', 'gm'), m;
	while ((m = re.exec(src))) {
		m[1].split(',').forEach(function(n) {
			n = n.trim().replace(/\[.*\]$/, '');
			if (n && out.indexOf(n) < 0) out.push(n);
		});
	}
	return out;
}

var log = {
	missing: [], state: {}, loc: {}, prog: null, ctx: '', draws: 0,
	fieldInst: 0, diskDraws: [],
	set: function(name, v) { log.state[name] = v; }
};

function fakeGL() {
	var consts = {}, locId = 0, locName = {}, bound = {}, curVao = null;
	['ARRAY_BUFFER', 'TEXTURE_2D', 'FRAMEBUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'POINTS',
	 'BLEND', 'TRIANGLE_STRIP', 'TEXTURE0', 'RGBA', 'ONE', 'NEAREST', 'CLAMP_TO_EDGE',
	 'FLOAT', 'UNSIGNED_BYTE', 'COLOR_ATTACHMENT0', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER',
	 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER',
	 'FRAGMENT_SHADER', 'ACTIVE_UNIFORMS', 'ACTIVE_ATTRIBUTES'
	].forEach(function(k, i) { consts[k] = 0x1000 + i; });
	function snapshotState() {
		var copy = {};
		for (var k in log.state) copy[k] = log.state[k];
		return copy;
	}
	/* the disk draw: keep the uniforms and the buffers the VAO points at (the
	 * theta buffer is the page's live typed array, so it reads current state) */
	function captureDisk(count) {
		var names = log.prog.attribs, va = curVao.attribs;
		var th = va[names.indexOf('aTheta')], st = va[names.indexOf('aA')];
		log.diskDraws.push({ n: count, theta: th.buf.data, stat: st.buf.data, u: snapshotState() });
	}
	return Object.assign({}, consts, {
		createShader: function(t) { return { src: '' }; },
		shaderSource: function(s, src) { s.src = src; },
		compileShader: function() {}, getShaderParameter: function() { return true; },
		getShaderInfoLog: function() { return ''; }, deleteShader: function() {},
		createProgram: function() { return { uniforms: [], attribs: [], src: '' }; },
		attachShader: function(p, s) { p.src += s.src; },
		linkProgram: function(p) {
			p.uniforms = decls(p.src, 'uniform');
			p.attribs = decls(p.src, 'attribute');
			p.field = p.uniforms.indexOf('uR0') >= 0;        // only the field program
			p.disk = p.uniforms.indexOf('uArmTint') >= 0;    // only the disk program
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
			if (p.uniforms.indexOf(name) < 0) log.missing.push(name);
			locName[++locId] = name;
			return locId;
		},
		getAttribLocation: function(p, name) { return p.attribs.indexOf(name); },
		useProgram: function(p) { log.prog = p; },
		uniform1f: function(l, v) { log.set(locName[l], v); },
		uniform1i: function(l, v) { log.set(locName[l], v); },
		uniform2f: function(l, a, b) { log.set(locName[l], a + ',' + b); },
		uniform3f: function(l, a, b, c) { log.set(locName[l], [a, b, c]); },
		drawArrays: function(mode, first, count) {
			log.draws++;
			if (log.prog.disk) captureDisk(count);
		},
		drawArraysInstanced: function(mode, first, count, instCount) {
			log.draws++;
			if (log.prog.field) log.fieldInst += instCount;
		},
		createBuffer: function() { return { data: null }; },
		bindBuffer: function(t, b) { bound[t] = b; },
		bufferData: function(t, data) { if (bound[t]) bound[t].data = data; },
		bufferSubData: function() {},
		createVertexArray: function() { return { attribs: {} }; },
		bindVertexArray: function(v) { curVao = v; },
		enableVertexAttribArray: function() {}, disableVertexAttribArray: function() {},
		vertexAttribPointer: function(loc, size, type, norm, stride, offs) {
			if (!curVao) return;
			var prev = curVao.attribs[loc] || { div: 0 };
			curVao.attribs[loc] = { size: size, stride: stride, offs: offs, div: prev.div, buf: bound[consts.ARRAY_BUFFER] };
		},
		vertexAttribDivisor: function(loc, div) {
			if (curVao && curVao.attribs[loc]) curVao.attribs[loc].div = div;
		},
		createTexture: function() { return {}; },
		bindTexture: function() {}, texImage2D: function() {}, texParameteri: function() {},
		createFramebuffer: function() { return {}; }, bindFramebuffer: function() {},
		framebufferTexture2D: function() {}, deleteTexture: function() {}, deleteFramebuffer: function() {},
		viewport: function() {}, enable: function() {}, disable: function() {},
		blendFunc: function() {}, activeTexture: function() {}, lineWidth: function() {}
	});
}

var gl = fakeGL();

function stubEl(id) {
	var handlers = {}, classes = {};
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '', hidden: false,
		style: {}, width: 300, height: 150, dataset: {},
		classList: {
			add: function(c) { classes[c] = true; },
			remove: function(c) { delete classes[c]; },
			toggle: function(c, on) { if (on === undefined) on = !classes[c]; if (on) classes[c] = true; else delete classes[c]; },
			contains: function(c) { return !!classes[c]; }
		},
		addEventListener: function(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
		fire: function(k) { (handlers[k] || []).forEach(function(fn) { fn({}); }); },
		getContext: function(name) { log.ctx = name; return gl; },
		setPointerCapture: function() {}, releasePointerCapture: function() {}
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
if (log.ctx !== 'webgl2') L.fail('expected a webgl2 context request, got ' + log.ctx);
/* the arm tint ships ON: the button is marked active in the markup */
if (html.indexOf('class="btn active" id="btn-tint"') < 0) L.fail('Arm Tint button does not start active');

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
	log.diskDraws.length = 0;
	frame();
	if (log.diskDraws.length !== 1) L.fail('expected one disk draw per frame, got ' + log.diskDraws.length);
	var d = log.diskDraws[0];
	return { draws: log.draws, fieldInst: log.fieldInst, tint: d.u.uArmTint, disk: d };
}

/* let the jam form: 500 frames at the 50 ms clamp = 12.5 sim tu at speed 1 */
var i;
for (i = 0; i < 500; i++) { now += 50; frame(); }

var hidden = sample();
els['btn-field'].fire('click');
var shown = sample();
els['btn-field'].fire('click');
var tintOn = sample();
els['btn-tint'].fire('click');
var tintOff = sample();
els['btn-tint'].fire('click');
var tintBack = sample();

if (hidden.fieldInst !== 0) L.fail('field hidden but the field program still drew ' + hidden.fieldInst + ' instances');
if (shown.fieldInst !== 7 * 2) L.fail('expected 7 arcs x 2 arms when the field is on, got ' + shown.fieldInst);
if (tintOn.tint !== 1) L.fail('Arm Tint on but uArmTint=' + tintOn.tint);
if (tintOff.tint !== 0) L.fail('Arm Tint clicked off but uArmTint=' + tintOff.tint);
if (tintBack.tint !== 1) L.fail('Arm Tint clicked back on but uArmTint=' + tintBack.tint);
if (els['btn-tint'].classList.contains('active') !== true) L.fail('Arm Tint button state out of sync');

/* Replay VS_DISK's colour law on the captured state: with the tint on, the
 * stars inside the field (D > 0.4) must come out pink; with it off, every
 * star must come out the plain disk hue. This checks the shader text the page
 * ships, not a re-implementation of the toggle. */
var PINK = [1.0, 0.54902, 0.78431], PLAIN = [0.70588, 0.82353, 1.0];
function starColorAlpha(d, i, out) {
	var u = d.u, th = d.theta[i], r0 = d.stat[i * 6], eu = d.stat[i * 6 + 1], peri = d.stat[i * 6 + 2], br = d.stat[i * 6 + 3];
	var rho = r0 * (1 + u.uEccMax * eu * Math.cos(th - peri));
	var dth = th - (Math.log(rho) / u.uTanPitch + u.uPatternPhase);
	dth = ((dth % u.uArmOffset) + u.uArmOffset) % u.uArmOffset;
	if (dth > u.uArmOffset * 0.5) dth -= u.uArmOffset;
	var D = Math.exp(-dth * dth * u.uInv2Sig2);
	var inArm = D > 0.4 ? 1 : 0, tint = u.uArmTint;
	var b = br * (0.4 + 1 * 0.6);                       // ps = 1 (face-on replay)
	var aTint = inArm ? D * b : (1 - D) * b * 0.8;
	out.inArm = inArm;
	out.col = inArm * tint > 0.5 ? PINK : PLAIN;
	out.alpha = b * 0.8 + (aTint - b * 0.8) * tint;
	out.rho = rho; out.th = th;
	return out;
}
function countArmPink(d) {
	var o = {}, n = 0, arm = 0, pink = 0;
	for (var k = 0; k < d.n; k++) {
		starColorAlpha(d, k, o);
		n++;
		if (o.inArm) arm++;
		if (o.col === PINK) pink++;
	}
	return { n: n, arm: arm, pink: pink };
}
var cOn = countArmPink(tintOn.disk), cOff = countArmPink(tintOff.disk);
if (cOn.arm < 0.05 * cOn.n) L.fail('too few stars inside the field after the warm-up: ' + cOn.arm + '/' + cOn.n);
if (cOn.pink !== cOn.arm) L.fail('tint on: pink stars ' + cOn.pink + ' != in-field stars ' + cOn.arm);
if (cOff.pink !== 0) L.fail('tint off: ' + cOff.pink + ' stars still pink');
console.log('frames ok; field instances hidden=' + hidden.fieldInst + ' shown=' + shown.fieldInst +
	'; disk stars=' + cOn.n + ' in-field=' + cOn.arm + ' (' + (100 * cOn.arm / cOn.n).toFixed(1) +
	'%) pink on/off=' + cOn.pink + '/' + cOff.pink);

/* ---- optional preview renders: replay the captured disk draw face-on ---- */
function renderPng(label, d) {
	var W = global.innerWidth, H = global.innerHeight, fb = new Float32Array(W * H * 3);
	var x, y, k, o, c, out = {}, scale = d.u.uScale;   // uScale already carries zoom*DPR
	for (o = 0; o < W * H * 3; o += 3) { fb[o] = 0.016; fb[o + 1] = 0.008; fb[o + 2] = 0.031; }
	for (k = 0; k < d.n; k++) {
		starColorAlpha(d, k, out);
		var px = out.rho * Math.cos(out.th), py = out.rho * Math.sin(out.th);
		var sx = W / 2 + px * scale, sy = H / 2 + py * scale, rad = 4;
		var x0 = Math.max(0, Math.floor(sx - rad)), x1 = Math.min(W - 1, Math.ceil(sx + rad));
		var y0 = Math.max(0, Math.floor(sy - rad)), y1 = Math.min(H - 1, Math.ceil(sy + rad));
		for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
			var dx = (x - sx) / rad, dy = (y - sy) / rad, r = Math.sqrt(dx * dx + dy * dy);
			if (r > 1) continue;                                   // FS_POINT: discard outside sprite
			var a = r < 0.5 ? 1 - 0.6 * r * 2 : 0.4 * (1 - (r * 2 - 1));   // FS_POINT falloff
			o = (y * W + x) * 3;
			for (c = 0; c < 3; c++) fb[o + c] += out.col[c] * out.alpha * a * 0.35;
		}
	}
	var stride = W * 3 + 1, raw = Buffer.alloc(H * stride), p = 0;
	for (y = 0; y < H; y++) {
		raw[p++] = 0;
		for (x = 0; x < W; x++) for (c = 0; c < 3; c++) {
			var v = fb[(y * W + x) * 3 + c], m = v / (v + 1);   // soft clip
			raw[p++] = Math.round(255 * Math.pow(m, 1 / 2.2));
		}
	}
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
	ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
	var file = path.join(__dirname, 'logs', 'webgl-stars-' + label + '.png');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
	console.log('wrote ' + path.relative(process.cwd(), file) + ' (' + d.n + ' stars, uArmTint=' + d.u.uArmTint + ')');
}
if (WANT_PNG) {
	renderPng('tint', tintOn.disk);
	renderPng('plain', tintOff.disk);
}

L.pass('smoke-archive-webgl: page runs, Arm Tint toggles the in-field star colour');
