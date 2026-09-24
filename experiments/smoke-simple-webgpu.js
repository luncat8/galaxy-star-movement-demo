'use strict';
/* Headless smoke run of simple/simple-friction-field-webGPU.html with a stub
 * WebGPU context + DOM. Validates:
 *   - navigator.gpu + requestAdapter + requestDevice + getContext('webgpu')
 *   - context.configure with format 'rgba16float' and toneMapping { mode: 'extended' }
 *   - WGSL shader modules compilation & struct layouts
 *   - render pipelines creation (disk, bulge, field, bg, present)
 *   - headless 500-frame simulation & density-wave arm traffic jam formation
 *   - exposure & saturation sliders reach the present pass uniform buffer
 *   - trails toggle switches background mode between 0 and 1
 *   - arm tint toggle flips uArmTint
 *   - slow field toggle activates instanced arc rendering
 *   - color-preservation verification: stars DO NOT turn white above 255 of brightness
 *
 *   node experiments/smoke-simple-webgpu.js          # gate
 *   node experiments/smoke-simple-webgpu.js --png    # + full-pipeline preview
 *   node experiments/smoke-simple-webgpu.js --stats  # + scene-luma table
 */
var fs = require('fs'), path = require('path'), zlib = require('zlib'), L = require('./lib.js');

var WANT_PNG = process.argv.indexOf('--png') >= 0;
var WANT_STATS = process.argv.indexOf('--stats') >= 0;
var PAGE = __dirname + '/../simple/simple-friction-field-webGPU.html';

var log = {
	draws: 0,
	fieldInst: 0,
	configured: null,
	pipelines: {},
	buffers: [],
	captured: {
		diskCam: null,
		bulgeCam: null,
		bg: null,
		present: null,
		diskTheta: null,
		diskStatic: null,
		bulgeTheta: null,
		bulgeStatic: null
	}
};

/* Mock WebGPU objects */
function createMockDevice() {
	var curPipeline = null, curBindGroups = {}, curVertexBuffers = {};
	return {
		lost: new Promise(function() {}),
		createShaderModule: function(desc) {
			return { code: desc.code };
		},
		createSampler: function(desc) {
			return { desc: desc };
		},
		createBuffer: function(desc) {
			var b = { size: desc.size, usage: desc.usage, data: new Uint8Array(desc.size), lastData: null };
			log.buffers.push(b);
			return b;
		},
		createTexture: function(desc) {
			return {
				width: desc.size[0],
				height: desc.size[1],
				format: desc.format,
				destroy: function() {},
				createView: function() { return { texture: this }; }
			};
		},
		createRenderPipeline: function(desc) {
			var p = {
				desc: desc,
				getBindGroupLayout: function(idx) {
					return { pipeline: this, index: idx };
				}
			};
			if (desc.vertex.entryPoint === 'vs_disk') log.pipelines.disk = p;
			if (desc.vertex.entryPoint === 'vs_bulge') log.pipelines.bulge = p;
			if (desc.vertex.entryPoint === 'vs_field') log.pipelines.field = p;
			if (desc.vertex.entryPoint === 'vs_quad' && desc.fragment.entryPoint === 'fs_bg') log.pipelines.bg = p;
			if (desc.vertex.entryPoint === 'vs_quad' && desc.fragment.entryPoint === 'fs_present') log.pipelines.present = p;
			return p;
		},
		createBindGroup: function(desc) {
			return { desc: desc };
		},
		queue: {
			submit: function(cmds) {},
			writeBuffer: function(buf, off, data) {
				var view = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
				buf.data.set(view, off);
				buf.lastData = new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
				if (buf === stubState.diskCamBuffer) log.captured.diskCam = buf.lastData;
				if (buf === stubState.bulgeCamBuffer) log.captured.bulgeCam = buf.lastData;
				if (buf === stubState.bgUniformBuffer) log.captured.bg = buf.lastData;
				if (buf === stubState.presentUniformBuffer) log.captured.present = buf.lastData;
				if (buf === stubState.diskThetaBuffer) log.captured.diskTheta = buf.lastData;
				if (buf === stubState.diskStaticBuffer) log.captured.diskStatic = buf.lastData;
				if (buf === stubState.bulgeThetaBuffer) log.captured.bulgeTheta = buf.lastData;
				if (buf === stubState.bulgeStaticBuffer) log.captured.bulgeStatic = buf.lastData;
			}
		},
		createCommandEncoder: function() {
			return {
				beginRenderPass: function(passDesc) {
					return {
						setPipeline: function(p) { curPipeline = p; },
						setBindGroup: function(idx, bg) { curBindGroups[idx] = bg; },
						setVertexBuffer: function(slot, buf) { curVertexBuffers[slot] = buf; },
						draw: function(vertexCount, instanceCount, firstVertex, firstInstance) {
							log.draws++;
							instanceCount = instanceCount || 1;
							if (curPipeline === log.pipelines.field) {
								log.fieldInst += instanceCount;
							}
						},
						end: function() {}
					};
				},
				finish: function() { return {}; }
			};
		}
	};
}

