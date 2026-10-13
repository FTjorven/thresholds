import * as THREE from 'three/webgpu';
import { wgslFn, wgsl, uniform, cameraPosition, positionWorld, screenUV, texture, colorSpaceToWorking } from 'three/tsl';

import starNestWorldShader from './shaders/starNest/world.wgsl?raw';
import seascapeShader from './shaders/seascape/fragment.wgsl?raw';
import seascapeWorldShader from './shaders/seascape/world.wgsl?raw';
import creationShader from './shaders/creation/fragment.wgsl?raw';
import creationWorldShader from './shaders/creation/world.wgsl?raw';
import { buildRuin, isInOpening } from './ruin.js';
import { createPlayer } from './player.js';
import { createDoorway } from './doorway.js';

if (!navigator.gpu) {
  document.querySelector('.no-webgpu').hidden = false;
  document.querySelector('.start').hidden = true;
  throw new Error('WebGPU is not supported in this browser');
}

// --- renderer, scene, camera ---

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
await renderer.init();

const VOID_COLOR = 0x07060d;
const scene = new THREE.Scene();
scene.background = new THREE.Color(VOID_COLOR);
const voidFog = new THREE.FogExp2(VOID_COLOR, 0.022);
scene.fog = voidFog;

const FOV = 70;
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.05, 200);

// --- lights: cold moonlight from above, faint purple from the void below ---

scene.add(new THREE.HemisphereLight(0x8a90b8, 0x2a1830, 0.6));

const moon = new THREE.DirectionalLight(0xc8d0ff, 1.2);
moon.position.set(-8, 14, 6);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -9;
moon.shadow.camera.right = 9;
moon.shadow.camera.top = 9;
moon.shadow.camera.bottom = -9;
moon.shadow.bias = -0.0005;
scene.add(moon);

// --- uniforms ---

const iTime = uniform(0);
const creationLight = uniform(new THREE.Vector3()); // where Creation's light hangs, set once the ruin is built

// --- the worlds, one behind each archway ---
// includes: the straight port of the shader, so the world version can reuse its functions
// lowest: lowest flying height inside (stay above the sea)

const worlds = [
  {
    title: 'Star Nest · Kali',
    shader: starNestWorldShader,
    includes: [],
    glow: 0x9fb4ff,
  },
  {
    title: 'Seascape · TDM',
    shader: seascapeWorldShader,
    includes: [seascapeShader],
    glow: 0xcfe8ff,
    lowest: 0.1,
  },
  {
    title: 'Creation · Silexars',
    shader: creationWorldShader,
    includes: [creationShader],
    glow: 0xffd2b8,
    inputs: { lightPosition: creationLight },
  },
];

// The shader gets a real ray from your eye instead of a pixel position:
// - seen through a doorway, the ray starts where it passes through the doorway
// - inside the world, the ray starts at your eye
// Either way the world has depth, and moving around changes what you see.
const createWorldMaterial = (world, rayOrigin) => {
  const material = new THREE.MeshBasicNodeMaterial();
  const shader = wgslFn(world.shader, world.includes.map((code) => wgsl(code)));
  material.colorNode = colorSpaceToWorking(
    shader({
      rayOrigin,
      rayDir: positionWorld.sub(cameraPosition).normalize(),
      iTime,
      ...world.inputs,
    }),
    THREE.SRGBColorSpace
  );
  material.fog = false; // the other world isn't in our fog
  return material;
};

for (const world of worlds) {
  world.doorwayMaterial = createWorldMaterial(world, positionWorld);
  world.insideMaterial = createWorldMaterial(world, cameraPosition);
  world.insideMaterial.side = THREE.BackSide;
  world.insideMaterial.depthWrite = false;
}

// inside: a big sphere around you, painted from the inside, always drawn behind everything
const worldSphere = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), worlds[0].insideMaterial);
worldSphere.frustumCulled = false;
worldSphere.renderOrder = -1;
worldSphere.visible = false;
scene.add(worldSphere);

// --- the view back into the ruin, while you're inside ---
// The ruin is rendered from your exact viewpoint into a texture, and the back of the doorway
// shows that texture at the same spot on screen (screenUV). Because it's the same camera,
// it lines up perfectly: a window back into the ruin.

const ruinTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType }); // 8 bits would crush the dark colors
const ruinView = new THREE.MeshBasicNodeMaterial();
ruinView.colorNode = texture(ruinTarget.texture, screenUV);
ruinView.side = THREE.BackSide; // only from behind, the side you entered through
ruinView.fog = false;

