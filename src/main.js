import * as THREE from "../node_modules/three/build/three.module.js";
import "./styles.css";

const app = document.querySelector("#app");
const rainToggle = document.querySelector("#rainToggle");
const soundToggle = document.querySelector("#soundToggle");
const scoreValue = document.querySelector("#scoreValue");
const scoreMarkers = document.querySelector("#scoreMarkers");
const successBanner = document.querySelector("#successBanner");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x071314, 0.046);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x071314, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 9.2, 11.2);
camera.lookAt(0, 0, 0);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const worldPoint = new THREE.Vector3();

const palette = {
  waterDeep: new THREE.Color("#071314"),
  waterMid: new THREE.Color("#174642"),
  waterGlow: new THREE.Color("#7fb58f"),
  leaf: new THREE.Color("#2f7c55"),
  leafDark: new THREE.Color("#14533e"),
  lotusPink: new THREE.Color("#e9a8b8"),
  lotusLight: new THREE.Color("#ffe2e8"),
  gold: new THREE.Color("#ffab21"),
  amber: new THREE.Color("#e75f20")
};

let rainLevel = 1;
let audioWanted = true;
let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, t: performance.now() };
let currentRipple = new THREE.Vector2(20, 20);
let ripplePulse = 0;
let lastSplashAt = 0;
let caughtCount = 0;
let successShown = false;
let netActiveUntil = 0;
const netTarget = new THREE.Vector3(0, 0.36, 0);
const netPosition = new THREE.Vector3(0, 0.36, 0);
const previousNetPosition = new THREE.Vector3(0, 0.36, 0);
const netVelocity = new THREE.Vector3();
const flopEffects = [];
const bucketPosition = new THREE.Vector3(7.1, 0.32, 4.55);
let netCarry = null;
let heldFishVisual = null;
let mobileMode = false;

const audio = {
  context: null,
  master: null,
  rainGain: null,
  musicGain: null,
  fxGain: null,
  rainSource: null,
  musicTimer: null,
  enabled: false,
  nextChord: 0
};

const ambient = new THREE.HemisphereLight(0x9ebfbd, 0x061111, 1.5);
scene.add(ambient);

const moon = new THREE.DirectionalLight(0xdfefff, 2.2);
moon.position.set(-4, 10, 6);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
scene.add(moon);

const warm = new THREE.PointLight(0xffba61, 1.5, 18);
warm.position.set(4, 2.6, -3);
scene.add(warm);

const waterUniforms = {
  uTime: { value: 0 },
  uRipple: { value: currentRipple },
  uPulse: { value: 0 },
  uDeep: { value: palette.waterDeep },
  uMid: { value: palette.waterMid },
  uGlow: { value: palette.waterGlow }
};

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(28, 22, 160, 120),
  new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float waveA = sin((pos.x * 1.4 + uTime * 0.65) + cos(pos.y * 1.2)) * 0.035;
        float waveB = sin((pos.y * 2.2 - uTime * 0.8) + pos.x * 0.45) * 0.025;
        pos.z += waveA + waveB;
        vWave = waveA + waveB;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uRipple;
      uniform float uPulse;
      uniform vec3 uDeep;
      uniform vec3 uMid;
      uniform vec3 uGlow;
      varying vec2 vUv;
      varying float vWave;

      float ring(vec2 p, vec2 c, float r, float width) {
        float d = distance(p, c);
        return smoothstep(width, 0.0, abs(d - r));
      }

      void main() {
        vec2 p = vUv;
        float shade = smoothstep(0.0, 1.0, p.y) * 0.65 + smoothstep(0.0, 1.0, p.x) * 0.22;
        float threads = sin((p.x * 42.0 + p.y * 26.0) + uTime * 0.65) * 0.025;
        float rain = ring(p, uRipple, 0.05 + uPulse * 0.34, 0.015) * (1.0 - uPulse);
        vec3 color = mix(uDeep, uMid, shade + threads + vWave);
        color = mix(color, uGlow, rain * 0.55);
        color += vec3(0.015, 0.035, 0.03) * sin(uTime + p.y * 18.0);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  })
);
water.rotation.x = -Math.PI / 2;
water.receiveShadow = true;
scene.add(water);

const pondEdge = new THREE.Mesh(
  new THREE.RingGeometry(10.4, 13.6, 96),
  new THREE.MeshStandardMaterial({
    color: 0x24322a,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0.8
  })
);
pondEdge.rotation.x = -Math.PI / 2;
pondEdge.position.y = -0.035;
scene.add(pondEdge);

