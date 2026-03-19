/**
 * Multi-worm simulation with connectome-driven behavior.
 * Features:
 * - Eye sensing connected to neuron stimulation
 * - Weapon system for yellow threat dots
 * - Birth/death lifecycle with corpse persistence and scavenging
 */

var food = [];
var bullets = [];
var worms = [];
var nextWormId = 1;

var CONFIG = {
	brainTickMs: 220,
	initialWormCount: 2,
	maxWorms: 24,
	initialFoodCount: 40,
	foodRadius: 10,
	eatRadius: 20,
	corpseEatRadius: 24,
	corpseMass: 70,
	energyFromFood: 18,
	energyFromCorpsePerSec: 20,
	reproductionEnergyMin: 85,
	reproductionCost: 40,
	reproductionIntervalMinMs: 7000,
	reproductionIntervalMaxMs: 14000,
	lifespanMinMs: 335000,
	lifespanMaxMs: 380000,
	matingDistance: 34,
	mateSeekRange: 220,
	bulletSpeed: 520,
	bulletTTLms: 1300,
	bulletRadius: 3,
	bulletHitRadius: 11,
};

function randRange(min, max) {
	return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function angleDiff(a, b) {
	var d = a - b;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	return d;
}

function circle(ctx, x, y, r, c) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2, false);
	ctx.closePath();
	if (c) {
		ctx.fillStyle = c;
		ctx.fill();
	} else {
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.stroke();
	}
}

var IKSegment = function (size, head, tail) {
	this.size = size;
	this.head = head || { x: 0.0, y: 0.0 };
	this.tail = tail || {
		x: this.head.x + size,
		y: this.head.y + size,
	};

	this.update = function () {
		var dx = this.head.x - this.tail.x;
		var dy = this.head.y - this.tail.y;
		var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
		var force = 0.5 - (this.size / dist) * 0.5;
		var strength = 0.998;
		force *= 0.99;
		var fx = force * dx;
		var fy = force * dy;
		this.tail.x += fx * strength * 2.0;
		this.tail.y += fy * strength * 2.0;
		this.head.x -= fx * (1.0 - strength) * 2.0;
		this.head.y -= fy * (1.0 - strength) * 2.0;
	};
};

var IKChain = function (size, interval, anchor) {
	this.links = new Array(size);

	this.update = function (target) {
		var link = this.links[0];
		link.head.x = target.x;
		link.head.y = target.y;
		for (var i = 0, n = this.links.length; i < n; ++i) {
			this.links[i].update();
		}
	};

	var point = { x: anchor.x, y: anchor.y };
	for (var i = 0, n = this.links.length; i < n; ++i) {
		var link = (this.links[i] = new IKSegment(interval, point));
		link.head.x = anchor.x - i * interval;
		link.head.y = anchor.y;
		link.tail.x = anchor.x - (i + 1) * interval;
		link.tail.y = anchor.y;
		point = link.tail;
	}
};

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

canvas.addEventListener('mousedown', addFood, false);

document.getElementById('clearButton').onclick = function () {
	food = [];
	bullets = [];
};

document.getElementById('centerButton').onclick = function () {
	var centerX = window.innerWidth / 2;
	var centerY = window.innerHeight / 2;
	for (var i = 0; i < worms.length; i++) {
		if (!worms[i].isDead) {
			worms[i].target.x = centerX + (i % 2 === 0 ? -35 : 35);
			worms[i].target.y = centerY + (i % 2 === 0 ? -18 : 18);
		}
	}
};

function toggleConnectome() {
	document.getElementById('nodeHolder').style.opacity =
		document.getElementById('connectomeCheckbox').checked ? '1' : '0';
}

BRAIN.setup();

for (var ps in BRAIN.connectome) {
	var nameBox = document.createElement('span');
	document.getElementById('nodeHolder').appendChild(nameBox);
	var newBox = document.createElement('span');
	newBox.cols = 3;
	newBox.rows = 1;
	newBox.id = ps;
	newBox.className = 'brainNode';
	document.getElementById('nodeHolder').appendChild(newBox);
}

function getNeuron(brain, name) {
	if (!brain.postSynaptic[name]) return 0;
	return brain.postSynaptic[name][brain.thisState] || 0;
}

