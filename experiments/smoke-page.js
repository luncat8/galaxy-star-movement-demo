'use strict';
/* Headless smoke run of index.html's inline script with DOM stubs.
 * Catches syntax/reference errors and exercises controls + settle + frames.
 * Not a physics gate: asserts only "runs N frames without exceptions". */
var fs = require('fs'), L = require('./lib.js');
global.Galaxy = L.Galaxy;

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

/* S5 live mode through the real UI path: toggle on (must arm a default
 * strength), drag the slider, and check the feedback actually reaches the
 * physics (non-zero live amplitude table) without exceptions. */
try {
	els['c-live'].checked = true;
	els['c-live'].fire('change');
	if (__hooks.P.live.gfb <= 0) L.fail('live toggle on left gfb at 0');
	els['s-gfb'].value = '9';
	els['s-gfb'].fire('input');
	if (__hooks.P.live.gfb !== 9) L.fail('live slider did not set gfb (' + __hooks.P.live.gfb + ')');
	for (frames = 0; frames < 80; frames++) {
		simNow += 16.7;
		var cb2 = rafCb; rafCb = null;
		cb2(simNow);
	}
	var lv = __hooks.st.live, nz = 0;
	for (var bi = 0; bi < lv.nb; bi++) if (lv.amp[bi] > 0) nz++;
	if (!nz) L.fail('live mode armed but the feedback table stayed zero');
	if (!/live m=2/.test(String(els.hud.textContent)))
		L.fail('HUD does not report the live mode: "' + els.hud.textContent + '"');
	console.log('live mode: gfb=' + __hooks.P.live.gfb + ' gain=' + __hooks.P.live.g.toFixed(2) +
		' bins with amplitude=' + nz + '/32, hud="' + els.hud.textContent.slice(0, 80) + '"');
} catch (e) {
	L.fail('live-mode UI path threw: ' + (e && e.stack || e));
}
L.pass('smoke-page index.html runs headless, incl. live-mode toggle');