function createLeafShape() {
  const shape = new THREE.Shape();
  const radius = 1;
  const start = 0.34;
  const end = Math.PI * 2 - 0.42;
  shape.moveTo(0, 0);
  for (let i = 0; i <= 72; i += 1) {
    const a = start + (end - start) * (i / 72);
    const r = radius * (0.96 + Math.sin(a * 3.0) * 0.025);
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.lineTo(0, 0);
  return shape;
}

const leafGeometry = new THREE.ShapeGeometry(createLeafShape());
const leafMaterial = new THREE.MeshStandardMaterial({
  color: palette.leaf,
  roughness: 0.78,
  metalness: 0.02,
  side: THREE.DoubleSide
});

const leafDarkMaterial = new THREE.MeshStandardMaterial({
  color: palette.leafDark,
  roughness: 0.85,
  side: THREE.DoubleSide
});

const veinMaterial = new THREE.LineBasicMaterial({ color: 0xb4d49a, transparent: true, opacity: 0.4 });
const lotusGroup = new THREE.Group();
scene.add(lotusGroup);

const leaves = [
  [-5.2, -2.2, 1.65, 0.94, -0.25],
  [-3.5, 3.2, 1.25, 0.78, 1.2],
  [3.9, 2.8, 1.55, 0.9, -1.1],
  [5.0, -2.7, 1.15, 0.78, 0.7],
  [0.3, -4.1, 1.45, 0.83, 2.2],
  [-0.5, 4.5, 1.1, 0.76, -2.1],
  [6.3, 0.4, 0.88, 0.66, 0.15],
  [-6.4, 0.6, 0.96, 0.7, -0.6]
];

function addVeins(parent, scaleX, scaleZ) {
  const positions = [];
  for (let i = 0; i < 9; i += 1) {
    const angle = -2.35 + i * 0.55;
    positions.push(0, 0.02, 0);
    positions.push(Math.cos(angle) * 0.82 * scaleX, 0.02, Math.sin(angle) * 0.82 * scaleZ);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const veins = new THREE.LineSegments(geometry, veinMaterial);
  parent.add(veins);
}

for (const [x, z, sx, sz, rot] of leaves) {
  const leaf = new THREE.Group();
  const mesh = new THREE.Mesh(leafGeometry, Math.random() > 0.28 ? leafMaterial : leafDarkMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(sx, sz, 1);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  leaf.add(mesh);
  addVeins(leaf, sx, sz);
  leaf.position.set(x, 0.13, z);
  leaf.rotation.y = rot;
  lotusGroup.add(leaf);
}

function makePetal(color, scale = 1) {
  const petal = new THREE.Mesh(
    new THREE.SphereGeometry(0.22 * scale, 18, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.66, side: THREE.DoubleSide })
  );
  petal.scale.set(0.55, 0.18, 1.15);
  petal.castShadow = true;
  return petal;
}

function createLotusFlower(x, z, size, open = 1) {
  const flower = new THREE.Group();
  const layers = [
    { count: 9, radius: 0.26, y: 0.1, color: palette.lotusPink, lift: 0.62 },
    { count: 7, radius: 0.18, y: 0.22, color: palette.lotusLight, lift: 0.86 }
  ];
  for (const layer of layers) {
    for (let i = 0; i < layer.count; i += 1) {
      const a = (i / layer.count) * Math.PI * 2 + layer.y;
      const petal = makePetal(layer.color, size);
      petal.position.set(Math.cos(a) * layer.radius * size, layer.y * size, Math.sin(a) * layer.radius * size);
      petal.rotation.y = -a + Math.PI / 2;
      petal.rotation.x = -0.7 * open;
      petal.rotation.z = Math.sin(a) * 0.22;
      flower.add(petal);
    }
  }
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.12 * size, 18, 10),
    new THREE.MeshStandardMaterial({ color: 0xf3c04a, roughness: 0.5 })
  );
  core.position.y = 0.3 * size;
  flower.add(core);
  flower.position.set(x, 0.3, z);
  flower.rotation.y = Math.random() * Math.PI * 2;
  lotusGroup.add(flower);
  return flower;
}

const flowers = [
  createLotusFlower(-4.2, 2.4, 1.2, 1),
  createLotusFlower(4.6, -1.9, 0.9, 0.75),
  createLotusFlower(1.5, 3.9, 0.72, 0.9)
];

const fishBodyGeometry = new THREE.SphereGeometry(0.28, 24, 16);
const tailGeometry = new THREE.ConeGeometry(0.18, 0.42, 3);
const finGeometry = new THREE.ConeGeometry(0.09, 0.26, 3);
const eyeGeometry = new THREE.SphereGeometry(0.026, 8, 8);
const fishMats = [
  new THREE.MeshStandardMaterial({ color: 0xffa329, roughness: 0.45, metalness: 0.02 }),
  new THREE.MeshStandardMaterial({ color: 0xffc547, roughness: 0.4, metalness: 0.03 }),
  new THREE.MeshStandardMaterial({ color: 0xe95f23, roughness: 0.5, metalness: 0.01 })
];
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x24110b, roughness: 0.2 });