function scheduleBirth(now) {
	return (
		now +
		randRange(
			CONFIG.reproductionIntervalMinMs,
			CONFIG.reproductionIntervalMaxMs,
		)
	);
}

function createWorm(options) {
	var now = performance.now();
	var x = options && options.x !== undefined ? options.x : randRange(120, window.innerWidth - 120);
	var y = options && options.y !== undefined ? options.y : randRange(120, window.innerHeight - 120);
	var heading = options && options.heading !== undefined ? options.heading : randRange(0, Math.PI * 2);
	var lifespan = options && options.lifespanMs ? options.lifespanMs : randRange(CONFIG.lifespanMinMs, CONFIG.lifespanMaxMs);
	var visionRange = options && options.visionRange ? options.visionRange : randRange(140, 260);
	var fireCooldownMs = options && options.fireCooldownMs ? options.fireCooldownMs : randRange(250, 520);
	var bodyLength = options && options.bodyLength ? options.bodyLength : Math.floor(randRange(90, 150));

	var worm = {
		id: nextWormId++,
		brain: BRAIN.createInstance(),
		target: { x: x, y: y },
		chain: new IKChain(bodyLength, 1.1, { x: x, y: y }),
		facingDir: heading,
		targetDir: heading,
		speed: 0,
		targetSpeed: 0,
		speedChangeInterval: 0,
		brainElapsedMs: 0,
		brainTickMs: randRange(CONFIG.brainTickMs * 0.8, CONFIG.brainTickMs * 1.25),
		visionRange: visionRange,
		fov: randRange(Math.PI * 0.45, Math.PI * 0.85),
		fireCooldownMs: fireCooldownMs,
		lastShotMs: 0,
		energy: randRange(60, 100),
		birthMs: now,
		lifespanMs: lifespan,
		nextBirthMs: scheduleBirth(now),
		isDead: false,
		deathMs: null,
		corpseMass: 0,
		lastThreat: null,
	};

	worm.brain.randExcite();
	return worm;
}

function spawnFoodRandom(count) {
	for (var i = 0; i < count; i++) {
		food.push({
			x: randRange(25, window.innerWidth - 25),
			y: randRange(25, window.innerHeight - 25),
		});
	}
}

function addFood(event) {
	var x = event.x - canvas.offsetLeft;
	var y = event.y - canvas.offsetTop;
	food.push({ x: x, y: y });
}

function findNearestVisibleFood(worm) {
	var best = null;
	for (var i = 0; i < food.length; i++) {
		var dx = food[i].x - worm.target.x;
		var dy = food[i].y - worm.target.y;
		var dist = Math.sqrt(dx * dx + dy * dy);
		if (dist > worm.visionRange) continue;
		var dir = Math.atan2(-dy, dx);
		var diff = Math.abs(angleDiff(worm.facingDir, dir));
		if (diff > worm.fov * 0.5) continue;
		if (!best || dist < best.dist) {
			best = {
				index: i,
				x: food[i].x,
				y: food[i].y,
				dist: dist,
				dir: dir,
			};
		}
	}
	return best;
}

function maybeShoot(worm, threat, now) {
	if (!threat) return;
	if (now - worm.lastShotMs < worm.fireCooldownMs) return;

	var decision =
		(getNeuron(worm.brain, 'AVAL') +
			getNeuron(worm.brain, 'AVAR') +
			getNeuron(worm.brain, 'AVBL') +
			getNeuron(worm.brain, 'AVBR')) /
		120;
	var proximityBoost = 1 - clamp(threat.dist / worm.visionRange, 0, 1);
	if (decision + proximityBoost < 0.95) return;

	var aimDir = threat.dir + randRange(-0.09, 0.09);
	var muzzleX = worm.target.x + Math.cos(aimDir) * 14;
	var muzzleY = worm.target.y - Math.sin(aimDir) * 14;

	bullets.push({
		x: muzzleX,
		y: muzzleY,
		vx: Math.cos(aimDir) * CONFIG.bulletSpeed,
		vy: -Math.sin(aimDir) * CONFIG.bulletSpeed,
		ttlMs: CONFIG.bulletTTLms,
		ownerId: worm.id,
	});

	worm.lastShotMs = now;
	worm.energy = Math.max(0, worm.energy - 3);
}

