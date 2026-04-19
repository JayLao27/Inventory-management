import * as THREE from 'three';

let renderer = null;
let scene = null;
let camera = null;
let clock = null;
let mountElement = null;
let animationFrameId = null;
let resizeObserver = null;

const inventoryBlocks = [];
const movingPackages = [];
const pulseMeshes = [];

let deliveryCurve = null;

const sceneState = {
  stock: 0,
  baseStock: 1,
  demand: 0,
  placedOrderQty: 0,
  receivedQty: 0,
  orderPulse: 0,
  receivePulse: 0,
  stageId: 'start-day',
};

const stageTargets = {
  'start-day': 0.06,
  'daily-sales': 0.16,
  'check-inventory': 0.28,
  'reduce-inventory': 0.40,
  'reorder-check': 0.54,
  'create-po': 0.66,
  'place-order': 0.76,
  'supplier-lead': 0.88,
  'stock-received': 0.72,
  'trigger-reorder': 0.16,
  'total': 0.08,
  'end-day': 0.06,
};

let routeCurve = null;
let truckGroup = null;
let truckTarget = new THREE.Vector3();
let truckTravelT = 0.06;
let truckTargetT = 0.06;
let stageLabelMesh = null;
let stageMarkers = [];

function buildMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.12,
  });
}

function createTruck() {
  const truck = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.48, 0.72),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.52, metalness: 0.08 }),
  );
  body.position.set(0.2, 0.42, 0);
  truck.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.5, 0.66),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.42, metalness: 0.08 }),
  );
  cabin.position.set(-0.42, 0.46, 0);
  truck.add(cabin);

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.56, 0.56),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.48, metalness: 0.1, transparent: true, opacity: 0.18 }),
  );
  cargo.position.set(0.46, 0.48, 0);
  truck.add(cargo);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.02 });
  const wheelGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16);
  [
    [-0.45, 0.12, -0.34],
    [0.5, 0.12, -0.34],
    [-0.45, 0.12, 0.34],
    [0.5, 0.12, 0.34],
  ].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    truck.add(wheel);
  });

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.14, 0.54),
    new THREE.MeshStandardMaterial({ color: 0xffedd5, roughness: 0.5, metalness: 0.04 }),
  );
  roof.position.set(-0.42, 0.88, 0);
  truck.add(roof);

  truck.position.set(-6.6, 0.08, 2.6);
  truck.rotation.y = -0.08;

  truckGroup = truck;
  scene.add(truck);
}

function createStageMarker(label, x, z, color) {
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 1.2, 18),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.24, roughness: 0.45 }),
  );
  marker.position.set(x, 0.6, z);
  scene.add(marker);

  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 }),
  );
  top.position.set(x, 1.28, z);
  scene.add(top);

  const card = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.28, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x10162a, emissive: 0x0f172a, emissiveIntensity: 0.1 }),
  );
  card.position.set(x, 1.6, z);
  card.rotation.y = x > 0 ? -0.08 : 0.08;
  scene.add(card);

  stageMarkers.push({ label, x, z, color, card, top, marker });
}

function createWarehouseBuilding() {
  const warehouseBase = new THREE.Mesh(
    new THREE.BoxGeometry(5.3, 2.6, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.92, metalness: 0.03 }),
  );
  warehouseBase.position.set(3.8, 1.3, -0.55);
  scene.add(warehouseBase);

  const warehouseRoof = new THREE.Mesh(
    new THREE.BoxGeometry(5.7, 0.32, 3.8),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.02 }),
  );
  warehouseRoof.position.set(3.82, 2.82, -0.55);
  scene.add(warehouseRoof);

  const warehouseDoor = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 1.7, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8, metalness: 0.02 }),
  );
  warehouseDoor.position.set(3.8, 0.88, 1.05);
  scene.add(warehouseDoor);

  const dock = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 0.3, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.78, metalness: 0.03 }),
  );
  dock.position.set(3.8, 0.16, 1.32);
  scene.add(dock);

  const loadingBay = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 0.9, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.92 }),
  );
  loadingBay.position.set(3.8, 0.56, 1.16);
  scene.add(loadingBay);

  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 0.18, 0.76),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, emissiveIntensity: 0.15 }),
  );
  awning.position.set(3.8, 1.62, 1.28);
  scene.add(awning);

  const signage = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.34, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x1d4ed8, emissiveIntensity: 0.12 }),
  );
  signage.position.set(3.8, 2.36, 1.08);
  scene.add(signage);
}

