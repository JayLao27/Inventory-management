import * as THREE from 'three';

let scene = null;
let camera = null;
let renderer = null;
let container = null;
let caption = null;
let messageBubbleEl = null;
let human = null;
let thoughtBubble = null;
let moodLight = null;
let shelfSacks = [];
let supplierTruck = null;
let supplierWheels = [];
let supplierTargetX = -9.5;
let phaseBeacon = null;
let pulseClock = 0;

let currentStage = 'start-day';
let pendingOrders = 0;
let nextReceiptDays = null;
let lastStock = 0;
let lastBaseStock = 1;
let lastDemand = 0;
let lastPlacedQty = 0;
let lastReceivedQty = 0;

const REORDER_POINT = 4;

const FLOW_STEPS = [
	{ id: 'start-day', pos: { x: -6.8, z: 1.8 }, color: 0x7dd3fc },
	{ id: 'daily-sales', pos: { x: -5.2, z: 1.8 }, color: 0x38bdf8 },
	{ id: 'check-inventory', pos: { x: -3.6, z: 1.8 }, color: 0x22d3ee },
	{ id: 'reduce-inventory', pos: { x: -3.6, z: 0.4 }, color: 0x4ade80 },
	{ id: 'lost-customer', pos: { x: -3.6, z: 3.2 }, color: 0xfb7185 },
	{ id: 'tally-lost', pos: { x: -2.0, z: 3.2 }, color: 0xf97316 },
	{ id: 'reorder-check', pos: { x: -2.0, z: 0.4 }, color: 0xfbbf24 },
	{ id: 'create-po', pos: { x: -0.2, z: 0.4 }, color: 0xa78bfa },
	{ id: 'place-order', pos: { x: 1.6, z: 0.4 }, color: 0x8b5cf6 },
	{ id: 'supplier-lead', pos: { x: 3.4, z: 0.4 }, color: 0x6366f1 },
	{ id: 'trigger-reorder', pos: { x: 5.2, z: 0.4 }, color: 0x4f46e5 },
	{ id: 'stock-received', pos: { x: 6.8, z: 0.4 }, color: 0x22c55e },
	{ id: 'total', pos: { x: -0.2, z: 1.8 }, color: 0x14b8a6 },
	{ id: 'end-day', pos: { x: -2.0, z: 1.8 }, color: 0x60a5fa },
];

const PHASE_MESSAGES = {
	'start-day': { text: 'Good morning. Starting today\'s processing.', emoji: '☀️', mood: 'neutral' },
	'daily-sales': { text: 'Reviewing sales demand: {demand} bags.', emoji: '📊', mood: 'working' },
	'check-inventory': { text: 'Current stock check: {stock} bags available.', emoji: '📦', mood: 'working' },
	'reduce-inventory': { text: 'Sold {sold} bags. Inventory now at {stock}.', emoji: '✅', mood: 'happy' },
	'lost-customer': { text: 'Stockout event. Unmet demand detected.', emoji: '😟', mood: 'worried' },
	'tally-lost': { text: 'Loss tally today: about ₱{lostPeso}.', emoji: '💸', mood: 'worried' },
	'reorder-check': { text: 'Stock {stock} vs reorder point {reorderPoint}.', emoji: '🤔', mood: 'thinking' },
	'create-po': { text: 'Creating purchase order for replenishment.', emoji: '📝', mood: 'working' },
	'place-order': { text: 'Order sent to supplier: {placedQty} bags.', emoji: '📞', mood: 'happy' },
	'supplier-lead': { text: 'Supplier truck in transit. ETA {etaDays} day{etaPlural}.', emoji: '🚛', mood: 'waiting' },
	'trigger-reorder': { text: 'Truck near dock. Preparing receiving team.', emoji: '🏭', mood: 'excited' },
	'stock-received': { text: 'Received {receivedQty} bags. Shelves refilled.', emoji: '🎉', mood: 'happy' },
	'total': { text: 'Daily summary complete. Ending cycle.', emoji: '📋', mood: 'neutral' },
	'end-day': { text: 'Process complete. Ready for next day.', emoji: '🌙', mood: 'neutral' },
};

function interpolateMessage(template, vars) {
	let message = template;
	Object.entries(vars).forEach(([key, value]) => {
		message = message.replaceAll(`{${key}}`, String(value));
	});
	return message;
}

