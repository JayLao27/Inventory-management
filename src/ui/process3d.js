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
const riceSackMeshes = [];
const stageOrbs = [];
const processPanels = [];

let routeMesh = null;

const sceneState = {
  stock: 0,
  baseStock: 1,
  demand: 0,
  pendingOrders: 0,
  nextReceiptDays: null,
  placedOrderQty: 0,
  receivedQty: 0,
  stockRatio: 0,
  missionText: 'Monitoring inventory flow.',
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
let dockTruckGroup = null;
let truckTravelT = 0.06;
let truckTargetT = 0.06;
let stageLabelMesh = null;
let warehouseBeacon = null;
let lastMissionText = '';
let stageMarkers = [];

const stageStepById = {
  'start-day': 0,
  'daily-sales': 1,
  'check-inventory': 1,
  'reduce-inventory': 2,
  'reorder-check': 2,
  'create-po': 3,
  'place-order': 3,
  'supplier-lead': 3,
  'stock-received': 4,
  'trigger-reorder': 1,
  'lost-customer': 1,
  'tally-lost': 3,
  'total': 4,
  'end-day': 4,
};

function buildMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.12,
  });
}

function formatDaysLabel(days) {
  if (!Number.isFinite(days) || days < 0) return '';
  return `${days} day${days === 1 ? '' : 's'}`;
}

function createTextSprite(initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.8, 1.2, 1);
  sprite.userData = { canvas, context, texture };

  updateTextSprite(sprite, initialText);
  return sprite;
}

function updateTextSprite(sprite, text) {
  if (!sprite?.userData?.context) return;
  const { canvas, context, texture } = sprite.userData;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(8, 18, 40, 0.84)';
  context.strokeStyle = 'rgba(251, 113, 133, 0.92)';
  context.lineWidth = 6;

  const width = canvas.width - 20;
  const height = canvas.height - 24;
  context.fillRect(10, 12, width, height);
  context.strokeRect(10, 12, width, height);

  context.fillStyle = '#f8fafc';
  context.font = '600 56px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  texture.needsUpdate = true;
}

function getMissionText() {
  if (sceneState.receivedQty > 0) {
    return `Order received at warehouse (+${sceneState.receivedQty})`;
  }

  if (sceneState.pendingOrders > 0 || sceneState.placedOrderQty > 0 || sceneState.stageId === 'supplier-lead') {
    const eta = formatDaysLabel(sceneState.nextReceiptDays);
    if (eta) {
      return `Order in transit to warehouse - ETA ${eta}`;
    }
    return 'Order in transit to warehouse';
  }

  if (sceneState.stageId === 'create-po' || sceneState.stageId === 'place-order') {
    return 'Creating purchase order for supplier';
  }

  return 'Monitoring inventory flow';
}

function createTruckModel({
  bodyColor = 0xf59e0b,
  cabinColor = 0xfbbf24,
  cargoColor = 0xf8fafc,
  cargoOpacity = 0.22,
} = {}) {
  const truck = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.48, 0.72),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.52, metalness: 0.08 }),
  );
  body.position.set(0.2, 0.42, 0);
  truck.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.5, 0.66),
    new THREE.MeshStandardMaterial({ color: cabinColor, roughness: 0.42, metalness: 0.08 }),
  );
  cabin.position.set(-0.42, 0.46, 0);
  truck.add(cabin);

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.56, 0.56),
    new THREE.MeshStandardMaterial({ color: cargoColor, roughness: 0.48, metalness: 0.1, transparent: true, opacity: cargoOpacity }),
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

  return truck;
}

function createTruck() {
  const truck = createTruckModel({
    bodyColor: 0xeab308,
    cabinColor: 0xf59e0b,
    cargoColor: 0xffffff,
    cargoOpacity: 0.88,
  });
  truck.position.set(-6.6, 0.08, 2.6);
  truck.rotation.y = -0.08;
  truck.rotation.z = Math.PI / 2;

  truckGroup = truck;
  scene.add(truck);
}

function createDockTruck() {
  const truck = createTruckModel({
    bodyColor: 0xd97706,
    cabinColor: 0xf59e0b,
    cargoColor: 0xf8fafc,
    cargoOpacity: 0.9,
  });
  truck.position.set(5.05, 0.08, 1.58);
  truck.rotation.y = Math.PI;
  truck.rotation.z = Math.PI / 2;
  truck.userData.baseX = 5.05;
  truck.userData.offset = 0;
  dockTruckGroup = truck;
  scene.add(truck);
}