const resizeRuinTarget = () => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ruinTarget.setSize(size.x, size.y);
};
resizeRuinTarget();

// --- the ruin (placeholder, replaced by the Blender model later) ---

const { ruin, arches, isGround, animate } = buildRuin({
  portalMaterials: worlds.map((world) => world.doorwayMaterial),
});
scene.add(ruin);

// connect each world to its archway
worlds.forEach((world, i) => {
  const { arch, opening } = arches[i];
  scene.attach(arch); // out of the ruin group: the archway you came through stays visible inside
  world.arch = arch;
  world.opening = opening;
  world.doorway = createDoorway({ arch, isInOpening });

  // the open doorway lights up the stone around it, in the color of its world
  const glow = new THREE.PointLight(world.glow, 4, 7, 2);
  glow.position.set(0, 1.6, 0.6);
  arch.add(glow);
});

// Creation's light hangs 30 m behind its archway, at eye height
worlds[2].arch.localToWorld(creationLight.value.set(0, 1.6, -30));

// --- player ---

const player = createPlayer({
  camera,
  domElement: renderer.domElement,
  spawn: new THREE.Vector3(0, 0, 0.8), // on the dais, facing the first archway
  isGround,
});

// start screen: click to lock the mouse, Esc to pause
const startScreen = document.querySelector('.start');
startScreen.addEventListener('click', () => {
  // the browser can refuse (e.g. right after pressing Esc): just stay on the start screen
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
});
player.controls.addEventListener('lock', () => startScreen.classList.add('hidden'));
player.controls.addEventListener('unlock', () => {
  startScreen.classList.remove('hidden');
  startScreen.querySelector('.start-title').textContent = 'Paused';
});

// --- going in and out of the worlds ---

let current = null; // the world you're in, or null on the ruin
let fovKick = 0;
const flash = document.querySelector('.flash');
const hint = document.querySelector('.hint');
let hintTimeout = null;
let controlsExplained = false;

const playCrossingEffect = () => {
  // restart the CSS flash animation
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
  fovKick = 20; // the view stretches for a moment, then settles
};

const showHint = (text) => {
  hint.textContent = text;
  hint.classList.add('visible');
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => hint.classList.remove('visible'), 5000);
};

const enterWorld = (world) => {
  current = world;
  world.opening.material = ruinView;
  worldSphere.material = world.insideMaterial;
  worldSphere.visible = true;
  player.setFlying(true, {
    homePosition: world.doorway.getCenter(new THREE.Vector3()),
    lowest: world.lowest,
  });
  playCrossingEffect();
  // the world's name (and its author), plus the controls the first time
  let text = world.title;
  if (!controlsExplained) {
    controlsExplained = true;
    text += '\nWeightless. Fly where you look · Space to rise · the doorway leads back';
  }
  showHint(text);
};

const exitWorld = () => {
  current.opening.material = current.doorwayMaterial;
  current = null;
  worldSphere.visible = false;
  player.setFlying(false);
  playCrossingEffect();
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeRuinTarget();
});

// --- draw loop ---

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.1); // no huge jumps after switching tabs
  iTime.value = timer.getElapsed();

  player.update(delta);
  animate(iTime.value);

  // every doorway keeps track of which side you're on, even the ones that don't matter right now
  let entered = null;
  let exited = false;
  for (const world of worlds) {
    const crossing = world.doorway.update(camera.position, world === current);
    if (crossing === 'enter' && !current) entered = world;
    if (crossing === 'exit' && world === current) exited = true;
  }
  if (exited) exitWorld();
  else if (entered) enterWorld(entered);

  fovKick *= Math.exp(-delta * 4);
  camera.fov = FOV + fovKick;
  camera.updateProjectionMatrix();

  if (current) {
    // 1. the ruin as seen from here, for the view back through the doorway
    worldSphere.visible = false;
    current.opening.visible = false;
    scene.fog = voidFog;
    renderer.setRenderTarget(ruinTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2. the world around you: only the archway you came through is left
    ruin.visible = false;
    for (const world of worlds) world.arch.visible = world === current;
    worldSphere.position.copy(camera.position);
    worldSphere.visible = true;
    current.opening.visible = true;
    scene.fog = null;
    renderer.render(scene, camera);
    ruin.visible = true;
    for (const world of worlds) world.arch.visible = true;
  } else {
    scene.fog = voidFog;
    renderer.render(scene, camera);
  }
});
