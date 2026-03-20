/**
 * Team-based worm ecosystem simulation.
 * - Soil terrain with small rock obstacles
 * - Eggs can only be laid if a worm has consumed yellow food
 */

var worms = [];
var bullets = [];
var eggs = [];
var foods = [];
var rocks = [];
var soilDots = [];
var nextWormId = 1;
var nextEggId = 1;
var nextFoodId = 1;

var TEAM_BLUE = 'blue';
var TEAM_RED = 'red';

var CONFIG = {
	brainTickMs: 220,
	maxWorms: 260,
	initialGridSize: 1,
	bodyLengthMin: 90,
	bodyLengthMax: 140,
	visionRangeMin: 150,
	visionRangeMax: 260,
	fireCooldownMinMs: 180,
	fireCooldownMaxMs: 420,
	bulletSpeed: 620,
	bulletTTLms: 950,
	bulletRadius: 3,
	bulletHitRadius: 11,
	bulletDamage: 5,
	wormMaxHp: 500,
	lifespanMinMs: 1000 * 60 * 60 * 24,
	lifespanMaxMs: 1000 * 60 * 60 * 36,
	eggLayIntervalMs: 1000 * 60,
	eggHatchDelayMs: 1000 * 60,
	eggLayJitterMinMs: 1000 * 12,
	eggLayJitterMaxMs: 1000 * 28,
	eggMinHpToLay: 180,
	eggLayHpCost: 35,
	maxEggsPerTeam: 80,
	teamSoftCap: 110,
	teamHardCap: 130,
	safeZoneRegenPerSec: 4,
	enemyZoneDrainPerSec: 7,
	overcrowdRadius: 45,
	overcrowdThreshold: 6,
	overcrowdDamagePerSec: 3,
	corpseMass: 95,
	corpseEatRadius: 24,
	corpseHealPerSec: 24,
	raidMinMs: 14000,
	raidMaxMs: 30000,
	raidCooldownMinMs: 28000,
	raidCooldownMaxMs: 90000,
	terrainPadding: 28,
	rockCount: 74,
	rockMinRadius: 6,
	rockMaxRadius: 18,
	soilDotCount: 460,
	foodMaxCount: 38,
	foodSpawnIntervalMs: 1200,
	foodEatRadius: 16,
	foodSenseRange: 220,
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

function randInt(maxExclusive) {
	return Math.floor(Math.random() * maxExclusive);
}

function buildTerrain() {
	var padding = CONFIG.terrainPadding;
	rocks = [];
	soilDots = [];

	for (var i = 0; i < CONFIG.soilDotCount; i++) {
		soilDots.push({
			x: randRange(0, canvas.width),
			y: randRange(0, canvas.height),
			r: randRange(0.8, 2.1),
			a: randRange(0.08, 0.24),
		});
	}

	for (var r = 0; r < CONFIG.rockCount; r++) {
		var added = false;
		for (var t = 0; t < 80 && !added; t++) {
			var rr = randRange(CONFIG.rockMinRadius, CONFIG.rockMaxRadius);
			var rock = {
				x: randRange(padding + rr, canvas.width - padding - rr),
				y: randRange(padding + rr, canvas.height - padding - rr),
				r: rr,
			};
			var conflict = false;
			for (var k = 0; k < rocks.length; k++) {
				var other = rocks[k];
				if (Math.hypot(rock.x - other.x, rock.y - other.y) < rock.r + other.r + 9) {
					conflict = true;
					break;
				}
			}
			if (!conflict) {
				rocks.push(rock);
				added = true;
			}
		}
	}
}

function collidesRockCircle(x, y, radius) {
	for (var i = 0; i < rocks.length; i++) {
		if (Math.hypot(x - rocks[i].x, y - rocks[i].y) < radius + rocks[i].r) return true;
	}
	return false;
}

function findNearestFood(worm, maxDist) {
	var best = null;
	var limit = maxDist || CONFIG.foodSenseRange;
	for (var i = 0; i < foods.length; i++) {
		var food = foods[i];
		var dist = Math.hypot(food.x - worm.target.x, food.y - worm.target.y);
		if (dist > limit) continue;
		if (!best || dist < best.dist) {
			best = { food: food, dist: dist };
		}
	}
	return best;
}

function randomWalkablePoint(maxTry) {
	var tries = maxTry || 180;
	var pad = CONFIG.terrainPadding;
	for (var i = 0; i < tries; i++) {
		var x = randRange(pad, canvas.width - pad);
		var y = randRange(pad, canvas.height - pad);
		if (!collidesRockCircle(x, y, 12)) return { x: x, y: y };
	}
	return {
		x: randRange(pad, canvas.width - pad),
		y: randRange(pad, canvas.height - pad),
	};
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

function boundaryX() {
	return canvas.width * 0.5;
}

function teamColor(team, dead) {
	if (dead) return 'rgba(140,140,140,0.9)';
	return team === TEAM_BLUE ? 'rgba(76,168,255,0.96)' : 'rgba(255,95,95,0.96)';
}

function teamAccent(team) {
	return team === TEAM_BLUE ? 'rgba(88,200,255,0.95)' : 'rgba(255,170,88,0.95)';
}

function isInHomeZone(worm) {
	if (worm.team === TEAM_BLUE) return worm.target.x <= boundaryX();
	return worm.target.x >= boundaryX();
}

function isInEnemyZone(worm) {
	return !isInHomeZone(worm);
}

function safeZoneCenter(team) {
	var x = team === TEAM_BLUE ? canvas.width * 0.25 : canvas.width * 0.75;
	return { x: x, y: canvas.height * 0.5 };
}

function enemyZoneCenter(team) {
	return safeZoneCenter(team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE);
}

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

function createWorm(options) {
	var now = performance.now();
	var team = options.team;
	var x = options.x;
	var y = options.y;
	var heading = options.heading !== undefined ? options.heading : randRange(0, Math.PI * 2);
	var bodyLength =
		options.bodyLength !== undefined
			? options.bodyLength
			: Math.floor(randRange(CONFIG.bodyLengthMin, CONFIG.bodyLengthMax));

	var worm = {
		id: nextWormId++,
		team: team,
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
		visionRange: options.visionRange || randRange(CONFIG.visionRangeMin, CONFIG.visionRangeMax),
		fov: randRange(Math.PI * 0.45, Math.PI * 0.85),
		fireCooldownMs:
			options.fireCooldownMs || randRange(CONFIG.fireCooldownMinMs, CONFIG.fireCooldownMaxMs),
		lastShotMs: 0,
		birthMs: now,
		lifespanMs:
			options.lifespanMs || randRange(CONFIG.lifespanMinMs, CONFIG.lifespanMaxMs),
		hp: CONFIG.wormMaxHp,
		isDead: false,
		deathMs: null,
		corpseMass: 0,
		lastThreat: null,
		foodCharges: 0,
		nextEggMs: scheduleNextEgg(now),
		raidUntilMs: now + randRange(5000, 15000),
		nextRaidMs: now + randRange(CONFIG.raidCooldownMinMs, CONFIG.raidCooldownMaxMs),
	};

	worm.brain.randExcite();
	return worm;
}

function spawnTeamGrid(team) {
	var size = CONFIG.initialGridSize;

	for (var row = 0; row < size; row++) {
		for (var col = 0; col < size; col++) {
			var p = randomWalkablePoint();
			worms.push(
				createWorm({
					team: team,
					x: clamp(p.x, 24, canvas.width - 24),
					y: clamp(p.y, 24, canvas.height - 24),
					heading: team === TEAM_BLUE ? 0 : Math.PI,
				}),
			);
		}
	}
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

function layEgg(worm, now) {
	eggs.push({
		id: nextEggId++,
		team: worm.team,
		x: worm.target.x + randRange(-10, 10),
		y: worm.target.y + randRange(-10, 10),
		laidAtMs: now,
		hatchAtMs: now + CONFIG.eggHatchDelayMs,
	});
}

function aliveCountByTeam(team) {
	var count = 0;
	for (var i = 0; i < worms.length; i++) {
		if (!worms[i].isDead && worms[i].team === team) count++;
	}
	return count;
}

function eggCountByTeam(team) {
	var count = 0;
	for (var i = 0; i < eggs.length; i++) {
		if (eggs[i].team === team) count++;
	}
	return count;
}

function scheduleNextEgg(now) {
	return (
		now +
		CONFIG.eggLayIntervalMs +
		randRange(CONFIG.eggLayJitterMinMs, CONFIG.eggLayJitterMaxMs)
	);
}

function tryLayEggWithBalance(worm, now) {
	if (worm.foodCharges <= 0) return false;
	if (worm.hp < CONFIG.eggMinHpToLay) return false;
	if (eggCountByTeam(worm.team) >= CONFIG.maxEggsPerTeam) return false;

	var teamAlive = aliveCountByTeam(worm.team);
	if (teamAlive >= CONFIG.teamHardCap) return false;

	var pressure = clamp(
		(teamAlive - CONFIG.teamSoftCap) /
			Math.max(1, CONFIG.teamHardCap - CONFIG.teamSoftCap),
		0,
		1,
	);
	var layChance = 1 - pressure * 0.8;
	if (Math.random() > layChance) return false;

	layEgg(worm, now);
	worm.foodCharges -= 1;
	worm.hp = Math.max(1, worm.hp - CONFIG.eggLayHpCost);
	return true;
}

function hatchEgg(egg) {
	if (worms.length >= CONFIG.maxWorms) return;
	var teamAlive = aliveCountByTeam(egg.team);
	if (teamAlive >= CONFIG.teamHardCap) return;
	var hatchPoint = randomWalkablePoint(80);
	worms.push(
		createWorm({
			team: egg.team,
			x: clamp(egg.x + randRange(-8, 8), 16, canvas.width - 16),
			y: clamp(egg.y + randRange(-8, 8), 16, canvas.height - 16),
			heading: egg.team === TEAM_BLUE ? randRange(-0.8, 0.8) : randRange(Math.PI - 0.8, Math.PI + 0.8),
		}),
	);
	var newborn = worms[worms.length - 1];
	if (collidesRockCircle(newborn.target.x, newborn.target.y, 12)) {
		newborn.target.x = hatchPoint.x;
		newborn.target.y = hatchPoint.y;
	}
}

function updateEggs(now) {
	for (var i = eggs.length - 1; i >= 0; i--) {
		if (now >= eggs[i].hatchAtMs) {
			hatchEgg(eggs[i]);
			eggs.splice(i, 1);
		}
	}
}

function spawnFood() {
	if (foods.length >= CONFIG.foodMaxCount) return;
	var p = randomWalkablePoint(120);
	foods.push({
		id: nextFoodId++,
		x: p.x,
		y: p.y,
	});
}

function updateFoods(now) {
	if (!updateFoods.nextSpawnMs) {
		updateFoods.nextSpawnMs = now + 350;
	}
	while (now >= updateFoods.nextSpawnMs) {
		spawnFood();
		updateFoods.nextSpawnMs += CONFIG.foodSpawnIntervalMs;
	}
}

function consumeNearbyFood(worm) {
	if (worm.isDead) return;
	for (var i = foods.length - 1; i >= 0; i--) {
		var food = foods[i];
		if (
			Math.hypot(food.x - worm.target.x, food.y - worm.target.y) <=
			CONFIG.foodEatRadius
		) {
			foods.splice(i, 1);
			worm.foodCharges += 1;
			worm.hp = Math.min(CONFIG.wormMaxHp, worm.hp + 18);
		}
	}
}

function canCombat(a, b) {
	if (a.team === b.team) return false;
	if (a.isDead || b.isDead) return false;
	// War starts once either side crosses into enemy zone.
	return isInEnemyZone(a) || isInEnemyZone(b);
}

function findNearestEnemyThreat(worm) {
	var best = null;
	for (var i = 0; i < worms.length; i++) {
		var enemy = worms[i];
		if (!canCombat(worm, enemy)) continue;
		var dx = enemy.target.x - worm.target.x;
		var dy = enemy.target.y - worm.target.y;
		var dist = Math.sqrt(dx * dx + dy * dy);
		if (dist > worm.visionRange) continue;
		var dir = Math.atan2(-dy, dx);
		var diff = Math.abs(angleDiff(worm.facingDir, dir));
		if (diff > worm.fov * 0.5) continue;
		if (!best || dist < best.dist) {
			best = {
				worm: enemy,
				x: enemy.target.x,
				y: enemy.target.y,
				dist: dist,
				dir: dir,
			};
		}
	}
	return best;
}

function maybeShoot(worm, threat, now) {
	if (!threat || !threat.worm) return;
	if (now - worm.lastShotMs < worm.fireCooldownMs) return;

	var decision =
		(getNeuron(worm.brain, 'AVAL') +
			getNeuron(worm.brain, 'AVAR') +
			getNeuron(worm.brain, 'AVBL') +
			getNeuron(worm.brain, 'AVBR')) /
		120;
	var proximityBoost = 1 - clamp(threat.dist / worm.visionRange, 0, 1);
	if (decision + proximityBoost < 0.75) return;

	var aimDir = threat.dir + randRange(-0.08, 0.08);
	var muzzleX = worm.target.x + Math.cos(aimDir) * 15;
	var muzzleY = worm.target.y - Math.sin(aimDir) * 15;

	bullets.push({
		x: muzzleX,
		y: muzzleY,
		vx: Math.cos(aimDir) * CONFIG.bulletSpeed,
		vy: -Math.sin(aimDir) * CONFIG.bulletSpeed,
		ttlMs: CONFIG.bulletTTLms,
		radius: CONFIG.bulletRadius,
		damage: CONFIG.bulletDamage,
		ownerId: worm.id,
		ownerTeam: worm.team,
	});

	worm.lastShotMs = now;
}

function scavengeCorpses(worm, dtSec) {
	if (worm.isDead) return;
	for (var i = 0; i < worms.length; i++) {
		var corpse = worms[i];
		if (!corpse.isDead || corpse.corpseMass <= 0 || corpse.id === worm.id) continue;
		var dist = Math.hypot(worm.target.x - corpse.target.x, worm.target.y - corpse.target.y);
		if (dist <= CONFIG.corpseEatRadius) {
			var bite = Math.min(corpse.corpseMass, CONFIG.corpseHealPerSec * dtSec);
			corpse.corpseMass -= bite;
			worm.hp = Math.min(CONFIG.wormMaxHp, worm.hp + bite * 0.6);
		}
	}
}

function applyEcoBalance(worm, dtSec) {
	if (worm.isDead) return;

	if (isInHomeZone(worm)) {
		worm.hp = Math.min(
			CONFIG.wormMaxHp,
			worm.hp + CONFIG.safeZoneRegenPerSec * dtSec,
		);
	} else {
		worm.hp -= CONFIG.enemyZoneDrainPerSec * dtSec;
	}

	var crowd = 0;
	for (var i = 0; i < worms.length; i++) {
		var other = worms[i];
		if (other.id === worm.id || other.isDead || other.team !== worm.team) continue;
		if (
			Math.hypot(
				worm.target.x - other.target.x,
				worm.target.y - other.target.y,
			) <= CONFIG.overcrowdRadius
		) {
			crowd++;
		}
	}
	if (crowd > CONFIG.overcrowdThreshold) {
		worm.hp -= (crowd - CONFIG.overcrowdThreshold) * CONFIG.overcrowdDamagePerSec * dtSec;
	}
}

function updateWorm(worm, dtSec, now) {
	if (worm.isDead) {
		worm.chain.update(worm.target);
		return;
	}

	if (now - worm.birthMs >= worm.lifespanMs) {
		killWorm(worm, now);
		worm.chain.update(worm.target);
		return;
	}

	if (now >= worm.nextEggMs) {
		tryLayEggWithBalance(worm, now);
		worm.nextEggMs = scheduleNextEgg(now);
	}

	worm.brainElapsedMs += dtSec * 1000;

	var threat = findNearestEnemyThreat(worm);
	var nearestFood = findNearestFood(worm, CONFIG.foodSenseRange);
	worm.lastThreat = threat;
	worm.brain.stimulateVisionNeurons = !!threat;
	worm.brain.stimulateThreatNeurons = !!threat;
	worm.brain.stimulateFoodSenseNeurons = !!nearestFood;

	var nearBoundary = Math.abs(worm.target.x - boundaryX()) < 18;
	worm.brain.stimulateNoseTouchNeurons = nearBoundary;

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

		if (threat) {
			worm.targetDir = threat.dir;
			worm.targetSpeed = Math.max(worm.targetSpeed, 1.8);
			maybeShoot(worm, threat, now);
		} else {
			if (nearestFood) {
				worm.targetDir = Math.atan2(
					-(nearestFood.food.y - worm.target.y),
					nearestFood.food.x - worm.target.x,
				);
				worm.targetSpeed = Math.max(worm.targetSpeed, 1.45);
			}
			if (now >= worm.nextRaidMs) {
				worm.raidUntilMs = now + randRange(CONFIG.raidMinMs, CONFIG.raidMaxMs);
				worm.nextRaidMs = now + randRange(CONFIG.raidCooldownMinMs, CONFIG.raidCooldownMaxMs);
			}

			if (now <= worm.raidUntilMs) {
				var raidCenter = enemyZoneCenter(worm.team);
				worm.targetDir = Math.atan2(
					-(raidCenter.y - worm.target.y),
					raidCenter.x - worm.target.x,
				);
				worm.targetSpeed = Math.max(worm.targetSpeed, 1.5);
			} else if (isInEnemyZone(worm)) {
				// Pull back home if raid window is over.
				var homeCenter = safeZoneCenter(worm.team);
				worm.targetDir = Math.atan2(
					-(homeCenter.y - worm.target.y),
					homeCenter.x - worm.target.x,
				);
				worm.targetSpeed = Math.max(worm.targetSpeed, 1.3);
			}
		}
	}

	worm.speed += worm.speedChangeInterval;
	worm.speed = clamp(worm.speed, -1.2, 2.8);

	var diff = angleDiff(worm.facingDir, worm.targetDir);
	if (diff > 0.03) worm.facingDir -= 0.1;
	else if (diff < -0.03) worm.facingDir += 0.1;

	worm.target.x += Math.cos(worm.facingDir) * worm.speed;
	worm.target.y -= Math.sin(worm.facingDir) * worm.speed;

	if (collidesRockCircle(worm.target.x, worm.target.y, 10)) {
		worm.target.x -= Math.cos(worm.facingDir) * worm.speed * 1.35;
		worm.target.y += Math.sin(worm.facingDir) * worm.speed * 1.35;
		worm.targetDir += randRange(-0.9, 0.9);
		worm.speed = Math.max(0, worm.speed * 0.45);
	}

	if (worm.target.x < 0) worm.target.x = 0;
	if (worm.target.x > canvas.width) worm.target.x = canvas.width;
	if (worm.target.y < 0) worm.target.y = 0;
	if (worm.target.y > canvas.height) worm.target.y = canvas.height;

	consumeNearbyFood(worm);
	scavengeCorpses(worm, dtSec);
	applyEcoBalance(worm, dtSec);
	if (worm.hp <= 0) {
		killWorm(worm, now);
	}
	worm.chain.update(worm.target);
}

function updateBullets(dtSec, now) {
	for (var i = bullets.length - 1; i >= 0; i--) {
		var b = bullets[i];
		b.x += b.vx * dtSec;
		b.y += b.vy * dtSec;
		b.ttlMs -= dtSec * 1000;

		var remove = b.ttlMs <= 0;

		if (!remove) {
			for (var w = 0; w < worms.length; w++) {
				var target = worms[w];
				if (target.isDead || target.team === b.ownerTeam || target.id === b.ownerId) continue;
				if (Math.hypot(b.x - target.target.x, b.y - target.target.y) <= CONFIG.bulletHitRadius) {
					target.hp -= b.damage;
					if (target.hp <= 0) {
						killWorm(target, now);
					}
					remove = true;
					break;
				}
			}
		}

		if (!remove) {
			if (collidesRockCircle(b.x, b.y, b.radius + 1)) {
				remove = true;
			}
		}

		if (!remove) {
			if (b.x < -20 || b.y < -20 || b.x > canvas.width + 20 || b.y > canvas.height + 20) {
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

function drawSoil() {
	var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, '#6f4f35');
	gradient.addColorStop(0.55, '#7d5a3b');
	gradient.addColorStop(1, '#66472f');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	for (var i = 0; i < soilDots.length; i++) {
		var dot = soilDots[i];
		ctx.fillStyle = 'rgba(55,34,20,' + dot.a.toFixed(3) + ')';
		ctx.beginPath();
		ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2, false);
		ctx.fill();
	}
}

function drawRocks() {
	for (var i = 0; i < rocks.length; i++) {
		var rock = rocks[i];
		circle(ctx, rock.x, rock.y, rock.r, 'rgba(138,138,132,0.92)');
		circle(ctx, rock.x - rock.r * 0.22, rock.y - rock.r * 0.22, rock.r * 0.38, 'rgba(170,170,164,0.34)');
	}
}

function drawFoods() {
	for (var i = 0; i < foods.length; i++) {
		var food = foods[i];
		circle(ctx, food.x, food.y, 4.5, 'rgba(255,236,64,0.95)');
		circle(ctx, food.x, food.y, 2.2, 'rgba(255,251,192,0.92)');
	}
}

function drawEggs(now) {
	for (var i = 0; i < eggs.length; i++) {
		var egg = eggs[i];
		var t = clamp((egg.hatchAtMs - now) / CONFIG.eggHatchDelayMs, 0, 1);
		var r = 5 + (1 - t) * 2.5;
		circle(
			ctx,
			egg.x,
			egg.y,
			r,
			egg.team === TEAM_BLUE ? 'rgba(76,168,255,0.92)' : 'rgba(255,95,95,0.92)',
		);
	}
}

function drawBullets() {
	for (var i = 0; i < bullets.length; i++) {
		var bullet = bullets[i];
		circle(
			ctx,
			bullet.x,
			bullet.y,
			bullet.radius,
			bullet.ownerTeam === TEAM_BLUE ? 'rgba(90,220,255,0.95)' : 'rgba(255,150,70,0.95)',
		);
	}
}

function drawWormBody(worm) {
	var link = worm.chain.links[0];
	var p1 = link.head;
	var p2 = link.tail;

	ctx.beginPath();
	ctx.moveTo(p1.x, p1.y);
	ctx.strokeStyle = teamColor(worm.team, worm.isDead);
	ctx.lineWidth = worm.isDead ? 13 : 17;
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

	circle(ctx, eyeX, eyeY, 4, worm.isDead ? 'rgba(120,120,120,0.95)' : '#fdfdfd');

	if (!worm.isDead) {
		var aim = worm.lastThreat ? worm.lastThreat.dir : worm.facingDir;
		var pupilX = eyeX + Math.cos(aim) * 1.8;
		var pupilY = eyeY - Math.sin(aim) * 1.8;
		circle(ctx, pupilX, pupilY, 1.6, '#111111');

		ctx.beginPath();
		ctx.moveTo(head.x + Math.cos(worm.facingDir) * 7, head.y - Math.sin(worm.facingDir) * 7);
		ctx.lineTo(head.x + Math.cos(worm.facingDir) * 17, head.y - Math.sin(worm.facingDir) * 17);
		ctx.strokeStyle = teamAccent(worm.team);
		ctx.lineWidth = 2.5;
		ctx.stroke();
	}
}

function drawHealthBar(worm) {
	var head = worm.chain.links[0].head;
	var maxHp = CONFIG.wormMaxHp;
	var hp = clamp(worm.hp, 0, maxHp);
	var ratio = hp / maxHp;
	var barWidth = 28;
	var barHeight = 4;
	var x = head.x - barWidth * 0.5;
	var y = head.y - 24;

	ctx.fillStyle = 'rgba(25,25,25,0.55)';
	ctx.fillRect(x, y, barWidth, barHeight);

	var fillColor = worm.team === TEAM_BLUE ? 'rgba(90,220,255,0.95)' : 'rgba(255,145,95,0.95)';
	if (worm.isDead) {
		fillColor = 'rgba(140,140,140,0.9)';
	}
	ctx.fillStyle = fillColor;
	ctx.fillRect(x, y, barWidth * ratio, barHeight);
}

function drawCorpsesInfo(worm) {
	if (!worm.isDead) return;
	ctx.fillStyle = 'rgba(210,210,210,0.76)';
	ctx.font = '11px monospace';
	ctx.fillText('corpse ' + worm.corpseMass.toFixed(0), worm.target.x + 9, worm.target.y - 9);
}

function drawHUD() {
	var blueAlive = 0;
	var redAlive = 0;
	var blueEggs = 0;
	var redEggs = 0;
	for (var i = 0; i < worms.length; i++) {
		if (worms[i].isDead) continue;
		if (worms[i].team === TEAM_BLUE) blueAlive++;
		else redAlive++;
	}
	for (var e = 0; e < eggs.length; e++) {
		if (eggs[e].team === TEAM_BLUE) blueEggs++;
		else redEggs++;
	}

	ctx.fillStyle = 'rgba(255,255,255,0.94)';
	ctx.font = '13px monospace';
	ctx.fillText('BLUE: ' + blueAlive + '  eggs:' + blueEggs, 12, 22);
	ctx.fillText('RED: ' + redAlive + '  eggs:' + redEggs, 12, 40);
	ctx.fillText('foods: ' + foods.length + '  (eat => egg charge)', 12, 58);
	ctx.fillText('rocks: ' + rocks.length + '  natural obstacles', 12, 76);
}

function draw(now) {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	drawSoil();
	drawRocks();
	drawFoods();
	drawEggs(now);
	drawBullets();

	for (var i = 0; i < worms.length; i++) {
		drawWormBody(worms[i]);
		drawEyeAndGun(worms[i]);
		drawHealthBar(worms[i]);
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

function centerTeams() {
	var leftCenter = safeZoneCenter(TEAM_BLUE);
	var rightCenter = safeZoneCenter(TEAM_RED);
	for (var i = 0; i < worms.length; i++) {
		if (worms[i].isDead) continue;
		if (worms[i].team === TEAM_BLUE) {
			worms[i].target.x = leftCenter.x + randRange(-40, 40);
			worms[i].target.y = leftCenter.y + randRange(-60, 60);
		} else {
			worms[i].target.x = rightCenter.x + randRange(-40, 40);
			worms[i].target.y = rightCenter.y + randRange(-60, 60);
		}
		if (collidesRockCircle(worms[i].target.x, worms[i].target.y, 12)) {
			var p = randomWalkablePoint(80);
			worms[i].target.x = p.x;
			worms[i].target.y = p.y;
		}
	}
}

function resetBattlefield() {
	worms = [];
	bullets = [];
	eggs = [];
	foods = [];
	nextWormId = 1;
	nextEggId = 1;
	nextFoodId = 1;
	buildTerrain();
	updateFoods.nextSpawnMs = 0;
	spawnTeamGrid(TEAM_BLUE);
	spawnTeamGrid(TEAM_RED);
}

document.getElementById('clearButton').onclick = function () {
	bullets = [];
	eggs = [];
	foods = [];
};

document.getElementById('centerButton').onclick = function () {
	centerTeams();
};

(function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	buildTerrain();
	window.onresize = resize;
})();

(function init() {
	resetBattlefield();
})();

var lastTs = performance.now();
function frame(ts) {
	var dtSec = Math.min(0.05, (ts - lastTs) / 1000);
	lastTs = ts;

	for (var i = 0; i < worms.length; i++) {
		updateWorm(worms[i], dtSec, ts);
	}

	updateFoods(ts);
	updateEggs(ts);
	updateBullets(dtSec, ts);
	cleanupConsumedCorpses();
	draw(ts);
	requestAnimationFrame(frame);
}

setInterval(updateConnectomeUI, 180);
requestAnimationFrame(frame);
