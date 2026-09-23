/* Headless smoke run of archive/simple-friction-field-webGL.html with a stub
 * WebGL2 context + DOM. Catches syntax errors, uniform locations the shader
 * never declares, and the "Colorize" toggle (the slow-field dots must switch
 * from one fixed hue to a strength ramp on a denser instanced arc fan).
 *
 *   node experiments/smoke-archive-webgl.js        # gate
 *   node experiments/smoke-archive-webgl.js --png  # + preview renders
 *
 * --png replays the captured field instances (VS_FIELD maths + soft sprite, the
 * same additive blend) into experiments/logs/webgl-field-{plain,colorized}.png:
 * the only way to eyeball a GPU feature in a browserless sandbox.
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
	missing: [], state: {}, states: [], loc: {}, prog: null, ctx: '', draws: 0,
	fieldDraws: [],
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
	/* one instanced row of the field fan -> floats at offs/stride of each attrib */
	function readInst(rec, i, ncomp) {
		var data = rec.buf.data, base = rec.offs / 4 + i * (rec.stride / 4), out = [], c;
		for (c = 0; c < ncomp; c++) out.push(data[base + c]);
		return out;
	}
	function captureField(instCount) {
		var names = log.prog.attribs, va = curVao.attribs, rows = [], i;
		for (i = 0; i < instCount; i++) {
			var ph = readInst(va[names.indexOf('aPh')], i, 2);
			var col = readInst(va[names.indexOf('aCol')], i, 3);
			var as = readInst(va[names.indexOf('aAS')], i, 2);
			rows.push({ armPhase: ph[0], thetaOff: ph[1], col: col, alpha: as[0], size: as[1] });
		}
		var copy = {};
		for (var k in log.state) copy[k] = log.state[k];
		log.states.push(copy);
		log.fieldDraws.push({ inst: instCount, rows: rows, u: copy });
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
			p.field = p.uniforms.indexOf('uR0') >= 0;   // only the field program
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
		drawArrays: function() {
			log.draws++;
		},
		drawArraysInstanced: function(mode, first, count, instCount) {
			log.draws++;
			if (!log.prog.field) return;
			captureField(instCount);
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
	var handlers = {};
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '', hidden: false,
		style: {}, width: 300, height: 150, dataset: {},
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
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

function frame() {
	now += 16.7;
	var cb = rafCb;
	rafCb = null;
	if (!cb) L.fail('rAF chain broke');
	cb(now);
}
function sample() {
	log.draws = 0;
	log.states.length = 0;
	log.fieldDraws.length = 0;
	frame();
	var hues = [], inst = 0;
	log.fieldDraws.forEach(function(d) {
		inst += d.inst;
		d.rows.forEach(function(r) {
			var c = r.col.join(',');
			if (hues.indexOf(c) < 0) hues.push(c);
		});
	});
	return { draws: log.draws, arcs: inst, hues: hues, fieldDraws: log.fieldDraws.slice() };
}

var i;
for (i = 0; i < 5; i++) frame();
var hidden = sample();
els['btn-field'].fire('click');
var plain = sample();
els['btn-color'].fire('click');
var tinted = sample();
var tintDraws = tinted.fieldDraws;
els['btn-color'].fire('click');
var restored = sample();

if (hidden.arcs !== 0) L.fail('field hidden but the field program still drew ' + hidden.arcs + ' instances');
if (plain.hues.length !== 1) L.fail('monochrome field drew ' + plain.hues.length + ' hues: ' + plain.hues.join(' '));
if (tinted.hues.length < 8) L.fail('colorize drew only ' + tinted.hues.length + ' distinct hues');
if (tinted.arcs <= plain.arcs) L.fail('colorize fan is not denser: ' + tinted.arcs + ' <= ' + plain.arcs);
if (tinted.arcs !== 60 * (plain.arcs / 7)) L.fail('expected the 60-arc fan x arm count, got ' + tinted.arcs);
if (restored.hues.length !== 1 || restored.hues[0] !== plain.hues[0])
	L.fail('toggling back did not restore the fixed hue');
console.log('frames ok; field instances/frame plain=' + plain.arcs + ' colorized=' + tinted.arcs +
	' hues=' + tinted.hues.length + ' (' + tinted.hues[0] + ' .. ' + tinted.hues[tinted.hues.length - 1] + ')');

/* ---- optional preview renders: replay the captured field instances ---- */
function renderPng(label, draws) {
	var W = global.innerWidth, H = global.innerHeight, fb = new Float32Array(W * H * 3);
	var CAM = 12, NS = 1500, x, y, k, o, c, nArcs = 0;
	for (o = 0; o < W * H * 3; o += 3) { fb[o] = 0.016; fb[o + 1] = 0.008; fb[o + 2] = 0.031; }
	draws.forEach(function(d) {
		var u = d.u;
		d.rows.forEach(function(row) {
			nArcs++;
			var col = row.col;
			for (k = 0; k < NS; k++) {
				var t = k / (NS - 1), r = u.uR0 + (u.uR1 - u.uR0) * t;
				var bt = Math.log(r) / u.uTanPitch + u.uPatternPhase + row.armPhase + row.thetaOff;
				var px = r * Math.cos(bt), py = r * Math.sin(bt);
				var rx = px * u.uCosR - py * u.uSinR, ry = px * u.uSinR + py * u.uCosR;
				var ps = CAM / (CAM + ry * u.uSinT);
				var sx = rx * u.uScale * ps, sy = ry * u.uCosT * u.uScale * ps, rad = row.size * u.uPtScale * 0.5;
				var a = row.alpha * Math.min(1, t / 0.02) * (1 - Math.min(1, Math.max(0, (t - 0.96) / 0.04)));
				var x0 = Math.max(0, Math.floor(W / 2 + sx - rad)), x1 = Math.min(W - 1, Math.ceil(W / 2 + sx + rad));
				var y0 = Math.max(0, Math.floor(H / 2 + sy - rad)), y1 = Math.min(H - 1, Math.ceil(H / 2 + sy + rad));
				for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
					var dx = (x - (W / 2 + sx)) / rad, dy = (y - (H / 2 + sy)) / rad;
					var r2 = dx * dx + dy * dy;
					if (r2 > 1) continue;                       // FS_FIELD: discard outside sprite
					var w = Math.exp(-r2 * 4) * a;              // FS_FIELD falloff x additive blend
					o = (y * W + x) * 3;
					for (c = 0; c < 3; c++) fb[o + c] += col[c] * w;
				}
			}
		});
	});
	var stride = W * 3 + 1, raw = Buffer.alloc(H * stride), p = 0;
	for (y = 0; y < H; y++) {
		raw[p++] = 0;
		for (x = 0; x < W; x++) for (c = 0; c < 3; c++) {
			var v = fb[(y * W + x) * 3 + c] / 0.6, m = v / (v + 1);   // soft clip, same as the glow
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
		var len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]), c = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		c.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, c]);
	}
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
	var out = path.join(__dirname, 'logs', 'webgl-field-' + label + '.png');
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
	console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + nArcs + ' arcs)');
}
if (WANT_PNG) {
	renderPng('plain', plain.fieldDraws);
	renderPng('colorized', tintDraws);
}

L.pass('smoke-archive-webgl: page runs, Colorize recolors the slow-field dots');
