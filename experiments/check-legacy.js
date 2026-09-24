'use strict';
/* Legacy bit-identical gate (0.5.0): a calm-preset trajectory run through
 * the WORKTREE galaxy.js must hash identically to the same run through the
 * 0.4.2 build (git show 67ba6ea:galaxy.js), solver = 0 / page-default
 * parameters. galaxy.js is supposed to be untouched; this gates behaviour,
 * not just the diff.
 *
 *   node experiments/check-legacy.js
 *   env: NSTARS (4000), TEND (40)
 */
var fs = require('fs'), os = require('os'), path = require('path');
var cp = require('child_process');
var L = require('./lib.js');

var N = parseInt(process.env.NSTARS || '4000', 10);
var TEND = parseFloat(process.env.TEND || '40');
var DT = 0.01;

function hashRun(Galaxy) {
	var P = Galaxy.defaultParams();          /* page defaults, solver path off */
	var st = Galaxy.createState(N);
	st.n = N;
	Galaxy.initStars(st, P, P.seed);
	Galaxy.settle(st, P, Math.round(P.tsettle / P.dtSettle), P.dtSettle, true, true);
	var k;
	for (k = 0; k < Math.round(TEND / DT); k++) Galaxy.step(st, P, DT, true, true);
	/* FNV-1a over the raw state buffers */
	var h = 0x811c9dc5, i, bytes, view, b;
	var bufs = [st.x, st.y, st.z, st.vx, st.vy, st.vz];
	for (i = 0; i < bufs.length; i++) {
		view = new Uint8Array(bufs[i].buffer, bufs[i].byteOffset, bufs[i].byteLength);
		for (b = 0; b < view.length; b++) { h ^= view[b]; h = (h * 0x01000193) >>> 0; }
	}
	return { hash: h.toString(16), t: st.t, caps: st.caps };
}

/* 0.4.2 build of galaxy.js from git */
var oldSrc = cp.execSync('git show 67ba6ea:galaxy.js', { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 24 }).toString();
var tmp = path.join(os.tmpdir(), 'galaxy-0.4.2-' + process.pid + '.js');
fs.writeFileSync(tmp, oldSrc);
delete require.cache[require.resolve(tmp)];
var Old = require(tmp);

var cur = hashRun(require('../galaxy.js'));
var old = hashRun(Old);
fs.unlinkSync(tmp);

console.log('worktree galaxy.js: hash=' + cur.hash + ' t=' + cur.t.toFixed(4) + ' caps=' + cur.caps);
console.log('0.4.2 (67ba6ea)   : hash=' + old.hash + ' t=' + old.t.toFixed(4) + ' caps=' + old.caps);
var diff = cp.execSync('git diff --name-only -- galaxy.js', { cwd: path.join(__dirname, '..') }).toString().trim();
if (diff) L.fail('galaxy.js differs from HEAD: ' + diff);
if (cur.hash !== old.hash)
	L.fail('calm trajectory hash mismatch vs 0.4.2 build (legacy physics changed)');
L.pass('check-legacy calm trajectory bit-identical to the 0.4.2 build, galaxy.js untouched');