class Goldfish {
  constructor(index, x, z) {
    this.group = new THREE.Group();
    this.index = index;
    this.position = new THREE.Vector3(x, 0.17 + Math.random() * 0.05, z);
    this.velocity = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.45);
    this.home = new THREE.Vector3(x, this.position.y, z);
    this.target = this.randomTarget();
    this.state = "wander";
    this.fleeTime = 0;
    this.returnTime = 0;
    this.caughtCooldown = 0;
    this.tailPhase = Math.random() * Math.PI * 2;
    this.turnEase = Math.random() * 0.2 + 0.08;
    this.makeMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);
  }

  makeMesh() {
    const mat = fishMats[this.index % fishMats.length];
    const body = new THREE.Mesh(fishBodyGeometry, mat);
    body.scale.set(1.15, 0.36, 0.62);
    body.castShadow = true;
    this.group.add(body);

    this.tail = new THREE.Mesh(tailGeometry, fishMats[(this.index + 1) % fishMats.length]);
    this.tail.position.set(-0.36, 0, 0);
    this.tail.rotation.z = Math.PI / 2;
    this.tail.rotation.y = Math.PI / 2;
    this.tail.scale.set(1.08, 1.0, 0.82);
    this.tail.castShadow = true;
    this.group.add(this.tail);

    const topFin = new THREE.Mesh(finGeometry, mat);
    topFin.position.set(-0.04, 0.12, 0);
    topFin.rotation.z = Math.PI;
    topFin.scale.set(0.9, 0.9, 0.65);
    this.group.add(topFin);

    const leftFin = new THREE.Mesh(finGeometry, mat);
    leftFin.position.set(0.08, -0.02, 0.21);
    leftFin.rotation.x = Math.PI / 2.8;
    leftFin.rotation.z = -Math.PI / 2;
    leftFin.scale.set(0.85, 0.7, 0.5);
    this.group.add(leftFin);

    const rightFin = leftFin.clone();
    rightFin.position.z = -0.21;
    rightFin.rotation.x = -Math.PI / 2.8;
    this.group.add(rightFin);

    const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMat);
    eyeLeft.position.set(0.22, 0.06, 0.17);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.z = -0.17;
    this.group.add(eyeLeft, eyeRight);
  }

  randomTarget() {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.4 + Math.random() * 3.8;
    return new THREE.Vector3(Math.cos(angle) * radius, this.position?.y ?? 0.2, Math.sin(angle) * radius);
  }

  fleeFrom(point, strength) {
    const away = this.position.clone().sub(point);
    away.y = 0;
    const dist = Math.max(away.length(), 0.25);
    if (dist > 4.6 && strength < 1.6) return;
    away.normalize();
    this.velocity.add(away.multiplyScalar(1.55 + strength * 0.65));
    this.target.copy(this.position).add(away.multiplyScalar(3.2 + Math.random() * 2.5));
    this.target.x = THREE.MathUtils.clamp(this.target.x, -8.8, 8.8);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -6.7, 6.7);
    this.state = "flee";
    this.fleeTime = 1.5 + Math.random() * 1.1;
  }

  update(delta, elapsed) {
    if (this.caughtCooldown > 0) {
      this.caughtCooldown -= delta;
      if (this.caughtCooldown <= 0) {
        this.group.visible = true;
        this.position.copy(this.randomTarget());
        this.home.copy(this.position);
        this.target = this.randomTarget();
        this.state = "wander";
      }
      return;
    }

    this.tailPhase += delta * (this.state === "flee" ? 22 : 9);
    this.tail.rotation.x = Math.sin(this.tailPhase) * (this.state === "flee" ? 0.62 : 0.28);

    if (this.state === "flee") {
      this.fleeTime -= delta;
      if (this.fleeTime <= 0) {
        this.state = "return";
        this.target.copy(this.home).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
        this.returnTime = 2.6 + Math.random();
      }
    } else if (this.state === "return") {
      this.returnTime -= delta;
      if (this.position.distanceTo(this.home) < 0.8 || this.returnTime <= 0) {
        this.state = "wander";
        this.target = this.randomTarget();
      }
    } else if (this.position.distanceTo(this.target) < 0.45 || Math.random() < delta * 0.22) {
      this.target = this.randomTarget();
    }

    const desired = this.target.clone().sub(this.position);
    desired.y = 0;
    const desiredLength = desired.length();
    if (desiredLength > 0.001) desired.normalize();

    const boundary = this.position.clone();
    boundary.y = 0;
    const boundaryDist = boundary.length();
    if (boundaryDist > 8.2) {
      desired.add(boundary.multiplyScalar(-0.18).normalize());
    }

    const speed = this.state === "flee" ? 2.6 : this.state === "return" ? 0.78 : 0.46;
    this.velocity.lerp(desired.multiplyScalar(speed), this.turnEase);
    this.velocity.multiplyScalar(this.state === "flee" ? 0.993 : 0.985);
    this.position.addScaledVector(this.velocity, delta);
    this.position.y = 0.18 + Math.sin(elapsed * 1.5 + this.index) * 0.035;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -9.2, 9.2);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -7.2, 7.2);

    const angle = Math.atan2(this.velocity.x, this.velocity.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = angle;
    this.group.rotation.z = Math.sin(elapsed * 2.4 + this.index) * 0.04;
  }
}

const fish = [
  new Goldfish(0, -1.6, -0.8),
  new Goldfish(1, 0.8, -1.4),
  new Goldfish(2, 2.0, 0.6),
  new Goldfish(3, -2.7, 1.3),
  new Goldfish(4, 3.0, -2.6),
  new Goldfish(5, -0.6, 2.2),
  new Goldfish(6, 1.7, 2.7)
];