function killWorm(worm, now) {
	if (worm.isDead) return;
	worm.isDead = true;
	worm.speed = 0;
	worm.targetSpeed = 0;
	worm.speedChangeInterval = 0;
	worm.deathMs = now;
	worm.corpseMass = CONFIG.corpseMass;
}

function isReadyToMate(worm, now) {
	return (
		!worm.isDead &&
		worm.energy >= CONFIG.reproductionEnergyMin &&
		now >= worm.nextBirthMs
	);
}

function findMateFor(worm, now, maxDistance, requireReady) {
	var bestMate = null;
	for (var i = 0; i < worms.length; i++) {
		var mate = worms[i];
		if (mate.id === worm.id || mate.isDead) continue;
		if (requireReady && !isReadyToMate(mate, now)) continue;
		var dist = Math.hypot(worm.target.x - mate.target.x, worm.target.y - mate.target.y);
		if (dist > maxDistance) continue;
		if (!bestMate || dist < bestMate.dist) {
			bestMate = { worm: mate, dist: dist };
		}
	}
	return bestMate;
}

function tryReproduce(worm, now) {
	if (worms.length >= CONFIG.maxWorms) return;
	if (!isReadyToMate(worm, now)) return;

	var mateInfo = findMateFor(worm, now, CONFIG.matingDistance, true);
	if (!mateInfo) return;
	var mate = mateInfo.worm;

	// Prevent both partners from spawning duplicate children in the same frame.
	if (worm.id > mate.id) return;

	var child = createWorm({
		x: (worm.target.x + mate.target.x) * 0.5 + randRange(-18, 18),
		y: (worm.target.y + mate.target.y) * 0.5 + randRange(-18, 18),
		heading: ((worm.facingDir + mate.facingDir) * 0.5) + randRange(-0.7, 0.7),
		lifespanMs: clamp(
			((worm.lifespanMs + mate.lifespanMs) * 0.5) * randRange(0.88, 1.18),
			CONFIG.lifespanMinMs,
			CONFIG.lifespanMaxMs * 1.3,
		),
		visionRange: clamp(
			((worm.visionRange + mate.visionRange) * 0.5) * randRange(0.9, 1.1),
			110,
			300,
		),
		fireCooldownMs: clamp(
			((worm.fireCooldownMs + mate.fireCooldownMs) * 0.5) * randRange(0.8, 1.2),
			140,
			900,
		),
		bodyLength: Math.floor(
			clamp(
				((worm.chain.links.length + mate.chain.links.length) * 0.5) + randRange(-10, 10),
				70,
				190,
			),
		),
	});

	worms.push(child);
	worm.energy -= CONFIG.reproductionCost;
	mate.energy -= CONFIG.reproductionCost;
	worm.nextBirthMs = scheduleBirth(now);
	mate.nextBirthMs = scheduleBirth(now);
}

function eatNearbyFood(worm) {
	for (var i = food.length - 1; i >= 0; i--) {
		var dist = Math.hypot(worm.target.x - food[i].x, worm.target.y - food[i].y);
		if (dist <= CONFIG.eatRadius) {
			food.splice(i, 1);
			worm.energy = Math.min(120, worm.energy + CONFIG.energyFromFood);
		}
	}
}

function scavengeCorpses(worm, dtSec) {
	for (var i = 0; i < worms.length; i++) {
		var corpse = worms[i];
		if (!corpse.isDead || corpse.corpseMass <= 0 || corpse.id === worm.id) continue;
		var dist = Math.hypot(worm.target.x - corpse.target.x, worm.target.y - corpse.target.y);
		if (dist <= CONFIG.corpseEatRadius) {
			var bite = Math.min(corpse.corpseMass, CONFIG.energyFromCorpsePerSec * dtSec);
			corpse.corpseMass -= bite;
			worm.energy = Math.min(120, worm.energy + bite * 0.8);
		}
	}
}