function getPhaseMessage() {
	const meta = PHASE_MESSAGES[currentStage] || PHASE_MESSAGES['start-day'];
	const vars = {
		demand: lastDemand,
		stock: lastStock,
		sold: Math.max(0, lastDemand - Math.max(0, lastDemand - lastStock)),
		lostPeso: Math.max(0, lastDemand - lastStock) * 500,
		reorderPoint: REORDER_POINT,
		placedQty: Math.max(lastPlacedQty, pendingOrders),
		receivedQty: lastReceivedQty,
		etaDays: Number.isFinite(nextReceiptDays) ? Math.max(0, nextReceiptDays) : 0,
		etaPlural: Number.isFinite(nextReceiptDays) && nextReceiptDays === 1 ? '' : 's',
	};
	return {
		emoji: meta.emoji || '📋',
		mood: meta.mood || 'neutral',
		text: interpolateMessage(meta.text, vars),
	};
}

function ensureMessageBubble() {
	if (!container || messageBubbleEl) return;
	messageBubbleEl = document.createElement('div');
	messageBubbleEl.className = 'process-3d-live-message';
	container.appendChild(messageBubbleEl);
}

function getMoodColor(mood) {
	if (mood === 'happy' || mood === 'excited') return '#33ff88';
	if (mood === 'worried') return '#ff6677';
	if (mood === 'thinking') return '#ffcc44';
	if (mood === 'waiting') return '#aa88ff';
	if (mood === 'working') return '#44aaff';
	return '#aaccdd';
}

function updateMessageBubble() {
	if (!messageBubbleEl) return;
	const msg = getPhaseMessage();
	const tone = getMoodColor(msg.mood);
	messageBubbleEl.style.borderColor = `${tone}88`;
	messageBubbleEl.style.boxShadow = `0 8px 20px ${tone}2b`;
	messageBubbleEl.innerHTML = `<span class="message-emoji">${msg.emoji}</span><span class="message-text">${msg.text}</span>`;
}

function getStepData(id) {
	return FLOW_STEPS.find((step) => step.id === id) || FLOW_STEPS[0];
}

function makeMaterial(color, options = {}) {
	return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...options });
}

function buildOfficeScene() {
	const office = new THREE.Group();

	const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.5), makeMaterial(0xc8a97e, { roughness: 0.95 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.set(-4.7, 0.01, 0);
	floor.receiveShadow = true;
	office.add(floor);

	const wallMat = makeMaterial(0xe8dcc8);
	const backWall = new THREE.Mesh(new THREE.BoxGeometry(9, 2.3, 0.12), wallMat);
	backWall.position.set(-4.7, 1.15, -2.75);
	office.add(backWall);

	const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 5.5), wallMat);
	sideWall.position.set(-9.15, 1.15, 0);
	office.add(sideWall);

	const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 1.0), makeMaterial(0x7a4f2a));
	deskTop.position.set(-4.4, 0.82, -0.2);
	deskTop.castShadow = true;
	office.add(deskTop);

	const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.04), makeMaterial(0x1a1a1a));
	monitor.position.set(-4.4, 1.1, -0.55);
	office.add(monitor);

	const screen = new THREE.Mesh(
		new THREE.BoxGeometry(0.62, 0.38, 0.02),
		makeMaterial(0x88ccff, { emissive: 0x224488, emissiveIntensity: 0.6 }),
	);
	screen.position.set(-4.4, 1.1, -0.53);
	office.add(screen);

	human = new THREE.Group();
	const skin = makeMaterial(0xf0c89a);
	const shirt = makeMaterial(0x1a4a8a);
	const pants = makeMaterial(0x223355);

	const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.2), shirt);
	torso.position.y = 0.92;
	human.add(torso);

	const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.24), skin);
	head.position.y = 1.27;
	human.add(head);

	const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), pants);
	legL.position.set(-0.1, 0.36, 0);
	human.add(legL);
	const legR = legL.clone();
	legR.position.x = 0.1;
	human.add(legR);

	human.position.set(-4.4, 0, 0.85);
	human.rotation.y = -0.35;
	office.add(human);

	thoughtBubble = new THREE.Group();
	const bubbleBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.52, 0.05), makeMaterial(0xffffff, { transparent: true, opacity: 0.92 }));
	bubbleBody.position.y = 0.04;
	thoughtBubble.add(bubbleBody);
	const bubbleTail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 10), makeMaterial(0xffffff, { transparent: true, opacity: 0.92 }));
	bubbleTail.rotation.z = Math.PI * 0.35;
	bubbleTail.position.set(-0.42, -0.28, 0);
	thoughtBubble.add(bubbleTail);
	thoughtBubble.position.set(-3.6, 2.0, 0.7);
	office.add(thoughtBubble);

	moodLight = new THREE.PointLight(0xffffff, 0.2, 3);
	moodLight.position.set(-4.4, 2.5, 0.8);
	office.add(moodLight);

	const shelf = new THREE.Group();
	const boardMat = makeMaterial(0x7a4f2a);
	[0, 0.55, 1.1].forEach((y) => {
		const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.5), boardMat);
		board.position.set(0, y, 0);
		shelf.add(board);
	});
	const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 0.04), makeMaterial(0x5a3a1a));
	back.position.set(0, 0.6, -0.24);
	shelf.add(back);

	shelfSacks = [];
	const sackMats = [makeMaterial(0xd4a96a), makeMaterial(0xc49560), makeMaterial(0xe2ba7c)];
	for (let i = 0; i < 12; i++) {
		const col = i % 4;
		const row = Math.floor(i / 4);
		const sack = new THREE.Group();
		const sackBody = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.26), sackMats[i % sackMats.length]);
		sackBody.castShadow = true;
		sack.add(sackBody);
		const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.07, 8), makeMaterial(0x8b0000));
		tie.position.y = 0.18;
		sack.add(tie);
		sack.position.set(-0.8 + col * 0.54, 0.19 + row * 0.55, 0.04);
		shelf.add(sack);
		shelfSacks.push(sack);
	}

	shelf.position.set(-7.1, 0, -1.5);
	office.add(shelf);

	scene.add(office);
}