function createFishingNet() {
  const group = new THREE.Group();
  function cylinderBetween(start, end, radius, material) {
    const middle = start.clone().add(end).multiplyScalar(0.5);
    const direction = end.clone().sub(start);
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 14), material);
    cylinder.position.copy(middle);
    cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    cylinder.castShadow = true;
    return cylinder;
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.04, 14, 72),
    new THREE.MeshStandardMaterial({ color: 0xf1dfae, roughness: 0.42, metalness: 0.04 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  group.add(ring);

  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.64, 40),
    new THREE.MeshBasicMaterial({ color: 0xe7f8ef, transparent: true, opacity: 0.14, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.08;
  mesh.scale.setScalar(0.9);
  group.add(mesh);

  const crossMaterial = new THREE.LineBasicMaterial({ color: 0xf4edd0, transparent: true, opacity: 0.45 });
  const linePositions = [];
  for (let i = -2; i <= 2; i += 1) {
    linePositions.push(-0.54, 0.012, i * 0.22, 0.54, 0.012, i * 0.22);
    linePositions.push(i * 0.22, 0.012, -0.54, i * 0.22, 0.012, 0.54);
  }
  const crossGeometry = new THREE.BufferGeometry();
  crossGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  group.add(new THREE.LineSegments(crossGeometry, crossMaterial));

  const sagPositions = [];
  const sagRadius = 0.63;
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    const rim = new THREE.Vector3(Math.cos(a) * sagRadius, 0.02, Math.sin(a) * sagRadius);
    const pocket = new THREE.Vector3(Math.cos(a) * 0.26, -0.27, Math.sin(a) * 0.26);
    sagPositions.push(rim.x, rim.y, rim.z, pocket.x, pocket.y, pocket.z);
    const next = ((i + 1) / 18) * Math.PI * 2;
    sagPositions.push(
      pocket.x,
      pocket.y,
      pocket.z,
      Math.cos(next) * 0.26,
      -0.27,
      Math.sin(next) * 0.26
    );
  }
  const sagGeometry = new THREE.BufferGeometry();
  sagGeometry.setAttribute("position", new THREE.Float32BufferAttribute(sagPositions, 3));
  const sagNet = new THREE.LineSegments(
    sagGeometry,
    new THREE.LineBasicMaterial({ color: 0xe9fff4, transparent: true, opacity: 0.52 })
  );
  group.add(sagNet);

  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xf1b24b, roughness: 0.58, metalness: 0.02 });
  const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x36a6a1, roughness: 0.55, metalness: 0.02 });
  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xff6f61, roughness: 0.48, metalness: 0.02 });
  const connectorMaterial = new THREE.MeshStandardMaterial({ color: 0xe9d4a0, roughness: 0.38, metalness: 0.08 });
  const connectorStart = new THREE.Vector3(0.48, 0.02, 0.42);
  const connectorEnd = new THREE.Vector3(0.88, -0.04, 0.78);
  const poleStart = connectorEnd;
  const poleEnd = new THREE.Vector3(2.1, -0.14, 1.78);

  group.add(cylinderBetween(connectorStart, connectorEnd, 0.055, connectorMaterial));
  group.add(cylinderBetween(poleStart, poleEnd, 0.045, poleMaterial));
  group.add(cylinderBetween(new THREE.Vector3(2.08, -0.14, 1.76), new THREE.Vector3(2.55, -0.18, 2.16), 0.07, gripMaterial));
  group.add(cylinderBetween(new THREE.Vector3(1.96, -0.13, 1.66), new THREE.Vector3(2.05, -0.14, 1.74), 0.074, bandMaterial));
  group.add(cylinderBetween(new THREE.Vector3(2.38, -0.17, 2.05), new THREE.Vector3(2.47, -0.18, 2.13), 0.076, bandMaterial));

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), connectorMaterial);
  joint.position.copy(connectorEnd);
  joint.castShadow = true;
  group.add(joint);

  group.position.copy(netPosition);
  scene.add(group);
  return group;
}

const fishingNet = createFishingNet();

function createBucket() {
  const group = new THREE.Group();
  const side = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.72, 0.32, 36, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2b8fc0, roughness: 0.58, metalness: 0.04, side: THREE.DoubleSide })
  );
  side.position.y = 0.16;
  side.castShadow = true;
  group.add(side);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.86, 0.055, 14, 56),
    new THREE.MeshStandardMaterial({ color: 0x9edcef, roughness: 0.38, metalness: 0.08 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.34;
  rim.castShadow = true;
  group.add(rim);

  const waterInBucket = new THREE.Mesh(
    new THREE.CircleGeometry(0.74, 40),
    new THREE.MeshBasicMaterial({ color: 0x4fc3cf, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
  );
  waterInBucket.rotation.x = -Math.PI / 2;
  waterInBucket.position.y = 0.345;
  group.add(waterInBucket);

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.94, 0.025, 10, 48, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xd6f5ff, roughness: 0.42, metalness: 0.12 })
  );
  handle.position.set(0, 0.35, -0.1);
  handle.rotation.x = Math.PI / 2;
  handle.rotation.z = Math.PI;
  group.add(handle);

  group.position.copy(bucketPosition);
  scene.add(group);
  return group;
}

