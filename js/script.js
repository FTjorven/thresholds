import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, vec2, texture, colorSpaceToWorking } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import starNestShader from './shaders/starNest/fragment.wgsl?raw';
import crtShader from './shaders/crt/fragment.wgsl?raw';

if (!navigator.gpu) {
  document.querySelector('.no-webgpu').hidden = false;
  throw new Error('WebGPU is not supported in this browser');
}

// --- renderer, scene, camera ---

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1512);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.4, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 6;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const lamp = new THREE.PointLight(0xffd8a8, 20);
lamp.position.set(1.5, 2, 2);
scene.add(lamp);

// --- uniforms ---

const iTime = uniform(0);
const rtResolution = uniform(new THREE.Vector2(320, 240)); // low res, like an old TV
const iMouse = uniform(new THREE.Vector2(0, 0));
const glitch = uniform(0);
const staticAmount = uniform(1); // start the TV with a burst of static

// --- channel shaders, rendered into a texture ---

const renderTarget = new THREE.RenderTarget(rtResolution.value.x, rtResolution.value.y, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});

// Shadertoy has its origin bottom-left, the render target top-left: flip y
const channelFragCoord = vec2(uv().x, uv().y.oneMinus()).mul(rtResolution);
const channels = [
  wgslFn(starNestShader)({ fragCoord: channelFragCoord, iTime, iResolution: rtResolution, iMouse }),
].map((node) => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = node;
  return material;
});
let currentChannel = 0;

const rtScene = new THREE.Scene();
const rtCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const rtMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), channels[currentChannel]);
rtScene.add(rtMesh);

// --- CRT shader on the TV screen, samples the channel texture ---

const iChannel0 = texture(renderTarget.texture);
const screenMaterial = new THREE.MeshBasicNodeMaterial();
screenMaterial.colorNode = colorSpaceToWorking(
  wgslFn(crtShader)({
    fragCoord: uv().mul(rtResolution),
    iTime,
    iResolution: rtResolution,
    glitch,
    staticAmount,
    iChannel0,
    iChannel0Sampler: iChannel0,
  }),
  THREE.SRGBColorSpace
);

// --- placeholder TV (replaced by the Blender model later) ---

const tv = new THREE.Group();
scene.add(tv);

const caseMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 });
const tvCase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), caseMaterial);
tvCase.position.z = -0.6;
tv.add(tvCase);

const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), screenMaterial);
tvScreen.position.set(-0.2, 0, 0.001);
tv.add(tvScreen);

const knob = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.09, 0.08, 24),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 })
);
knob.rotation.x = Math.PI / 2;
knob.position.set(0.65, 0.2, 0.04);
tv.add(knob);

// --- interaction ---

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouseTarget = new THREE.Vector2(0, 0);
let steering = false;

const castFromEvent = (e, object) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(object)[0];
};

const steer = (hit) => {
  // hit.uv is 0..1 on the screen, Shadertoy expects pixels
  mouseTarget.set(hit.uv.x * rtResolution.value.x, hit.uv.y * rtResolution.value.y);
};

const switchChannel = () => {
  currentChannel = (currentChannel + 1) % channels.length;
  rtMesh.material = channels[currentChannel];
  staticAmount.value = 1;
  knob.rotation.y += Math.PI / 4; // replaced by the Blender knob animation later
};

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (castFromEvent(e, knob)) {
    switchChannel();
    return;
  }
  const hit = castFromEvent(e, tvScreen);
  if (hit) {
    // drag on the screen steers the shader, drag elsewhere orbits
    steering = true;
    controls.enabled = false;
    steer(hit);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (castFromEvent(e, knob)) {
    document.body.style.cursor = 'pointer';
  } else if (steering || castFromEvent(e, tvScreen)) {
    document.body.style.cursor = 'crosshair';
  } else {
    document.body.style.cursor = '';
  }
  if (!steering) return;
  const hit = castFromEvent(e, tvScreen);
  if (hit) steer(hit);
});

window.addEventListener('pointerup', () => {
  steering = false;
  controls.enabled = true;
});

window.addEventListener('keydown', (e) => {
  // temporary until physics: G triggers a glitch
  if (e.key === 'g') glitch.value = 1;
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
  const delta = timer.getDelta();
  iTime.value = timer.getElapsed();

  // ease the shader mouse towards the target so steering feels smooth
  iMouse.value.lerp(mouseTarget, 1 - Math.exp(-delta * 6));

  glitch.value *= Math.exp(-delta * 3);
  staticAmount.value *= Math.exp(-delta * 5);

  controls.update();

  renderer.setRenderTarget(renderTarget);
  renderer.render(rtScene, rtCamera);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
});
