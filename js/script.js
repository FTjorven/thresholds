import * as THREE from 'three/webgpu';
import { wgslFn, uniform, cameraPosition, positionWorld, screenUV, texture, colorSpaceToWorking } from 'three/tsl';

import starNestWorldShader from './shaders/starNest/world.wgsl?raw';
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

// --- shader worlds ---
// The shader gets a real ray from your eye instead of a pixel position:
// - seen through a doorway, the ray starts where it passes through the doorway
// - inside the world, the ray starts at your eye
// Either way the world has depth, and moving around changes what you see.

const createWorldMaterial = (shader, rayOrigin) => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorSpaceToWorking(
    wgslFn(shader)({
      rayOrigin,
      rayDir: positionWorld.sub(cameraPosition).normalize(),
      iTime,
    }),
    THREE.SRGBColorSpace
  );
  material.fog = false; // the other world isn't in our fog
  return material;
};

const starNestDoorway = createWorldMaterial(starNestWorldShader, positionWorld);

// inside: a big sphere around you, painted from the inside, always drawn behind everything
const starNestInside = createWorldMaterial(starNestWorldShader, cameraPosition);
starNestInside.side = THREE.BackSide;
starNestInside.depthWrite = false;
const worldSphere = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), starNestInside);
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

const { ruin, arches, isGround, animate } = buildRuin({ portalMaterial: starNestDoorway });
scene.add(ruin);

const openArch = arches.find(({ open }) => open);
scene.attach(openArch.arch); // keep it out of the ruin group: it stays visible inside the world

// the open doorway lights up the stone around it
const glow = new THREE.PointLight(0x9fb4ff, 4, 7, 2);
glow.position.set(0, 1.6, 0.6);
openArch.arch.add(glow);

const doorway = createDoorway({ arch: openArch.arch, isInOpening });

// --- player ---

const player = createPlayer({
  camera,
  domElement: renderer.domElement,
  spawn: new THREE.Vector3(0, 0, 2.5),
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

// --- going in and out of the world ---

let inside = false;
let fovKick = 0;
const flash = document.querySelector('.flash');
const hint = document.querySelector('.hint');
let hintShown = false;

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
  setTimeout(() => hint.classList.remove('visible'), 5000);
};

const enterWorld = () => {
  inside = true;
  openArch.opening.material = ruinView;
  worldSphere.visible = true;
  player.setFlying(true, doorway.getCenter(new THREE.Vector3()));
  playCrossingEffect();
  if (!hintShown) {
    hintShown = true;
    showHint('Weightless. Fly where you look · Space to rise · the doorway leads back');
  }
};

const exitWorld = () => {
  inside = false;
  openArch.opening.material = starNestDoorway;
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

  const crossing = doorway.update(camera.position, inside);
  if (crossing === 'enter') enterWorld();
  if (crossing === 'exit') exitWorld();

  fovKick *= Math.exp(-delta * 4);
  camera.fov = FOV + fovKick;
  camera.updateProjectionMatrix();

  if (inside) {
    // 1. the ruin as seen from here, for the view back through the doorway
    worldSphere.visible = false;
    openArch.opening.visible = false;
    scene.fog = voidFog;
    renderer.setRenderTarget(ruinTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2. the world around you: only the archway you came through is left
    ruin.visible = false;
    worldSphere.position.copy(camera.position);
    worldSphere.visible = true;
    openArch.opening.visible = true;
    scene.fog = null;
    renderer.render(scene, camera);
    ruin.visible = true;
  } else {
    scene.fog = voidFog;
    renderer.render(scene, camera);
  }
});