const bucket = createBucket();

function createHeldFishVisual() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(fishBodyGeometry, fishMats[0]);
  body.scale.set(0.82, 0.26, 0.44);
  group.add(body);

  const tail = new THREE.Mesh(tailGeometry, fishMats[1]);
  tail.position.set(-0.26, 0, 0);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = Math.PI / 2;
  tail.scale.set(0.72, 0.68, 0.55);
  group.add(tail);

  group.position.set(0, -0.12, 0);
  group.rotation.y = Math.PI * 0.3;
  group.visible = false;
  group.userData.tail = tail;
  fishingNet.add(group);
  return group;
}

heldFishVisual = createHeldFishVisual();

function setNetTarget(point, force = false) {
  if (netCarry && !force) return;
  const xLimit = mobileMode ? 6.4 : 9.2;
  const zLimit = mobileMode ? 5.6 : 7.2;
  netTarget.set(
    THREE.MathUtils.clamp(point.x, -xLimit, xLimit),
    0.36,
    THREE.MathUtils.clamp(point.z, -zLimit, zLimit)
  );
  netActiveUntil = performance.now() + 900;
}

function updateScore() {
  scoreValue.textContent = String(caughtCount);
  scoreMarkers.innerHTML = "";
  for (let i = 0; i < Math.min(caughtCount, 30); i += 1) {
    const marker = document.createElement("span");
    marker.className = "score-marker";
    scoreMarkers.appendChild(marker);
  }
  if (caughtCount >= 30 && !successShown) {
    successShown = true;
    successBanner.hidden = false;
  }
}

function spawnFlopEffect(origin) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(fishBodyGeometry, fishMats[1]);
  body.scale.set(0.9, 0.28, 0.48);
  body.castShadow = true;
  group.add(body);

  const tail = new THREE.Mesh(tailGeometry, fishMats[2]);
  tail.position.set(-0.29, 0, 0);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = Math.PI / 2;
  tail.scale.set(0.82, 0.78, 0.62);
  group.add(tail);

  const dropletMaterial = new THREE.MeshBasicMaterial({ color: 0xd6fff6, transparent: true, opacity: 0.52 });
  for (let i = 0; i < 5; i += 1) {
    const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.025 + Math.random() * 0.018, 8, 6), dropletMaterial);
    droplet.position.set((Math.random() - 0.5) * 0.5, 0.04 + Math.random() * 0.18, (Math.random() - 0.5) * 0.5);
    droplet.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.55 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6);
    group.add(droplet);
  }

  group.position.copy(origin).add(new THREE.Vector3(0, 0.32, 0));
  scene.add(group);
  flopEffects.push({ group, tail, age: 0, duration: 1.05, origin: origin.clone() });
}

function updateFlopEffects(delta) {
  for (let i = flopEffects.length - 1; i >= 0; i -= 1) {
    const effect = flopEffects[i];
    effect.age += delta;
    const t = effect.age / effect.duration;
    if (t >= 1) {
      scene.remove(effect.group);
      flopEffects.splice(i, 1);
      continue;
    }
    const jump = Math.sin(t * Math.PI) * 0.85;
    effect.group.position.set(
      effect.origin.x + Math.sin(t * Math.PI * 2) * 0.18,
      effect.origin.y + 0.32 + jump,
      effect.origin.z + Math.cos(t * Math.PI * 2) * 0.12
    );
    effect.group.rotation.z = Math.sin(t * Math.PI * 5) * 0.75;
    effect.group.rotation.y = t * Math.PI * 2.4;
    effect.tail.rotation.x = Math.sin(t * Math.PI * 12) * 0.75;
    for (const child of effect.group.children) {
      if (!child.userData.velocity) continue;
      child.position.addScaledVector(child.userData.velocity, delta);
      child.userData.velocity.y -= delta * 1.6;
      child.material.opacity = Math.max(0, 0.52 * (1 - t));
    }
  }
}

function addFishToBucket() {
  const fishInBucket = new THREE.Mesh(
    fishBodyGeometry,
    fishMats[caughtCount % fishMats.length]
  );
  fishInBucket.scale.set(0.36, 0.1, 0.18);
  fishInBucket.rotation.y = Math.random() * Math.PI * 2;
  fishInBucket.position.set((Math.random() - 0.5) * 0.82, 0.37 + caughtCount * 0.006, (Math.random() - 0.5) * 0.62);
  bucket.add(fishInBucket);
}

function dropFishIntoBucket() {
  if (!netCarry) return;
  caughtCount += 1;
  updateScore();
  addFishToBucket();
  playSplash(1.7);
  spawnFlopEffect(bucketPosition);

  netCarry.fish.caughtCooldown = 1.25;
  netCarry.fish.group.visible = false;
  netCarry.fish.velocity.set(0, 0, 0);
  heldFishVisual.visible = false;
  netCarry = null;
}