function createParkingLot() {
  const lot = new THREE.Mesh(
    new THREE.PlaneGeometry(7.8, 4.8),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.98, metalness: 0.02 }),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(-3.7, 0, 2.25);
  scene.add(lot);

  const lotStripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.96 });
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 3.3), lotStripeMat);
    stripe.position.set(-4.8 + i * 0.9, 0.012, 2.25);
    scene.add(stripe);
  }

  const entryRoad = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.04, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.96 }),
  );
  entryRoad.position.set(-0.9, 0.03, 2.25);
  scene.add(entryRoad);
}

function createRiceStacks() {
  const stackMaterial = buildMaterial(0xd6b36a);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const sack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.3), stackMaterial.clone());
      sack.material.color.setHSL(0.1 + row * 0.015 + col * 0.008, 0.36, 0.63);
      sack.position.set(2.4 + col * 0.45, 0.18 + row * 0.34, -0.1 + (col % 2) * 0.24);
      scene.add(sack);
      inventoryBlocks.push(sack);
    }
  }
}

function createShelfUnit(x, z) {
  const group = new THREE.Group();

  const postMaterial = buildMaterial(0x27304f);
  const beamMaterial = buildMaterial(0x1d243d);
  const crateGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);

  const postGeometry = new THREE.BoxGeometry(0.16, 2.6, 0.16);
  const beamGeometry = new THREE.BoxGeometry(1.8, 0.08, 0.26);

  [
    [-0.84, 1.3, -0.28],
    [0.84, 1.3, -0.28],
    [-0.84, 1.3, 0.28],
    [0.84, 1.3, 0.28],
  ].forEach(([px, py, pz]) => {
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(px, py, pz);
    group.add(post);
  });

  [0.56, 1.24, 1.92].forEach((rowY) => {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(0, rowY, 0);
    group.add(beam);
  });

  const slotPositions = [
    [-0.48, 0.72, -0.08],
    [0, 0.72, -0.08],
    [0.48, 0.72, -0.08],
    [-0.48, 1.38, -0.08],
    [0, 1.38, -0.08],
    [0.48, 1.38, -0.08],
    [-0.48, 2.04, -0.08],
    [0, 2.04, -0.08],
    [0.48, 2.04, -0.08],
  ];

  slotPositions.forEach(([cx, cy, cz], index) => {
    const crateMaterial = buildMaterial(0x67e8f9);
    crateMaterial.color.setHSL(0.58 - index * 0.02, 0.72, 0.56);
    crateMaterial.transparent = true;
    const crate = new THREE.Mesh(crateGeometry, crateMaterial);
    crate.position.set(cx, cy, cz);
    crate.visible = false;
    group.add(crate);
    inventoryBlocks.push(crate);
  });

  group.position.set(x, 0.02, z);
  return group;
}

function createPulse(color, position) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 20),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.06,
    }),
  );
  mesh.position.copy(position);
  mesh.scale.setScalar(0.001);
  scene.add(mesh);
  pulseMeshes.push(mesh);
  return mesh;
}

