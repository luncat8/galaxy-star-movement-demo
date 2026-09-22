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
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '',
		style: {}, dataset: { n: '4000' },
		width: 300, height: 150,
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
		addEventListener: function() {},
		setPointerCapture: function() {}, releasePointerCapture: function() {},
		getContext: function() { return stubCtx(); },
		getBoundingClientRect: function() { return { width: 800, height: 600 }; },
		querySelectorAll: function() { return []; },
		click: function() {}, blur: function() {}
	};
}

var els = {};
global.document = {
	getElementById: function(id) {
		if (!els[id]) els[id] = stubEl(id);
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
src += '\n;global.__hooks = { reset: (typeof reset !== "undefined") ? reset : null };';

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
console.log('ran ' + frames + ' headless frames incl. full settle, hut="' +
	(String(els.hud ? els.hud.textContent : '')).slice(0, 60) + '"');
L.pass('smoke-page index.html runs headless without exceptions');