function updateNetCarry(delta, elapsed) {
  if (!netCarry) return;
  netCarry.age += delta;
  netActiveUntil = performance.now() + 900;

  heldFishVisual.rotation.z = Math.sin(elapsed * 18) * 0.35;
  heldFishVisual.rotation.y = Math.sin(elapsed * 7) * 0.45;
  heldFishVisual.userData.tail.rotation.x = Math.sin(elapsed * 22) * 0.8;

  if (netCarry.phase === "lift" && netCarry.age > 0.36) {
    netCarry.phase = "carry";
    netCarry.age = 0;
  }

  if (netCarry.phase === "carry") {
    setNetTarget(bucketPosition, true);
    const dx = netPosition.x - bucketPosition.x;
    const dz = netPosition.z - bucketPosition.z;
    if (Math.sqrt(dx * dx + dz * dz) < 0.48) {
      netCarry.phase = "drop";
      netCarry.age = 0;
    }
    return;
  }

  if (netCarry.phase === "drop") {
    heldFishVisual.position.y = THREE.MathUtils.lerp(-0.13, -0.58, Math.min(netCarry.age / 0.48, 1));
    if (netCarry.age > 0.5) {
      dropFishIntoBucket();
    }
  }
}

function catchFish(one) {
  if (netCarry || one.caughtCooldown > 0 || !one.group.visible) return;
  playSplash(1.7);
  one.caughtCooldown = 999;
  one.group.visible = false;
  one.velocity.set(0, 0, 0);
  heldFishVisual.visible = true;
  heldFishVisual.position.set(0, -0.13, 0);
  netCarry = {
    fish: one,
    age: 0,
    phase: "lift"
  };
  netActiveUntil = performance.now() + 2600;
}

function updateFishingNet(delta, elapsed) {
  previousNetPosition.copy(netPosition);
  netPosition.lerp(netTarget, 1 - Math.exp(-delta * 12));
  netVelocity.copy(netPosition).sub(previousNetPosition);
  fishingNet.position.copy(netPosition);
  fishingNet.rotation.y = Math.sin(elapsed * 2.2) * 0.12;
  fishingNet.rotation.z = Math.sin(elapsed * 3.6) * 0.04;

  const active = performance.now() < netActiveUntil;
  fishingNet.visible = active || caughtCount === 0;
  if (!active) return;

  if (netCarry) {
    updateNetCarry(delta, elapsed);
    return;
  }

  for (const one of fish) {
    if (one.caughtCooldown > 0 || !one.group.visible) continue;
    const dx = one.position.x - netPosition.x;
    const dz = one.position.z - netPosition.z;
    const closeEnough = Math.sqrt(dx * dx + dz * dz) < 0.82;
    const netBelowFish = netPosition.z > one.position.z + 0.16;
    const scoopingUp = netVelocity.z < -0.015;
    const netPocketUnderFish = netPosition.y - 0.27 < one.position.y;
    if (closeEnough && netBelowFish && scoopingUp && netPocketUnderFish) {
      catchFish(one);
      break;
    }
  }
}

updateScore();