function buildHighwayScene() {
	const highway = new THREE.Group();

	const road = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 3.2), makeMaterial(0x333333, { roughness: 0.95 }));
	road.rotation.x = -Math.PI / 2;
	road.position.set(4.1, 0.01, -0.4);
	highway.add(road);

	const shoulderL = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 0.35), makeMaterial(0xf5f5dc));
	shoulderL.rotation.x = -Math.PI / 2;
	shoulderL.position.set(4.1, 0.012, 1.22);
	highway.add(shoulderL);

	const shoulderR = shoulderL.clone();
	shoulderR.position.z = -2.02;
	highway.add(shoulderR);

	for (let x = -2.2; x < 10.3; x += 1.2) {
		const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), makeMaterial(0xffee00));
		dash.rotation.x = -Math.PI / 2;
		dash.position.set(x, 0.02, -0.4);
		highway.add(dash);
	}

	const terrainTop = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 2.4), makeMaterial(0x4a7a3a, { roughness: 0.98 }));
	terrainTop.rotation.x = -Math.PI / 2;
	terrainTop.position.set(4.1, 0, 2.0);
	highway.add(terrainTop);

	const terrainBottom = terrainTop.clone();
	terrainBottom.position.z = -2.8;
	highway.add(terrainBottom);

	const warehouse = new THREE.Group();
	const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.6, 2.1), makeMaterial(0xd4c5a9));
	body.position.y = 0.8;
	warehouse.add(body);
	const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, 2.3), makeMaterial(0x2d3a4a));
	roof.position.y = 1.67;
	warehouse.add(roof);
	const dock = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 0.4), makeMaterial(0x888888));
	dock.position.set(0, 0.11, 1.2);
	warehouse.add(dock);
	warehouse.position.set(8.2, 0, -1.1);
	highway.add(warehouse);

	const truckModel = buildSupplierTruck();
	supplierTruck = truckModel.group;
	supplierWheels = truckModel.wheels;
	supplierTruck.visible = false;
	supplierTruck.position.set(-9.5, 0, -0.4);
	supplierTruck.rotation.y = Math.PI / 2;
	highway.add(supplierTruck);

	phaseBeacon = new THREE.Mesh(
		new THREE.SphereGeometry(0.18, 14, 10),
		makeMaterial(0x7dd3fc, { emissive: 0x2a4f6d, emissiveIntensity: 0.8 }),
	);
	phaseBeacon.position.set(-6.8, 0.2, 1.8);
	scene.add(phaseBeacon);

	scene.add(highway);
}