function createSceneObjects() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x08111f, 10, 34);
  stageMarkers = [];
  routeCurve = null;

  const ambient = new THREE.AmbientLight(0xc7d2fe, 1.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.15);
  keyLight.position.set(-5, 8, 6);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x60a5fa, 1.25, 26);
  rimLight.position.set(4.5, 3, -3.8);
  scene.add(rimLight);

  const accentLight = new THREE.PointLight(0xf59e0b, 1.1, 20);
  accentLight.position.set(-4.2, 1.8, 2.8);
  scene.add(accentLight);

  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 14),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1, metalness: 0.02 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, 0, 0.9);
  scene.add(yard);

  const grid = new THREE.GridHelper(22, 22, 0x334155, 0x1f2937);
  grid.position.y = 0.01;
  grid.material.opacity = 0.2;
  grid.material.transparent = true;
  scene.add(grid);

  const road = new THREE.Mesh(
    new THREE.BoxGeometry(12.6, 0.06, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.95 }),
  );
  road.position.set(-0.35, 0.03, 2.2);
  scene.add(road);

  const laneStripe = new THREE.Mesh(
    new THREE.BoxGeometry(10.8, 0.02, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.9 }),
  );
  laneStripe.position.set(-0.9, 0.05, 2.2);
  scene.add(laneStripe);

  const parkingLot = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 4.4),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.98, metalness: 0.01 }),
  );
  parkingLot.position.set(-4.6, 0.04, 2.2);
  scene.add(parkingLot);

  for (let i = 0; i < 5; i++) {
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.02, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.92 }),
    );
    slot.position.set(-6.1 + i * 0.88, 0.05, 1.75);
    scene.add(slot);
  }

  const routePoints = [
    new THREE.Vector3(-6.4, 0.12, 2.2),
    new THREE.Vector3(-4.4, 0.18, 2.15),
    new THREE.Vector3(-2.2, 0.22, 2.05),
    new THREE.Vector3(-0.8, 0.28, 1.82),
    new THREE.Vector3(0.9, 0.34, 1.48),
    new THREE.Vector3(2.5, 0.36, 1.32),
    new THREE.Vector3(3.75, 0.34, 1.22),
    new THREE.Vector3(4.8, 0.3, 1.15),
  ];
  routeCurve = new THREE.CatmullRomCurve3(routePoints, false, 'catmullrom', 0.45);

  const route = new THREE.Mesh(
    new THREE.TubeGeometry(routeCurve, 80, 0.06, 8, false),
    new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x475569,
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: 0.5,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  route.position.y = 0.02;
  scene.add(route);

  createWarehouseBuilding();
  createParkingLot();
  createRiceStacks();
  createTruck();

  createStageMarker('Parking Lot', -6.2, 2.95, 0x38bdf8);
  createStageMarker('Rice Store', -2.2, 1.0, 0x22c55e);
  createStageMarker('Office', 0.9, 1.1, 0xf59e0b);
  createStageMarker('Warehouse Dock', 3.9, 1.75, 0xfb7185);

  const packageColors = [0xd6b36a, 0xc99b3a, 0xefcf8c, 0x9a7a39];
  for (let index = 0; index < 4; index++) {
    const packageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.24, 0.28),
      new THREE.MeshStandardMaterial({
        color: packageColors[index],
        roughness: 0.6,
        metalness: 0.04,
        emissive: packageColors[index],
        emissiveIntensity: 0.08,
      }),
    );
    packageMesh.userData.offset = index / 4;
    packageMesh.userData.speed = 0.05 + index * 0.008;
    scene.add(packageMesh);
    movingPackages.push(packageMesh);
  }
}

function updateInventoryFill() {
  const baseStock = Math.max(1, sceneState.baseStock || 1);
  const ratio = THREE.MathUtils.clamp(sceneState.stock / baseStock, 0, 1);
  const filledCount = Math.round(ratio * inventoryBlocks.length);

  inventoryBlocks.forEach((block, index) => {
    const filled = index < filledCount;
    block.visible = filled;
    block.scale.setScalar(filled ? 1 : 0.001);
    block.material.opacity = filled ? 1 : 0;
  });
}

function updatePulses(elapsed) {
  pulseMeshes.forEach((pulse, index) => {
    const pulseBase = index === 0 ? sceneState.receivePulse : sceneState.orderPulse;
    const animatedScale = 1 + Math.sin(elapsed * 2.8 + index) * 0.08 + pulseBase * 0.7;
    pulse.scale.setScalar(Math.max(0.001, animatedScale));
    pulse.material.emissiveIntensity = 1.2 + pulseBase * 1.4;
  });

  sceneState.orderPulse = Math.max(0, sceneState.orderPulse * 0.92);
  sceneState.receivePulse = Math.max(0, sceneState.receivePulse * 0.92);
}