function createNoiseBuffer(context, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function makeGain(context, value) {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}

function rampGain(gain, value, time = 0.45) {
  if (!audio.context || !gain) return;
  const now = audio.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(value, now, time);
}

function scheduleRain() {
  const context = audio.context;
  const rainNoise = context.createBufferSource();
  rainNoise.buffer = createNoiseBuffer(context, 3);
  rainNoise.loop = true;

  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 950;

  const bandPass = context.createBiquadFilter();
  bandPass.type = "bandpass";
  bandPass.frequency.value = 2800;
  bandPass.Q.value = 0.75;

  rainNoise.connect(highPass);
  highPass.connect(bandPass);
  bandPass.connect(audio.rainGain);
  rainNoise.start();
  audio.rainSource = rainNoise;
}

function playSoftTone(frequency, start, duration, level, type = "sine") {
  const context = audio.context;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(level, start + 0.16);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(audio.musicGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.08);
}

function playMusicPhrase() {
  if (!audio.context || !audio.enabled) return;
  const context = audio.context;
  const baseChords = [
    [196, 246.94, 329.63, 392],
    [174.61, 220, 293.66, 349.23],
    [207.65, 261.63, 329.63, 415.3],
    [146.83, 196, 246.94, 329.63]
  ];
  const chord = baseChords[audio.nextChord % baseChords.length];
  const start = context.currentTime + 0.05;
  chord.forEach((note, index) => {
    playSoftTone(note, start + index * 0.055, 3.2, index === 0 ? 0.026 : 0.014, index === 0 ? "triangle" : "sine");
    playSoftTone(note * 2, start + 0.18 + index * 0.035, 2.2, 0.0045, "sine");
  });
  const melody = [chord[2], chord[3], chord[1] * 2, chord[2] * 2];
  melody.forEach((note, index) => {
    playSoftTone(note, start + 0.7 + index * 0.42, 1.4, 0.01, "sine");
  });
  audio.nextChord += 1;
}

function playSplash(strength = 1) {
  if (!audio.context || !audio.enabled) return;
  const context = audio.context;
  const now = context.currentTime;

  const noise = context.createBufferSource();
  noise.buffer = createNoiseBuffer(context, 0.22);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(820, now);
  filter.frequency.exponentialRampToValueAtTime(2200, now + 0.12);
  filter.Q.value = 1.2;
  const burst = context.createGain();
  burst.gain.setValueAtTime(0.0001, now);
  burst.gain.exponentialRampToValueAtTime(0.22 * strength, now + 0.025);
  burst.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  noise.connect(filter);
  filter.connect(burst);
  burst.connect(audio.fxGain);
  noise.start(now);
  noise.stop(now + 0.3);

  const pluck = context.createOscillator();
  const pluckGain = context.createGain();
  pluck.type = "triangle";
  pluck.frequency.setValueAtTime(210 + strength * 55, now);
  pluck.frequency.exponentialRampToValueAtTime(92, now + 0.22);
  pluckGain.gain.setValueAtTime(0.0001, now);
  pluckGain.gain.exponentialRampToValueAtTime(0.08 * strength, now + 0.018);
  pluckGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  pluck.connect(pluckGain);
  pluckGain.connect(audio.fxGain);
  pluck.start(now);
  pluck.stop(now + 0.27);
}

async function startAudio() {
  if (audio.context) {
    await audio.context.resume();
    audio.enabled = true;
    rampGain(audio.master, 0.9, 0.2);
    rampGain(audio.rainGain, 0.035 + rainLevel * 0.07, 0.35);
    rampGain(audio.musicGain, 0.16, 0.8);
    soundToggle.classList.add("is-active");
    return;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audio.context = new AudioContext();
  audio.master = makeGain(audio.context, 0.0001);
  audio.rainGain = makeGain(audio.context, 0.035 + rainLevel * 0.07);
  audio.musicGain = makeGain(audio.context, 0.0001);
  audio.fxGain = makeGain(audio.context, 0.42);
  audio.rainGain.connect(audio.master);
  audio.musicGain.connect(audio.master);
  audio.fxGain.connect(audio.master);
  audio.master.connect(audio.context.destination);
  scheduleRain();
  audio.enabled = true;
  rampGain(audio.master, 0.9, 0.2);
  rampGain(audio.musicGain, 0.16, 1.2);
  playMusicPhrase();
  audio.musicTimer = window.setInterval(playMusicPhrase, 4200);
  soundToggle.classList.add("is-active");
}

function stopAudio() {
  if (!audio.context) return;
  audioWanted = false;
  audio.enabled = false;
  rampGain(audio.master, 0.0001, 0.25);
  soundToggle.classList.remove("is-active");
}

function toggleAudio() {
  if (audio.enabled) {
    stopAudio();
  } else {
    audioWanted = true;
    startAudio();
  }
}

function unlockDefaultAudio() {
  if (!audioWanted || audio.enabled) return;
  startAudio();
}

function createRain() {
  const count = 760;
  const positions = new Float32Array(count * 6);
  const speeds = [];
  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() - 0.5) * 24;
    const y = Math.random() * 12 + 1.4;
    const z = (Math.random() - 0.5) * 18;
    const len = 0.35 + Math.random() * 0.42;
    const idx = i * 6;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    positions[idx + 3] = x - 0.16;
    positions[idx + 4] = y - len;
    positions[idx + 5] = z + 0.08;
    speeds.push(6 + Math.random() * 5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xbdd5d2, transparent: true, opacity: 0.48 });
  const lines = new THREE.LineSegments(geometry, material);
  lines.userData.speeds = speeds;
  lines.userData.count = count;
  scene.add(lines);
  return lines;
}

const rain = createRain();

function createMist() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xc7dfd9,
    transparent: true,
    opacity: 0.07,
    depthWrite: false
  });
  for (let i = 0; i < 18; i += 1) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8 + Math.random() * 2.8, 0.24), material);
    mesh.position.set((Math.random() - 0.5) * 16, 0.24 + Math.random() * 0.6, (Math.random() - 0.5) * 10);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI;
    mesh.userData.speed = 0.04 + Math.random() * 0.1;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

const mist = createMist();

function createRipples() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xd4efe8,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  for (let i = 0; i < 28; i += 1) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.085, 32), material.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set((Math.random() - 0.5) * 18, 0.025, (Math.random() - 0.5) * 13);
    ring.userData.life = Math.random();
    ring.userData.speed = 0.36 + Math.random() * 0.5;
    ring.userData.max = 0.4 + Math.random() * 0.75;
    group.add(ring);
  }
  scene.add(group);
  return group;
}

const ripples = createRipples();

function screenToWater(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.intersectPlane(waterPlane, worldPoint);
  return worldPoint.clone();
}

function triggerWave(point, strength = 1.2) {
  currentRipple.set((point.x + 14) / 28, 1 - (point.z + 11) / 22);
  ripplePulse = 0;
  const now = performance.now();
  if (now - lastSplashAt > 220) {
    playSplash(THREE.MathUtils.clamp(strength, 0.8, 2.6));
    lastSplashAt = now;
  }
  for (const one of fish) one.fleeFrom(point, strength);
}