var stubState = {};
var mockDevice = createMockDevice();

var mockContext = {
	configure: function(conf) {
		log.configured = conf;
	},
	getCurrentTexture: function() {
		return {
			createView: function() { return {}; }
		};
	}
};

function stubEl(id) {
	var handlers = {};
	return {
		id: id, value: '0', checked: false, textContent: '', innerHTML: '', hidden: false,
		style: {}, dataset: {}, width: 900, height: 700,
		classList: { add: function() {}, remove: function() {}, toggle: function() {} },
		addEventListener: function(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
		fire: function(k) { (handlers[k] || []).forEach(function(fn) { fn({}); }); },
		setPointerCapture: function() {}, releasePointerCapture: function() {},
		getContext: function(name) {
			if (name === 'webgpu') return mockContext;
			return null;
		},
		querySelector: function() { return stubEl(id + '-sub'); },
		querySelectorAll: function() { return []; }
	};
}

var els = {};
global.document = {
	getElementById: function(id) { return (els[id] = els[id] || stubEl(id)); },
	addEventListener: function() {},
	body: { classList: { add: function() {}, remove: function() {} } }
};
global.window = global;
global.addEventListener = function() {};
global.removeEventListener = function() {};
global.devicePixelRatio = 1;
global.innerWidth = 900;
global.innerHeight = 700;
global.performance = { now: function() { return now; } };
global.requestAnimationFrame = function(cb) { rafCb = cb; };
global.matchMedia = function(q) {
	return { matches: true }; // simulate HDR screen
};
Object.defineProperty(global, 'navigator', {
	value: {
		gpu: {
			requestAdapter: function() {
				return Promise.resolve({
					requestDevice: function() { return Promise.resolve(mockDevice); }
				});
			}
		}
	},
	configurable: true
});
global.GPUTextureUsage = {
	RENDER_ATTACHMENT: 0x10,
	TEXTURE_BINDING: 0x04,
	COPY_SRC: 0x01,
	COPY_DST: 0x02
};
global.GPUBufferUsage = {
	VERTEX: 0x20,
	UNIFORM: 0x40,
	COPY_DST: 0x08
};

var html = fs.readFileSync(PAGE, 'utf8');
var scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) L.fail('could not find <script> in ' + PAGE);
var src = scriptMatch[1];

var now = 0, rafCb = null;
function frame() {
	if (rafCb) {
		var cb = rafCb;
		rafCb = null;
		cb(now);
	}
}