function createProcessStructure() {
  const panelXPositions = [-5.8, -3.35, -0.9, 1.55, 4.0];
  const orbColors = [0x93c5fd, 0x86efac, 0xfbbf24, 0xf472b6, 0xbfdbfe];

  panelXPositions.forEach((x, index) => {
    const panelGroup = new THREE.Group();

    const header = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.48, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x273449, emissive: 0x111827, emissiveIntensity: 0.25, roughness: 0.48 }),
    );
    header.position.set(0, 2.95, 0.02);
    panelGroup.add(header);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.06, 1.56, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x475569, emissive: 0x0f172a, emissiveIntensity: 0.16, roughness: 0.6 }),
    );
    frame.position.set(0, 2.0, 0.06);
    panelGroup.add(frame);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(1.86, 1.34, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x1e293b, emissiveIntensity: 0.34, roughness: 0.54 }),
    );
    screen.position.set(0, 2.0, 0.14);
    panelGroup.add(screen);

    const iconColor = [0x60a5fa, 0x4ade80, 0xf59e0b, 0xfb7185, 0x93c5fd][index];
    const accentMat = new THREE.MeshStandardMaterial({ color: iconColor, emissive: iconColor, emissiveIntensity: 0.22, roughness: 0.44 });

    if (index === 0) {
      const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.36, 14), accentMat);
      sack.position.set(0.2, 1.74, 0.2);
      panelGroup.add(sack);
      const staff = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 8), accentMat);
      staff.position.set(-0.42, 1.76, 0.2);
      panelGroup.add(staff);
    } else if (index === 1) {
      const gatePole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 10), accentMat);
      gatePole.position.set(-0.25, 1.88, 0.2);
      panelGroup.add(gatePole);
      const gateArm = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.05), accentMat);
      gateArm.position.set(0.04, 2.06, 0.2);
      gateArm.rotation.z = -0.2;
      panelGroup.add(gateArm);
    } else if (index === 2) {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.48), accentMat);
      pallet.position.set(0.08, 1.66, 0.2);
      panelGroup.add(pallet);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 12), accentMat);
      arrow.position.set(0.08, 2.2, 0.2);
      arrow.rotation.x = Math.PI;
      panelGroup.add(arrow);
    } else if (index === 3) {
      for (let r = 0; r < 3; r++) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.08), accentMat);
        shelf.position.set(0, 1.6 + r * 0.24, 0.2);
        panelGroup.add(shelf);
      }
      const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.08), accentMat);
      scanner.position.set(0.56, 1.86, 0.2);
      panelGroup.add(scanner);
    } else {
      const gate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.08), accentMat);
      gate.position.set(0, 1.9, 0.2);
      panelGroup.add(gate);
    }

    panelGroup.position.set(x, 0, 0.08);
    scene.add(panelGroup);
    processPanels.push({ frame, screen, index });

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 18, 18),
      new THREE.MeshStandardMaterial({ color: orbColors[index], emissive: orbColors[index], emissiveIntensity: 0.24, roughness: 0.28 }),
    );
    orb.position.set(x + 0.15, 0.15, 1.78);
    scene.add(orb);
    stageOrbs.push(orb);
  });

  const dispatchGate = new THREE.Group();
  const arch = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 1.55, 1.45),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72, metalness: 0.08 }),
  );
  arch.position.set(5.12, 0.8, 1.54);
  dispatchGate.add(arch);

  const opening = new THREE.Mesh(
    new THREE.BoxGeometry(1.08, 1.02, 1.18),
    new THREE.MeshStandardMaterial({ color: 0x020617, emissive: 0x0ea5e9, emissiveIntensity: 0.08, roughness: 0.92 }),
  );
  opening.position.set(5.12, 0.7, 1.58);
  dispatchGate.add(opening);

  scene.add(dispatchGate);
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