function onPointerMove(event) {
  event.preventDefault();
  const now = performance.now();
  const dt = Math.max(now - lastPointer.t, 16);
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  const speed = Math.sqrt(dx * dx + dy * dy) / dt;
  const point = screenToWater(event.clientX, event.clientY);
  setNetTarget(point);
  if (!mobileMode && speed > 1.15) {
    triggerWave(point, THREE.MathUtils.clamp(speed * 0.65, 1.1, 3.2));
  }
  lastPointer = { x: event.clientX, y: event.clientY, t: now };
}

renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: false });
renderer.domElement.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unlockDefaultAudio();
  const point = screenToWater(event.clientX, event.clientY);
  setNetTarget(point);
  if (!mobileMode) {
    triggerWave(point, 1.35);
  }
});

rainToggle.classList.add("is-active");
rainToggle.addEventListener("click", unlockDefaultAudio);

soundToggle.addEventListener("click", toggleAudio);
window.addEventListener("pointerdown", unlockDefaultAudio, { once: true, passive: true });
window.addEventListener("keydown", unlockDefaultAudio, { once: true });

function updateRainCycle(elapsed) {
  const slow = (Math.sin(elapsed * 0.18) + 1) * 0.5;
  const gust = Math.max(0, Math.sin(elapsed * 0.73 + 1.8)) * 0.18;
  rainLevel = THREE.MathUtils.clamp(0.32 + slow * 0.5 + gust, 0.28, 1);
  rainToggle.style.opacity = String(0.62 + rainLevel * 0.38);
  if (audio.context && audio.enabled) {
    rampGain(audio.rainGain, 0.025 + rainLevel * 0.075, 0.75);
  }
}

function updateRain(delta) {
  const positions = rain.geometry.attributes.position.array;
  const factor = 0.35 + rainLevel * 0.9;
  rain.material.opacity = 0.18 + rainLevel * 0.34;
  for (let i = 0; i < rain.userData.count; i += 1) {
    const idx = i * 6;
    const drop = rain.userData.speeds[i] * factor * delta;
    positions[idx + 1] -= drop;
    positions[idx + 4] -= drop;
    positions[idx] -= drop * 0.22;
    positions[idx + 3] -= drop * 0.22;
    if (positions[idx + 1] < -0.1) {
      const x = (Math.random() - 0.5) * 24;
      const y = 10 + Math.random() * 4;
      const z = (Math.random() - 0.5) * 18;
      const len = 0.35 + Math.random() * 0.42;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      positions[idx + 3] = x - 0.16;
      positions[idx + 4] = y - len;
      positions[idx + 5] = z + 0.08;
    }
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

function updateRipples(delta) {
  for (const ring of ripples.children) {
    ring.userData.life += delta * ring.userData.speed * (0.5 + rainLevel * 0.7);
    if (ring.userData.life > 1) {
      ring.userData.life = 0;
      ring.position.x = (Math.random() - 0.5) * 18;
      ring.position.z = (Math.random() - 0.5) * 13;
      ring.userData.max = 0.4 + Math.random() * 0.75;
    }
    const s = 0.15 + ring.userData.life * ring.userData.max;
    ring.scale.setScalar(s);
    ring.material.opacity = (1 - ring.userData.life) * (0.09 + rainLevel * 0.17);
  }
}

function updateMist(delta, elapsed) {
  for (const [index, cloud] of mist.children.entries()) {
    cloud.position.x += cloud.userData.speed * delta;
    cloud.material.opacity = 0.045 + Math.sin(elapsed * 0.7 + index) * 0.025;
    if (cloud.position.x > 9) cloud.position.x = -9;
  }
}

function resize() {
  mobileMode = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 720;
  camera.aspect = window.innerWidth / window.innerHeight;
  if (mobileMode) {
    camera.position.set(0, 12.6, 14.8);
    camera.lookAt(0, 0, 0.15);
    bucketPosition.set(0, 0.32, 5.25);
  } else {
    camera.position.set(0, 9.2, 11.2);
    camera.lookAt(0, 0, 0);
    bucketPosition.set(7.1, 0.32, 4.55);
  }
  bucket.position.copy(bucketPosition);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", resize);
resize();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.033);
  const elapsed = clock.elapsedTime;
  waterUniforms.uTime.value = elapsed;
  updateRainCycle(elapsed);
  ripplePulse = Math.min(ripplePulse + delta * 0.85, 1);
  waterUniforms.uPulse.value = ripplePulse;

  for (const one of fish) one.update(delta, elapsed);
  updateFishingNet(delta, elapsed);
  updateFlopEffects(delta);
  for (const [index, flower] of flowers.entries()) {
    flower.rotation.y += delta * (0.05 + index * 0.01);
    flower.position.y = 0.3 + Math.sin(elapsed * 0.8 + index) * 0.025;
  }
  lotusGroup.position.y = Math.sin(elapsed * 0.5) * 0.018;
  updateRain(delta);
  updateRipples(delta);
  updateMist(delta, elapsed);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