function buildSupplierTruck() {
	const group = new THREE.Group();
	const wheels = [];
	const bodyMat = makeMaterial(0x1a44cc, { roughness: 0.4, metalness: 0.3 });
	const chrome = makeMaterial(0xcfcfcf, { metalness: 0.8, roughness: 0.2 });

	const trailer = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 1.2), bodyMat);
	trailer.position.set(-0.8, 0.85, 0);
	group.add(trailer);

	const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.2), bodyMat);
	cabin.position.set(1.3, 0.78, 0);
	group.add(cabin);

	const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.85), makeMaterial(0xb8ddf5, { transparent: true, opacity: 0.78 }));
	windshield.position.set(1.86, 0.9, 0);
	group.add(windshield);

	const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 1.2), chrome);
	bumper.position.set(1.93, 0.34, 0);
	group.add(bumper);

	const wheelMat = makeMaterial(0x111111, { roughness: 0.95 });
	const rimMat = makeMaterial(0x999999, { metalness: 0.7, roughness: 0.25 });
	const wheelConfigs = [
		{ x: 1.45, z: 0.68 }, { x: 1.45, z: -0.68 },
		{ x: -0.65, z: 0.68 }, { x: -0.65, z: -0.68 },
		{ x: -1.45, z: 0.68 }, { x: -1.45, z: -0.68 },
	];
	wheelConfigs.forEach(({ x, z }) => {
		const wheel = new THREE.Group();
		const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 18), wheelMat);
		tire.rotation.x = Math.PI / 2;
		const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.22, 10), rimMat);
		rim.rotation.x = Math.PI / 2;
		wheel.add(tire);
		wheel.add(rim);
		wheel.position.set(x, 0.3, z);
		group.add(wheel);
		wheels.push(tire);
	});

	return { group, wheels };
}

function applyMoodLighting(stage) {
	if (!moodLight) return;
	const mood = PHASE_MESSAGES[stage]?.mood || 'neutral';
	if (mood === 'happy' || mood === 'excited') {
		moodLight.color.set(0x88ff88);
		moodLight.intensity = 0.65;
	} else if (mood === 'worried') {
		moodLight.color.set(0xff4444);
		moodLight.intensity = 0.55;
	} else if (mood === 'thinking') {
		moodLight.color.set(0xffcc44);
		moodLight.intensity = 0.45;
	} else if (mood === 'waiting') {
		moodLight.color.set(0xaa88ff);
		moodLight.intensity = 0.4;
	} else {
		moodLight.color.set(0xffffff);
		moodLight.intensity = 0.25;
	}
}

function updateCaption() {
	if (!caption) return;
	const stockPct = Math.round(Math.max(0, Math.min(1, lastStock / Math.max(1, lastBaseStock))) * 100);
	const phaseText = getPhaseMessage().text;
	const eta = Number.isFinite(nextReceiptDays) ? ` | Lead Time: ${nextReceiptDays}d` : '';
	const orderText = pendingOrders > 0 ? ` | On Order: ${pendingOrders}` : '';
	const demandText = lastDemand > 0 ? ` | Demand: ${lastDemand}` : '';
	const movedText = lastPlacedQty > 0 ? ` | Placed: ${lastPlacedQty}` : (lastReceivedQty > 0 ? ` | Received: ${lastReceivedQty}` : '');
	caption.textContent = `${phaseText} | Inventory: ${stockPct}% (${lastStock})${demandText}${orderText}${eta}${movedText}`;
	updateMessageBubble();
}

function updateSupplierTarget() {
	if (!supplierTruck) return;
	const transitStages = ['place-order', 'supplier-lead', 'trigger-reorder', 'stock-received'];
	const active = transitStages.includes(currentStage) || pendingOrders > 0 || lastPlacedQty > 0;
	supplierTruck.visible = active;
	if (!active) {
		supplierTargetX = -9.5;
		return;
	}

	if (currentStage === 'place-order') {
		supplierTargetX = -9.5;
		return;
	}

	if (currentStage === 'supplier-lead') {
		if (Number.isFinite(nextReceiptDays)) {
			const progress = 1 - Math.max(0, Math.min(1, nextReceiptDays / 3));
			supplierTargetX = -9.5 + progress * 17.0;
		} else {
			supplierTargetX = -1.0;
		}
		return;
	}

	if (currentStage === 'trigger-reorder') {
		supplierTargetX = 7.6;
		return;
	}

	if (currentStage === 'stock-received') {
		supplierTargetX = 9.2;
		return;
	}

	supplierTargetX = -9.5;
}