function updateWorm(worm, dtSec, now) {
	if (worm.isDead) {
		worm.chain.update(worm.target);
		return;
	}

	if (now - worm.birthMs >= worm.lifespanMs || worm.energy <= 0) {
		killWorm(worm, now);
		worm.chain.update(worm.target);
		return;
	}

	worm.brainElapsedMs += dtSec * 1000;

	var threat = findNearestVisibleFood(worm);
	worm.lastThreat = threat;
	worm.brain.stimulateFoodSenseNeurons = !!threat;
	worm.brain.stimulateVisionNeurons = !!threat;
	worm.brain.stimulateThreatNeurons = !!threat && threat.dist < worm.visionRange * 0.75;

	if (worm.brainElapsedMs >= worm.brainTickMs) {
		worm.brainElapsedMs = 0;
		worm.brain.update();

		var scalingFactor = 20;
		var newDir = (worm.brain.accumleft - worm.brain.accumright) / scalingFactor;
		worm.targetDir = worm.facingDir + newDir * Math.PI;
		worm.targetSpeed =
			(Math.abs(worm.brain.accumleft) + Math.abs(worm.brain.accumright)) /
			(scalingFactor * 5);
		worm.speedChangeInterval = (worm.targetSpeed - worm.speed) / (scalingFactor * 1.5);

		maybeShoot(worm, threat, now);
	}

	if (!threat && isReadyToMate(worm, now)) {
		var mateInfo = findMateFor(worm, now, CONFIG.mateSeekRange, true);
		if (mateInfo) {
			var mateDir = Math.atan2(
				-(mateInfo.worm.target.y - worm.target.y),
				mateInfo.worm.target.x - worm.target.x,
			);
			worm.targetDir = mateDir;
			worm.targetSpeed = Math.max(worm.targetSpeed, 1.2);
		}
	}

	worm.speed += worm.speedChangeInterval;
	worm.speed = clamp(worm.speed, -1.5, 2.7);

	var diff = angleDiff(worm.facingDir, worm.targetDir);
	if (diff > 0.03) worm.facingDir -= 0.1;
	else if (diff < -0.03) worm.facingDir += 0.1;

	worm.target.x += Math.cos(worm.facingDir) * worm.speed;
	worm.target.y -= Math.sin(worm.facingDir) * worm.speed;

	var touchedWall = false;
	if (worm.target.x < 0) {
		worm.target.x = 0;
		touchedWall = true;
	} else if (worm.target.x > window.innerWidth) {
		worm.target.x = window.innerWidth;
		touchedWall = true;
	}
	if (worm.target.y < 0) {
		worm.target.y = 0;
		touchedWall = true;
	} else if (worm.target.y > window.innerHeight) {
		worm.target.y = window.innerHeight;
		touchedWall = true;
	}
	worm.brain.stimulateNoseTouchNeurons = touchedWall;

	eatNearbyFood(worm);
	scavengeCorpses(worm, dtSec);
	tryReproduce(worm, now);

	worm.energy -= dtSec * 2.3;
	worm.chain.update(worm.target);
}

function updateBullets(dtSec) {
	for (var i = bullets.length - 1; i >= 0; i--) {
		var b = bullets[i];
		b.x += b.vx * dtSec;
		b.y += b.vy * dtSec;
		b.ttlMs -= dtSec * 1000;

		var remove = b.ttlMs <= 0;
		if (!remove) {
			for (var f = food.length - 1; f >= 0; f--) {
				if (Math.hypot(b.x - food[f].x, b.y - food[f].y) <= CONFIG.bulletHitRadius) {
					food.splice(f, 1);
					remove = true;
					break;
				}
			}
		}

		if (!remove) {
			if (b.x < -10 || b.y < -10 || b.x > canvas.width + 10 || b.y > canvas.height + 10) {
				remove = true;
			}
		}

		if (remove) bullets.splice(i, 1);
	}
}

function cleanupConsumedCorpses() {
	for (var i = worms.length - 1; i >= 0; i--) {
		if (worms[i].isDead && worms[i].corpseMass <= 0) {
			worms.splice(i, 1);
		}
	}
}

function drawFood() {
	for (var i = 0; i < food.length; i++) {
		circle(ctx, food[i].x, food[i].y, CONFIG.foodRadius, 'rgb(251,192,45)');
	}
}

function drawBullets() {
	for (var i = 0; i < bullets.length; i++) {
		circle(ctx, bullets[i].x, bullets[i].y, CONFIG.bulletRadius, 'rgba(255,80,40,0.95)');
	}
}

