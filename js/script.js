import * as THREE from 'three/webgpu';
import { wgslFn, uniform, cameraPosition, positionWorld, colorSpaceToWorking } from 'three/tsl';

import starNestWorldShader from './shaders/starNest/world.wgsl?raw';
import { buildRuin } from './ruin.js';
import { createPlayer } from './player.js';

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
scene.fog = new THREE.FogExp2(VOID_COLOR, 0.022);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

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

// --- shader world seen through a doorway ---
// The ray starts where it passes through the doorway and goes in the direction from your eye,
// so the world behind the doorway has real depth instead of being a flat picture.

const createPortalMaterial = (shader) => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorSpaceToWorking(
    wgslFn(shader)({
      rayOrigin: positionWorld,
      rayDir: positionWorld.sub(cameraPosition).normalize(),
      iTime,
    }),
    THREE.SRGBColorSpace
  );
  material.fog = false; // the other world isn't in our fog
  return material;
};

const starNestPortal = createPortalMaterial(starNestWorldShader);

// --- the ruin (placeholder, replaced by the Blender model later) ---

const { ruin, arches, isGround, animate } = buildRuin({ portalMaterial: starNestPortal });
scene.add(ruin);

// the open doorway lights up the stone around it
for (const { arch, open } of arches) {
  if (!open) continue;
  const glow = new THREE.PointLight(0x9fb4ff, 4, 7, 2);
  glow.position.set(0, 1.6, 0.6);
  arch.add(glow);
}

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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- draw loop ---

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.1); // no huge jumps after switching tabs
  iTime.value = timer.getElapsed();

  player.update(delta);
  animate(iTime.value);

  renderer.render(scene, camera);
});