function createRiceSackInventory() {
  const sackGroup = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.96, 28, 24),
    new THREE.MeshStandardMaterial({
      color: 0xe6d3a6,
      roughness: 0.82,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
      emissive: 0x472f10,
      emissiveIntensity: 0.08,
    }),
  );
  shell.scale.set(1, 1.2, 0.78);
  shell.position.y = 0.95;
  sackGroup.add(shell);
  riceSackMeshes.push(shell);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.38, 0.34, 20),
    new THREE.MeshStandardMaterial({ color: 0xf2e3c5, roughness: 0.86, metalness: 0 }),
  );
  neck.position.set(0, 1.95, 0);
  sackGroup.add(neck);
  riceSackMeshes.push(neck);

  const tie = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.03, 12, 28),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.76 }),
  );
  tie.rotation.x = Math.PI / 2;
  tie.position.set(0, 1.79, 0);
  sackGroup.add(tie);

  for (let layer = 0; layer < 12; layer++) {
    const radius = 0.68 - layer * 0.02;
    const riceLayer = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.96, radius, 0.11, 24),
      new THREE.MeshStandardMaterial({
        color: 0xfde68a,
        roughness: 0.72,
        metalness: 0,
        transparent: true,
        opacity: 0.95,
        emissive: 0xb45309,
        emissiveIntensity: 0.06,
      }),
    );
    riceLayer.position.y = 0.28 + layer * 0.11;
    riceLayer.position.x = Math.sin(layer * 0.7) * 0.01;
    riceLayer.position.z = Math.cos(layer * 0.65) * 0.015;
    sackGroup.add(riceLayer);
    inventoryBlocks.push(riceLayer);
  }

  sackGroup.position.set(2.75, 0, -0.28);
  scene.add(sackGroup);
}

function createWarehouseBeacon() {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.88, 12),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.68, metalness: 0.24 }),
  );
  pole.position.set(4.48, 0.48, 1.48);
  scene.add(pole);

  warehouseBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 18, 18),
    new THREE.MeshStandardMaterial({
      color: 0xf87171,
      emissive: 0xef4444,
      emissiveIntensity: 0.65,
      roughness: 0.25,
      metalness: 0.04,
    }),
  );
  warehouseBeacon.position.set(4.48, 0.96, 1.48);
  scene.add(warehouseBeacon);
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
  routeMesh = null;
  warehouseBeacon = null;
  dockTruckGroup = null;
  inventoryBlocks.length = 0;
  movingPackages.length = 0;
  pulseMeshes.length = 0;
  riceSackMeshes.length = 0;
  stageOrbs.length = 0;
  processPanels.length = 0;

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

  routeMesh = new THREE.Mesh(
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
  routeMesh.position.y = 0.02;
  scene.add(routeMesh);

  createWarehouseBuilding();
  createParkingLot();
  createProcessStructure();
  createRiceSackInventory();
  createTruck();
  createDockTruck();
  createWarehouseBeacon();

  stageLabelMesh = createTextSprite('Monitoring inventory flow');
  stageLabelMesh.position.set(-5.8, 1.72, 2.2);
  scene.add(stageLabelMesh);

  createPulse(0x22c55e, new THREE.Vector3(3.86, 1.5, 1.26));
  createPulse(0xf97316, new THREE.Vector3(0.9, 1.38, 1.1));

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
  sceneState.stockRatio = ratio;
  const filledCount = Math.round(ratio * inventoryBlocks.length);

  inventoryBlocks.forEach((block, index) => {
    const filled = index < filledCount;
    block.visible = filled;
    block.scale.set(1, filled ? 1 : 0.15, 1);
    block.material.opacity = filled ? 0.95 : 0.08;
  });

  riceSackMeshes.forEach((mesh) => {
    mesh.scale.y = THREE.MathUtils.lerp(0.82, 1.06, ratio);
  });
}

function updateMissionVisuals(elapsed) {
  const missionText = getMissionText();
  sceneState.missionText = missionText;

  if (stageLabelMesh && missionText !== lastMissionText) {
    updateTextSprite(stageLabelMesh, missionText);
    lastMissionText = missionText;
  }

  if (routeMesh?.material) {
    const inTransit = sceneState.pendingOrders > 0 || sceneState.placedOrderQty > 0;
    routeMesh.material.emissiveIntensity = inTransit ? 0.58 : 0.24;
    routeMesh.material.opacity = inTransit ? 0.7 : 0.45;
  }

  if (warehouseBeacon?.material) {
    const urgency = sceneState.receivedQty > 0 ? 1.25 : (sceneState.pendingOrders > 0 ? 0.92 : 0.38);
    warehouseBeacon.material.emissiveIntensity = urgency + Math.sin(elapsed * 7) * 0.15;
    warehouseBeacon.scale.setScalar(1 + urgency * 0.08 + Math.sin(elapsed * 8) * 0.03);
  }

  const caption = document.getElementById('process-3d-caption');
  if (caption) {
    const stockPercent = Math.round(sceneState.stockRatio * 100);
    caption.textContent = `${missionText}. Rice sack inventory: ${stockPercent}%`;
  }
}