/* Execute the script asynchronously */
(async function run() {
	var AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
	var runner = new AsyncFunction(src);
	await runner();

	// Allow microtasks of initWebGPU to resolve
	await new Promise(function(resolve) { setTimeout(resolve, 50); });

	// Grab buffer references from execution environment
	stubState.diskThetaBuffer = log.buffers[0];
	stubState.diskStaticBuffer = log.buffers[1];
	stubState.bulgeThetaBuffer = log.buffers[2];
	stubState.bulgeStaticBuffer = log.buffers[3];
	stubState.diskCamBuffer = log.buffers[4];
	stubState.bulgeCamBuffer = log.buffers[5];
	stubState.fieldUniformBuffer = log.buffers[6];
	stubState.bgUniformBuffer = log.buffers[7];
	stubState.presentUniformBuffer = log.buffers[8];

	log.captured.diskStatic = stubState.diskStaticBuffer.lastData;
	log.captured.bulgeStatic = stubState.bulgeStaticBuffer.lastData;

	// Verify WebGPU Context Configuration for HDR
	if (!log.configured) L.fail('context.configure was not called');
	if (log.configured.format !== 'rgba16float')
		L.fail('context format must be rgba16float, got ' + log.configured.format);
	if (!log.configured.toneMapping || log.configured.toneMapping.mode !== 'extended')
		L.fail('context toneMapping mode must be "extended" for HDR, got ' + JSON.stringify(log.configured.toneMapping));

	// Let density wave arm traffic jam form (500 frames)
	for (var i = 0; i < 500; i++) {
		now += 50;
		frame();
	}

	if (log.draws < 4) L.fail('frame drew only ' + log.draws + ' times, want at least bg+bulge+disk+present');
	if (!log.pipelines.disk || !log.pipelines.bulge || !log.pipelines.bg || !log.pipelines.present)
		L.fail('missing pipelines: disk=' + !!log.pipelines.disk + ' bulge=' + !!log.pipelines.bulge +
		       ' bg=' + !!log.pipelines.bg + ' present=' + !!log.pipelines.present);

	/* ---- Exposure Slider Gate ---- */
	var GAIN = 1.5;
	els['exposure'].value = '1.5';
	els['exposure'].fire('input');
	now += 16; frame();
	var expVal = log.captured.present[0];
	if (Math.abs(expVal - GAIN * Math.pow(2, 1.5)) > 1e-4)
		L.fail('exposure slider did not reach present uniform buffer: got ' + expVal);

	els['exposure'].value = '-1';
	els['exposure'].fire('input');
	now += 16; frame();
	expVal = log.captured.present[0];
	if (Math.abs(expVal - GAIN * 0.5) > 1e-6)
		L.fail('exposure -1 EV must halve radiance, got ' + expVal);

	els['exposure'].value = '0';
	els['exposure'].fire('input');

	/* ---- Saturation Slider Gate ---- */
	els['sat'].value = '1.5';
	els['sat'].fire('input');
	now += 16; frame();
	var satVal = log.captured.present[1];
	if (Math.abs(satVal - 1.5) > 1e-6)
		L.fail('saturation slider did not reach present uniform buffer: got ' + satVal);

	els['sat'].value = '0';
	els['sat'].fire('input');
	now += 16; frame();
	satVal = log.captured.present[1];
	if (Math.abs(satVal - 0) > 1e-6)
		L.fail('saturation 0 (monochrome) must reach present uniform buffer');

	els['sat'].value = '1';
	els['sat'].fire('input');

	/* ---- Headroom Slider Gate ---- */
	els['headroom'].value = '3.5';
	els['headroom'].fire('input');
	now += 16; frame();
	var hrVal = log.captured.present[2];
	if (Math.abs(hrVal - 3.5) > 1e-6)
		L.fail('headroom slider did not reach present uniform buffer: got ' + hrVal);
	els['headroom'].value = '4.0';
	els['headroom'].fire('input');

	/* ---- Trails Toggle Gate ---- */
	els['btn-trails'].fire('click');
	now += 16; frame();
	if (log.captured.bg[3] !== 1) L.fail('trails on: bg mode ' + log.captured.bg[3] + ', want 1');
	els['btn-trails'].fire('click');
	now += 16; frame();
	if (log.captured.bg[3] !== 0) L.fail('trails off: bg mode ' + log.captured.bg[3] + ', want 0');

	/* ---- Arm Tint Toggle Gate ---- */
	if (log.captured.diskCam[14] !== 1) L.fail('Arm Tint ships on, got ' + log.captured.diskCam[14]);
	els['btn-tint'].fire('click');
	now += 16; frame();
	if (log.captured.diskCam[14] !== 0) L.fail('Arm Tint off, got ' + log.captured.diskCam[14]);
	els['btn-tint'].fire('click');
	now += 16; frame();
	if (log.captured.diskCam[14] !== 1) L.fail('Arm Tint back on, got ' + log.captured.diskCam[14]);

	/* ---- Slow Field Toggle Gate ---- */
	log.fieldInst = 0;
	now += 16; frame();
	if (log.fieldInst !== 0) L.fail('field hidden but drew ' + log.fieldInst + ' instances');
	els['btn-field'].fire('click');
	now += 16; frame();
	if (log.fieldInst !== 1500 * 14) L.fail('field on: ' + log.fieldInst + ' instances, want 1500x14');
	els['btn-field'].fire('click');
	now += 16; frame();

	/* ---- Color Preservation Mathematical Proof (Stars do NOT turn white above 255) ---- */
	function evaluateGrade(r, g, b, exp, sat, headroom) {
		var cr = r * exp, cg = g * exp, cb = b * exp;
		var lum = cr * 0.2126 + cg * 0.7152 + cb * 0.0722;
		var sr = Math.max(0, lum + (cr - lum) * sat);
		var sg = Math.max(0, lum + (cg - lum) * sat);
		var sb = Math.max(0, lum + (cb - lum) * sat);
		var peak = Math.max(sr, Math.max(sg, sb));
		var H = Math.max(headroom || 4.0, 0.5);
		// Smooth Michaelis-Menten / rational curve matching inverseSqrt WGSL:
		var mappedPeak = (peak * H) / Math.sqrt(H * H + peak * peak);
		var scale = peak > 0 ? mappedPeak / peak : 1.0;
		return [sr * scale, sg * scale, sb * scale];
	}

	// 1. Hot Pink Arm Jam Star: (1.0, 0.55, 0.78)
	// Even at 100x brightness (well above 255), R > B > G, never white!
	var pinkSDR = evaluateGrade(1.0, 0.55, 0.78, 1.0, 1.0, 4.0);
	var pinkHDR = evaluateGrade(1.0, 0.55, 0.78, 100.0, 1.0, 4.0);
	if (pinkHDR[0] <= pinkHDR[1] || pinkHDR[2] <= pinkHDR[1])
		L.fail('pink star lost color ratio at high brightness: ' + pinkHDR);
	if (Math.abs(pinkHDR[0] - pinkHDR[1]) < 0.2)
		L.fail('pink star bleached towards white at high brightness: ' + pinkHDR);

	// 2. Cyan-Blue Disk Star: (0.71, 0.82, 1.0)
	// Even at 100x brightness, B > G > R, never white!
	var blueHDR = evaluateGrade(0.71, 0.82, 1.0, 100.0, 1.0, 4.0);
	if (blueHDR[2] <= blueHDR[1] || blueHDR[1] <= blueHDR[0])
		L.fail('blue star lost color ratio at high brightness: ' + blueHDR);

	// 3. Amber Bulge Star: (1.0, 0.78, 0.39)
	// Even at 100x brightness, R > G > B, never white!
	var bulgeHDR = evaluateGrade(1.0, 0.78, 0.39, 100.0, 1.0, 4.0);
	if (bulgeHDR[0] <= bulgeHDR[1] || bulgeHDR[1] <= bulgeHDR[2])
		L.fail('bulge star lost color ratio at high brightness: ' + bulgeHDR);

	/* ---- Replay & PNG generation if requested ---- */
	var SC = 900, SH = 700;
	var replayFb = new Float32Array(SC * SH * 3);

	function replayScene() {
		var fb = replayFb, i, x, y, o;
		fb.fill(0);

		// Background
		var glowR = Math.min(SC, SH) * 0.15;
		for (y = 0; y < SH; y++) {
			for (x = 0; x < SC; x++) {
				o = (y * SC + x) * 3;
				var dx = x - SC / 2, dy = y - SH / 2;
				var d1 = Math.sqrt(dx * dx + dy * dy) / Math.max(SC, SH);
				d1 = Math.min(1, Math.max(0, d1));
				var bgR = 0.03922 + (0.00784 - 0.03922) * d1;
				var bgG = 0.01961 + (0.00392 - 0.01961) * d1;
				var bgB = 0.07059 + (0.03137 - 0.07059) * d1;

				var d2 = Math.sqrt(dx * dx + dy * dy) / glowR;
				var gcol, ga;
				if (d2 < 0.3) {
					var t = d2 / 0.3;
					gcol = [1.0, 0.86275 + (0.58824 - 0.86275) * t, 0.58824 + (0.39216 - 0.58824) * t];
					ga = 0.5 + (0.15 - 0.5) * t;
				} else if (d2 < 1.0) {
					var t2 = (d2 - 0.3) / 0.7;
					gcol = [1.0, 0.58824 + (0.39216 - 0.58824) * t2, 0.39216 + (0.19608 - 0.39216) * t2];
					ga = 0.15 * (1.0 - t2);
				} else {
					gcol = [0, 0, 0];
					ga = 0;
				}
				fb[o]     = gcol[0] * ga + bgR * (1 - ga);
				fb[o + 1] = gcol[1] * ga + bgG * (1 - ga);
				fb[o + 2] = gcol[2] * ga + bgB * (1 - ga);
			}
		}

		// Bulge Stars
		var bth = log.captured.bulgeTheta, baA = log.captured.bulgeStatic;
		var bcam = log.captured.bulgeCam;
		var NB = bcam[13];
		for (i = 0; i < 4000; i++) {
			var th = bth[i];
			var rho = baA[i * 5] * (1.0 + bcam[12] * baA[i * 5 + 1] * Math.cos(th - baA[i * 5 + 2]));
			var x0 = rho * Math.cos(th), y0 = rho * Math.sin(th);
			var cO = Math.cos(baA[i * 5 + 3]), sO = Math.sin(baA[i * 5 + 3]);
			var x1 = x0 * cO - y0 * sO, y1 = x0 * sO + y0 * cO;
			var cI = Math.cos(baA[i * 5 + 4]), sI = Math.sin(baA[i * 5 + 4]);
			var px = x1, py = y1 * cI, pz = y1 * sI;
			var rx = px * bcam[0] - py * bcam[1], ry = px * bcam[1] + py * bcam[0];
			var pjy = ry * bcam[2] - pz * bcam[3], pjz = ry * bcam[3] + pz * bcam[2];
			var ps = bcam[7] / (bcam[7] + pjz);
			var sx = SC / 2 + rx * bcam[4] * ps, sy = SH / 2 - pjy * bcam[4] * ps;
			var rad = (NB * Math.max(ps, 0.2)) * 0.5;
			var xa = Math.max(0, Math.floor(sx - rad)), xb = Math.min(SC - 1, Math.ceil(sx + rad));
			var ya = Math.max(0, Math.floor(sy - rad)), yb = Math.min(SH - 1, Math.ceil(sy + rad));
			var alphaBase = 0.8 * ps;
			for (y = ya; y <= yb; y++) {
				for (x = xa; x <= xb; x++) {
					var qx = (x - sx) / rad, qy = (y - sy) / rad;
					var r2 = qx * qx + qy * qy;
					if (r2 > 1.0) continue;
					var r_dist = Math.sqrt(r2);
					var falloff = r_dist < 0.5 ? 1.0 - 0.6 * (r_dist * 2.0) : 0.4 * (1.0 - (r_dist * 2.0 - 1.0));
					var a_val = alphaBase * falloff;
					o = (y * SC + x) * 3;
					fb[o]     += 1.0 * a_val;
					fb[o + 1] += 0.78431 * a_val;
					fb[o + 2] += 0.39216 * a_val;
				}
			}
		}

		// Disk Stars
		var dth = log.captured.diskTheta, daA = log.captured.diskStatic;
		var dcam = log.captured.diskCam;
		var ND = dcam[13];
		for (i = 0; i < 15000; i++) {
			var th_d = dth[i];
			var rho_d = daA[i * 6] * (1.0 + dcam[12] * daA[i * 6 + 1] * Math.cos(th_d - daA[i * 6 + 2]));
			var px_d = rho_d * Math.cos(th_d), py_d = rho_d * Math.sin(th_d);
			var pz_d = daA[i * 6 + 4] * Math.sin(2.0 * th_d + daA[i * 6 + 5]);
			var rx_d = px_d * dcam[0] - py_d * dcam[1], ry_d = px_d * dcam[1] + py_d * dcam[0];
			var pjy_d = ry_d * dcam[2] - pz_d * dcam[3], pjz_d = ry_d * dcam[3] + pz_d * dcam[2];
			var ps_d = dcam[7] / (dcam[7] + pjz_d);
			var sx_d = SC / 2 + rx_d * dcam[4] * ps_d, sy_d = SH / 2 - pjy_d * dcam[4] * ps_d;

			var dth_arm = (th_d - (Math.log(rho_d) / dcam[8] + dcam[9])) % dcam[10];
			if (dth_arm < 0) dth_arm += dcam[10];
			if (dth_arm > dcam[10] * 0.5) dth_arm -= dcam[10];
			var D = Math.exp(-dth_arm * dth_arm * dcam[11]);
			var b = daA[i * 6 + 3] * (0.4 + ps_d * 0.6);
			var inArm = D >= 0.4 ? 1.0 : 0.0;
			var colR = 0.70588 + (1.0 - 0.70588) * inArm;
			var colG = 0.82353 + (0.54902 - 0.82353) * inArm;
			var colB = 1.0 + (0.78431 - 1.0) * inArm;
			var aTint = inArm ? D * b : (1.0 - D) * b * 0.8;
			var alpha_d = aTint;

			var rad_d = (ND * Math.max(ps_d, 0.2)) * 0.5;
			var xa_d = Math.max(0, Math.floor(sx_d - rad_d)), xb_d = Math.min(SC - 1, Math.ceil(sx_d + rad_d));
			var ya_d = Math.max(0, Math.floor(sy_d - rad_d)), yb_d = Math.min(SH - 1, Math.ceil(sy_d + rad_d));
			for (y = ya_d; y <= yb_d; y++) {
				for (x = xa_d; x <= xb_d; x++) {
					var qx_d = (x - sx_d) / rad_d, qy_d = (y - sy_d) / rad_d;
					var r2_d = qx_d * qx_d + qy_d * qy_d;
					if (r2_d > 1.0) continue;
					var r_dist_d = Math.sqrt(r2_d);
					var fall_d = r_dist_d < 0.5 ? 1.0 - 0.6 * (r_dist_d * 2.0) : 0.4 * (1.0 - (r_dist_d * 2.0 - 1.0));
					var a_fin = alpha_d * fall_d;
					o = (y * SC + x) * 3;
					fb[o]     += colR * a_fin;
					fb[o + 1] += colG * a_fin;
					fb[o + 2] += colB * a_fin;
				}
			}
		}
		return fb;
	}

	function presentFrame(ev, raw, sat, headroom) {
		sat = sat !== undefined ? sat : 1.0;
		headroom = headroom !== undefined ? headroom : 1.0;
		var fb = replayFb, y, x, o, p = 0;
		var exp = GAIN * Math.pow(2, ev);
		for (y = 0; y < SH; y++) {
			raw[p++] = 0; // PNG filter byte
			for (x = 0; x < SC; x++) {
				o = (y * SC + x) * 3;
				var rgb = evaluateGrade(fb[o], fb[o + 1], fb[o + 2], exp, sat, headroom);
				// clamp to 0..255 for standard 8-bit PNG preview inspection
				raw[p++] = Math.round(255 * Math.min(1.0, Math.max(0.0, rgb[0])));
				raw[p++] = Math.round(255 * Math.min(1.0, Math.max(0.0, rgb[1])));
				raw[p++] = Math.round(255 * Math.min(1.0, Math.max(0.0, rgb[2])));
			}
		}
	}

	function writePng(file, raw, w, h) {
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
		presentFrame(0, raw, 1.0);
		writePng(path.join(__dirname, 'logs', 'hdr-simple-webgpu-default.png'), raw, SC, SH);

		presentFrame(1.5, raw, 1.2);
		writePng(path.join(__dirname, 'logs', 'hdr-simple-webgpu-high-ev.png'), raw, SC, SH);
	}

	if (WANT_STATS) {
		var fb = replayScene(), y, x, o;
		var core = [], arms = [], maxAll = 0;
		for (y = 0; y < SH; y++) {
			for (x = 0; x < SC; x++) {
				o = (y * SC + x) * 3;
				var rp = Math.sqrt((x - SC / 2) * (x - SC / 2) + (y - SH / 2) * (y - SH / 2));
				var lm = fb[o] * 0.2126 + fb[o + 1] * 0.7152 + fb[o + 2] * 0.0722;
				if (lm > maxAll) maxAll = lm;
				if (rp < 40) core.push(lm);
				else if (rp > 120 && rp < 300) arms.push(lm);
			}
		}
		function quant(arr, q) {
			var s = arr.slice().sort(function(a, b) { return a - b; });
			return s[Math.min(s.length - 1, Math.floor(s.length * q))];
		}
		console.log('scene luma (EV 0, gain 1.5): core med', (quant(core, 0.5) * 1.5).toFixed(3),
			'p99', (quant(core, 0.99) * 1.5).toFixed(2),
			'| arm annulus med', (quant(arms, 0.5) * 1.5).toFixed(4), 'p90', (quant(arms, 0.9) * 1.5).toFixed(3),
			'p99', (quant(arms, 0.99) * 1.5).toFixed(3), 'max', (maxAll * 1.5).toFixed(2));
		for (var evs = 2; evs >= -2; evs -= 1.0) {
			var e = 1.5 * Math.pow(2, evs);
			var cMed = evaluateGrade(quant(core, 0.5), quant(core, 0.5) * 0.8, quant(core, 0.5) * 0.4, e, 1.0, 4.0);
			var aP90 = evaluateGrade(quant(arms, 0.9) * 1.1, quant(arms, 0.9) * 0.6, quant(arms, 0.9) * 0.9, e, 1.0, 4.0);
			console.log('EV ' + (evs >= 0 ? '+' : '') + evs.toFixed(1) + ': core med R=' + cMed[0].toFixed(2) + ' G=' + cMed[1].toFixed(2) + ' B=' + cMed[2].toFixed(2) +
				' | arm p90 R=' + aP90[0].toFixed(2) + ' G=' + aP90[1].toFixed(2) + ' B=' + aP90[2].toFixed(2));
		}
	}

	L.pass('smoke-simple-webgpu: page runs, float WebGPU HDR pipeline, sliders, color-preserved stars');
})().catch(function(e) {
	L.fail('smoke-simple-webgpu error: ' + (e && e.stack || e));
});