function updateSacksVisibility() {
	if (shelfSacks.length === 0) return;
	const visible = Math.round(Math.max(0, Math.min(1, lastStock / Math.max(1, lastBaseStock))) * shelfSacks.length);
	shelfSacks.forEach((s, idx) => {
		s.visible = idx < visible;
	});
}

function onResize() {
	if (!renderer || !camera || !container) return;
	const width = container.clientWidth || 320;
	const height = container.clientHeight || 220;
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	renderer.setSize(width, height, false);
}

export function resizeProcess3DScene() {
	onResize();
}

function animate() {
	if (!renderer || !scene || !camera) return;
	requestAnimationFrame(animate);

	pulseClock += 0.03;

	if (human) {
		human.rotation.y = -0.35 + Math.sin(pulseClock * 0.8) * 0.05;
		human.position.y = Math.sin(pulseClock * 1.3) * 0.01;
	}

	if (thoughtBubble) {
		thoughtBubble.position.y = 2.0 + Math.sin(pulseClock * 1.8) * 0.03;
		thoughtBubble.rotation.z = Math.sin(pulseClock * 0.9) * 0.015;
	}

	if (phaseBeacon) {
		const step = getStepData(currentStage);
		phaseBeacon.position.x += (step.pos.x - phaseBeacon.position.x) * 0.09;
		phaseBeacon.position.z += (step.pos.z - phaseBeacon.position.z) * 0.09;
		phaseBeacon.position.y = 0.2 + Math.sin(pulseClock * 2.2) * 0.04;
		phaseBeacon.material.emissiveIntensity = 0.6 + Math.sin(pulseClock * 2.2) * 0.35;
		phaseBeacon.material.color.set(step.color);
	}

	if (supplierTruck?.visible) {
		const dx = supplierTargetX - supplierTruck.position.x;
		supplierTruck.position.x += dx * 0.024;
		supplierTruck.position.y = Math.sin(pulseClock * 8.0) * 0.02;
		supplierTruck.rotation.z = Math.sin(pulseClock * 7.0) * 0.008;
		supplierWheels.forEach((w) => {
			w.rotation.z += Math.abs(dx) * 0.06;
		});
	}

	renderer.render(scene, camera);
}

export function initProcess3DScene() {
	container = document.getElementById('process-3d-scene');
	caption = document.getElementById('process-3d-caption');
	if (!container || container.childElementCount > 0) {
		return;
	}

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1220);
	scene.fog = new THREE.Fog(0x0b1220, 16, 35);

	camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
	camera.position.set(-0.8, 8.8, 12.6);
	camera.lookAt(-0.6, 0.5, 0);

	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';
	container.appendChild(renderer.domElement);

	const ambient = new THREE.AmbientLight(0xffffff, 0.62);
	scene.add(ambient);

	const sun = new THREE.DirectionalLight(0xfff7e4, 1.15);
	sun.position.set(6, 14, 8);
	sun.castShadow = true;
	scene.add(sun);

	const fill = new THREE.PointLight(0x7ab8ff, 0.45, 20);
	fill.position.set(-8, 3.4, -2);
	scene.add(fill);

	const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), makeMaterial(0x1a2436, { roughness: 0.95 }));
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	scene.add(floor);

	const divider = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 9), makeMaterial(0x34506f));
	divider.position.set(-0.2, 0.02, -0.3);
	scene.add(divider);

	buildOfficeScene();
	buildHighwayScene();
	ensureMessageBubble();
	updateMessageBubble();

	onResize();
	window.addEventListener('resize', onResize);
	updateCaption();
	animate();
}

export function setProcess3DStage(stage) {
	currentStage = stage || 'start-day';
	applyMoodLighting(currentStage);
	updateSupplierTarget();
	updateCaption();
}

export function updateProcess3DScene({
	stock = 0,
	baseStock = 1,
	demand = 0,
	pendingOrders: pending = 0,
	nextReceiptDays: nextDays = null,
	placedOrderQty = 0,
	receivedQty = 0,
} = {}) {
	if (!scene) return;

	lastStock = stock;
	lastBaseStock = baseStock;
	lastDemand = demand;
	pendingOrders = Math.max(0, pending);
	nextReceiptDays = nextDays;
	lastPlacedQty = placedOrderQty;
	lastReceivedQty = receivedQty;

	if (stock <= REORDER_POINT && currentStage === 'reorder-check') {
		applyMoodLighting('thinking');
	}

	updateSacksVisibility();
	updateSupplierTarget();
	updateCaption();
}
