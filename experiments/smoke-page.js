'use strict';
/* Headless smoke run of index.html's inline script with DOM stubs.
 * Catches syntax/reference errors and exercises controls + settle + frames.
 * Not a physics gate: asserts only "runs N frames without exceptions". */
var fs = require('fs'), L = require('./lib.js');
global.Galaxy = L.Galaxy;
global.SelfGrav = require('../selfgrav.js');

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
		id: id, value: '0', checked: false, textContent: '', innerHTML: '',
		style: {}, dataset: { n: '4000' },
		width: 300, height: 150,
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
		addEventListener: function(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
		fire: function(k) { (handlers[k] || []).forEach(function(fn) { fn({ target: els[id] }); }); },
		setPointerCapture: function() {}, releasePointerCapture: function() {},
		getContext: function() { return stubCtx(); },
		getBoundingClientRect: function() { return { width: 800, height: 600 }; },
		querySelectorAll: function() { return []; },
		click: function() {}, blur: function() {}
	};
}

var els = {};
var SLIDER_VALUES = {
	's-speed': '0.03', 's-ab': '0.06', 's-as': '0.06', 's-ob': '0.36',
	's-os': '0.30', 's-eta': '0.05', 's-sig': '0.1', 's-tilt': '20', 's-gfb': '0'
};
/* sel-sg default '0' (off) comes from stubEl */
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
var rafCb = null;
global.window = global;
global.devicePixelRatio = 1;
global.requestAnimationFrame = function(cb) { rafCb = cb; return 1; };
global.performance = { now: function() { return simNow; } };
global.addEventListener = function() {};

var html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
var scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!scripts.length) L.fail('no inline script found');
var src = scripts[scripts.length - 1].replace(/<\/?script>/g, '');
/* expose the internals from INSIDE the page IIFE (P/st/ui are closure-scoped) */
if (src.indexOf('\ninit();\n})();') < 0) L.fail('page structure changed: init()/IIFE tail not found');
src = src.replace('\ninit();\n})();', '\ninit();\nglobal.__hooks = { P: P, st: st, ui: ui };\n})();');

var simNow = 0;
try {
	eval(src);
} catch (e) {
	L.fail('inline script threw at init: ' + (e && e.stack || e));
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
var settled = frames;
console.log('ran ' + settled + ' headless frames incl. full settle, hut="' +
	(String(els.hud ? els.hud.textContent : '')).slice(0, 60) + '"');

/* Solver select through the real UI path: WKB must arm a default strength
 * and hand the refresh to galaxy.js (freeze off); global must set freeze,
 * arm the table through SelfGrav ticks, and show up in the HUD; off must
 * leave the page running. Also the gfb slider. */
try {
	if (__hooks.P.live.freeze) L.fail('page booted with P.live.freeze set at solver off');
	els['sel-sg'].value = '1';
	els['sel-sg'].fire('change');
	if (__hooks.P.live.gfb <= 0) L.fail('solver WKB left gfb at 0');
	if (__hooks.P.live.freeze) L.fail('WKB solver must not set freeze');
	els['s-gfb'].value = '9';
	els['s-gfb'].fire('input');
	if (__hooks.P.live.gfb !== 9) L.fail('gfb slider did not set gfb (' + __hooks.P.live.gfb + ')');
	els['sel-sg'].value = '2';
	els['sel-sg'].fire('change');
	if (!__hooks.P.live.freeze) L.fail('global solver did not set P.live.freeze');
	if (__hooks.P.live.cap !== 0.10) L.fail('global solver cap is ' + P.live.cap + ', want 0.10');
	if (__hooks.ui.sg !== 2) L.fail('ui.sg not 2 after select');
	for (frames = 0; frames < 120; frames++) {
		simNow += 16.7;
		var cb2 = rafCb; rafCb = null;
		cb2(simNow);
	}
	var lv = __hooks.st.live, nz = 0;
	for (var bi = 0; bi < lv.nb; bi++) if (lv.amp[bi] > 0) nz++;
	if (!nz) L.fail('global solver armed but the feedback table stayed zero');
	if (!/sg:global/.test(String(els.hud.textContent)))
		L.fail('HUD does not report the solver: "' + els.hud.textContent + '"');
	console.log('global sg: gfb=' + __hooks.P.live.gfb + ' gain=' + __hooks.P.live.g.toFixed(2) +
		' freeze=' + __hooks.P.live.freeze + ' bins with amplitude=' + nz + '/32, hud="' +
		els.hud.textContent.slice(0, 90) + '"');
	els['sel-sg'].value = '0';
	els['sel-sg'].fire('change');
	if (__hooks.ui.sg !== 0) L.fail('select off did not clear ui.sg');
	for (frames = 0; frames < 40; frames++) {
		simNow += 16.7;
		var cb3 = rafCb; rafCb = null;
		cb3(simNow);
	}
} catch (e) {
	L.fail('solver-select UI path threw: ' + (e && e.stack || e));
}
L.pass('smoke-page index.html runs headless, incl. solver select (off/WKB/global)');