function drawWormBody(worm) {
	var link = worm.chain.links[0];
	var p1 = link.head;
	var p2 = link.tail;

	ctx.beginPath();
	ctx.moveTo(p1.x, p1.y);
	ctx.strokeStyle = worm.isDead ? 'rgba(145,145,145,0.85)' : 'white';
	ctx.lineWidth = worm.isDead ? 14 : 18;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	for (var i = 0, n = worm.chain.links.length; i < n; ++i) {
		link = worm.chain.links[i];
		p1 = link.head;
		p2 = link.tail;
		ctx.lineTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
	}
	ctx.stroke();
}

function drawEyeAndGun(worm) {
	var head = worm.chain.links[0].head;
	var eyeX = head.x + Math.cos(worm.facingDir) * 5;
	var eyeY = head.y - Math.sin(worm.facingDir) * 5;

	circle(ctx, eyeX, eyeY, 4.2, worm.isDead ? 'rgba(120,120,120,0.95)' : '#fdfdfd');

	if (!worm.isDead) {
		var aim = worm.lastThreat ? worm.lastThreat.dir : worm.facingDir;
		var pupilX = eyeX + Math.cos(aim) * 1.8;
		var pupilY = eyeY - Math.sin(aim) * 1.8;
		circle(ctx, pupilX, pupilY, 1.7, '#111111');

		ctx.beginPath();
		ctx.moveTo(head.x + Math.cos(worm.facingDir) * 7, head.y - Math.sin(worm.facingDir) * 7);
		ctx.lineTo(head.x + Math.cos(worm.facingDir) * 16, head.y - Math.sin(worm.facingDir) * 16);
		ctx.strokeStyle = 'rgba(255,160,30,0.95)';
		ctx.lineWidth = 2.5;
		ctx.stroke();
	}
}

function drawCorpsesInfo(worm) {
	if (!worm.isDead) return;
	ctx.fillStyle = 'rgba(210,210,210,0.75)';
	ctx.font = '11px monospace';
	ctx.fillText('corpse ' + worm.corpseMass.toFixed(0), worm.target.x + 10, worm.target.y - 10);
}

function drawHUD() {
	var alive = 0;
	var corpses = 0;
	for (var i = 0; i < worms.length; i++) {
		if (worms[i].isDead) corpses++;
		else alive++;
	}

	ctx.fillStyle = 'rgba(255,255,255,0.92)';
	ctx.font = '13px monospace';
	ctx.fillText('alive: ' + alive + '   corpses: ' + corpses + '   food: ' + food.length, 14, 22);
}

function draw() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	drawFood();
	drawBullets();

	for (var i = 0; i < worms.length; i++) {
		drawWormBody(worms[i]);
		drawEyeAndGun(worms[i]);
		drawCorpsesInfo(worms[i]);
	}

	drawHUD();
}

function getConnectomeWorm() {
	for (var i = 0; i < worms.length; i++) {
		if (!worms[i].isDead) return worms[i];
	}
	return worms.length ? worms[0] : null;
}

function updateConnectomeUI() {
	var focusWorm = getConnectomeWorm();
	if (!focusWorm) return;
	var brain = focusWorm.brain;

	for (var postSynaptic in BRAIN.connectome) {
		var psBox = document.getElementById(postSynaptic);
		if (!psBox) continue;
		var neuron = brain.postSynaptic[postSynaptic][brain.thisState];
		psBox.style.backgroundColor = '#55FF55';
		psBox.style.opacity = Math.min(1, Math.max(0, neuron / 50));
	}
}

(function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	window.onresize = resize;
})();

(function init() {
	for (var i = 0; i < CONFIG.initialWormCount; i++) {
		worms.push(createWorm());
	}
	spawnFoodRandom(CONFIG.initialFoodCount);
})();

var lastTs = performance.now();
function frame(ts) {
	var dtSec = Math.min(0.05, (ts - lastTs) / 1000);
	lastTs = ts;

	for (var i = 0; i < worms.length; i++) {
		updateWorm(worms[i], dtSec, ts);
	}

	updateBullets(dtSec);
	cleanupConsumedCorpses();

	if (food.length < 12) {
		spawnFoodRandom(1);
	}

	draw();
	requestAnimationFrame(frame);
}

setInterval(updateConnectomeUI, 180);
requestAnimationFrame(frame);