function updateFlowIndicators(elapsed) {
  const activeStep = stageStepById[sceneState.stageId] ?? 0;

  stageOrbs.forEach((orb, index) => {
    const isPassed = index <= activeStep;
    const isActive = index === activeStep;
    const base = isPassed ? 0.95 : 0.2;
    const pulse = isActive ? Math.sin(elapsed * 7.5) * 0.35 : 0;
    orb.material.emissiveIntensity = base + pulse;
    const targetScale = isActive ? 1.2 : (isPassed ? 1.04 : 0.9);
    orb.scale.setScalar(THREE.MathUtils.lerp(orb.scale.x, targetScale, 0.14));
  });

  processPanels.forEach((panel) => {
    const lit = panel.index <= activeStep;
    panel.frame.material.emissiveIntensity = THREE.MathUtils.lerp(
      panel.frame.material.emissiveIntensity,
      lit ? 0.28 : 0.1,
      0.1,
    );
    panel.screen.material.emissiveIntensity = THREE.MathUtils.lerp(
      panel.screen.material.emissiveIntensity,
      lit ? 0.6 : 0.22,
      0.1,
    );
  });
}

function updateDockTruck(elapsed) {
  if (!dockTruckGroup) return;

  const outbound = sceneState.stageId === 'stock-received' || sceneState.stageId === 'total' || sceneState.stageId === 'end-day';
  const targetOffset = outbound ? 0.48 : 0;
  dockTruckGroup.userData.offset += (targetOffset - dockTruckGroup.userData.offset) * 0.08;
  dockTruckGroup.position.x = dockTruckGroup.userData.baseX + dockTruckGroup.userData.offset;
  dockTruckGroup.position.y = 0.08 + Math.sin(elapsed * 5.2) * 0.01;
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

  if (stageLabelMesh) {
    stageLabelMesh.position.copy(truckGroup.position);
    stageLabelMesh.position.y += 1.75 + Math.sin(clock.getElapsedTime() * 3.8) * 0.05;
    stageLabelMesh.position.z += 0.03;
  }
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
  updateMissionVisuals(elapsed);
  updateFlowIndicators(elapsed);
  updatePulses(elapsed);
  updatePackages(elapsed);
  updateTruck();
  updateDockTruck(elapsed);

  renderer.render(scene, camera);
  animationFrameId = window.requestAnimationFrame(animate);
}

export function updateProcess3DScene(nextState = {}) {
  if (Number.isFinite(nextState.stock)) sceneState.stock = nextState.stock;
  if (Number.isFinite(nextState.baseStock) && nextState.baseStock > 0) sceneState.baseStock = nextState.baseStock;
  if (Number.isFinite(nextState.demand)) sceneState.demand = nextState.demand;
  if (Number.isFinite(nextState.pendingOrders)) sceneState.pendingOrders = nextState.pendingOrders;
  if (Number.isFinite(nextState.nextReceiptDays)) {
    sceneState.nextReceiptDays = nextState.nextReceiptDays;
  } else if (nextState.nextReceiptDays === null) {
    sceneState.nextReceiptDays = null;
  }

  if (Number.isFinite(nextState.placedOrderQty)) {
    sceneState.placedOrderQty = nextState.placedOrderQty;
  }

  if (Number.isFinite(nextState.receivedQty)) {
    sceneState.receivedQty = nextState.receivedQty;
  }

  if (Number.isFinite(nextState.placedOrderQty) && nextState.placedOrderQty > 0) {
    sceneState.orderPulse = Math.min(1, sceneState.orderPulse + Math.min(1, nextState.placedOrderQty / 120));
    truckTargetT = stageTargets['supplier-lead'];
  }

  if (Number.isFinite(nextState.receivedQty) && nextState.receivedQty > 0) {
    sceneState.receivePulse = Math.min(1, sceneState.receivePulse + Math.min(1, nextState.receivedQty / 120));
    truckTargetT = stageTargets['stock-received'];
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