function updatePackages(elapsed) {
  if (!routeCurve) return;

  movingPackages.forEach((packageMesh, index) => {
    const offset = packageMesh.userData.offset || 0;
    const speed = packageMesh.userData.speed || 0.05;
    const t = (elapsed * speed + offset) % 1;
    const point = routeCurve.getPointAt(t);
    const tangent = routeCurve.getTangentAt(t).normalize();

    packageMesh.position.copy(point);
    packageMesh.position.y += Math.sin(elapsed * 4 + index) * 0.03;
    packageMesh.rotation.set(
      Math.sin(elapsed * 1.8 + index) * 0.2,
      Math.atan2(tangent.x, tangent.z),
      Math.cos(elapsed * 1.4 + index) * 0.12,
    );
  });
}

function updateTruck() {
  if (!truckGroup || !routeCurve) return;

  truckTravelT += (truckTargetT - truckTravelT) * 0.08;
  const truckPoint = routeCurve.getPointAt(THREE.MathUtils.clamp(truckTravelT, 0.02, 0.98));
  const truckTangent = routeCurve.getTangentAt(THREE.MathUtils.clamp(truckTravelT, 0.02, 0.98)).normalize();
  truckGroup.position.copy(truckPoint);
  truckGroup.position.y = 0.08;
  truckGroup.rotation.y = Math.atan2(truckTangent.x, truckTangent.z);

  truckGroup.position.x += Math.sin(clock.getElapsedTime() * 6) * 0.01;
}

export function setProcess3DStage(stageId) {
  if (!stageId) return;
  sceneState.stageId = stageId;
  if (stageTargets[stageId] !== undefined) {
    truckTargetT = stageTargets[stageId];
  }
}

function handleResize() {
  if (!mountElement || !renderer || !camera) return;

  const rect = mountElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}

function animate() {
  if (!scene || !camera || !renderer || !clock) return;

  const elapsed = clock.getElapsedTime();
  scene.rotation.y = Math.sin(elapsed * 0.1) * 0.035;
  camera.position.x = Math.sin(elapsed * 0.12) * 0.22;
  camera.position.y = 4.1 + Math.sin(elapsed * 0.45) * 0.05;
  camera.lookAt(-0.2, 1.0, 1.1);

  updateInventoryFill();
  updatePulses(elapsed);
  updatePackages(elapsed);
  updateTruck();

  renderer.render(scene, camera);
  animationFrameId = window.requestAnimationFrame(animate);
}

export function updateProcess3DScene(nextState = {}) {
  if (Number.isFinite(nextState.stock)) sceneState.stock = nextState.stock;
  if (Number.isFinite(nextState.baseStock) && nextState.baseStock > 0) sceneState.baseStock = nextState.baseStock;
  if (Number.isFinite(nextState.demand)) sceneState.demand = nextState.demand;

  if (Number.isFinite(nextState.placedOrderQty) && nextState.placedOrderQty > 0) {
    sceneState.orderPulse = Math.min(1, sceneState.orderPulse + Math.min(1, nextState.placedOrderQty / 120));
  }

  if (Number.isFinite(nextState.receivedQty) && nextState.receivedQty > 0) {
    sceneState.receivePulse = Math.min(1, sceneState.receivePulse + Math.min(1, nextState.receivedQty / 120));
  }
}

export function initProcess3DScene() {
  if (renderer || scene) {
    handleResize();
    return;
  }

  mountElement = document.getElementById('process-3d-scene');
  if (!mountElement) return;

  const rect = mountElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  clock = new THREE.Clock();
  camera = new THREE.PerspectiveCamera(42, rect.width / rect.height, 0.1, 100);
  camera.position.set(0.2, 4.2, 10.2);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(rect.width, rect.height, false);
  renderer.setClearColor(0x000000, 0);

  mountElement.innerHTML = '';
  mountElement.appendChild(renderer.domElement);

  createSceneObjects();
  setProcess3DStage('start-day');
  updateInventoryFill();
  animate();

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(mountElement);
  }

  window.addEventListener('resize', handleResize);
}