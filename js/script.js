import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, vec2, texture, colorSpaceToWorking } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import starNestShader from './shaders/starNest/fragment.wgsl?raw';
import seascapeShader from './shaders/seascape/fragment.wgsl?raw';
import creationShader from './shaders/creation/fragment.wgsl?raw';
import colorBarsShader from './shaders/colorBars/fragment.wgsl?raw';
import heartfeltShader from './shaders/heartfelt/fragment.wgsl?raw';
import crtShader from './shaders/crt/fragment.wgsl?raw';
import { buildRoom } from './room.js';

if (!navigator.gpu) {
  document.querySelector('.no-webgpu').hidden = false;
  throw new Error('WebGPU is not supported in this browser');
}

// --- renderer, scene, camera ---

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1512);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(0.4, 1.2, 1.9);

// stay inside the room: no going under the floor or through the side walls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.75, -1.1);
controls.enableDamping = true;
controls.minDistance = 0.5;
controls.maxDistance = 3.3;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minAzimuthAngle = -0.7;
controls.maxAzimuthAngle = 0.7;

scene.add(new THREE.AmbientLight(0xfff0e0, 0.25));

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
// every channel has the same inputs, so the knob can cycle through them
const channels = [starNestShader, seascapeShader, creationShader, colorBarsShader].map((shader) => {
  const node = wgslFn(shader)({ fragCoord: channelFragCoord, iTime, iResolution: rtResolution, iMouse });
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

// --- rain shader on the window glass ---

const windowResolution = uniform(new THREE.Vector2(900, 1000)); // same aspect as the glass (0.9 x 1.0 m)
const windowTime = iTime.add(10); // skip the original's 10 second fade-in

const windowMaterial = new THREE.MeshBasicNodeMaterial();
windowMaterial.colorNode = colorSpaceToWorking(
  wgslFn(heartfeltShader)({
    fragCoord: uv().mul(windowResolution),
    iTime: windowTime,
    iResolution: windowResolution,
  }),
  THREE.SRGBColorSpace
);

// same lightning formula as the shader, so the room flashes in sync with the window
const getLightning = (time) => {
  const T = time + 10;
  const t = (T + 3) * 0.5;
  const flicker = Math.sin(t * Math.sin(t * 10));
  return flicker * Math.pow(Math.max(0, Math.sin(t + Math.sin(t))), 10);
};

// --- placeholder room (replaced by the Blender model later) ---

const { room, tvScreen, knob, clock } = buildRoom({ screenMaterial, windowMaterial });
scene.add(room);

// cold light from the window, flashes with the lightning
const windowLight = new THREE.PointLight(0x7f9fd8, 0.5, 4, 2);
windowLight.position.set(1.05, 1.4, -1.1);
scene.add(windowLight);

// soft blue glow from the screen onto the room
const screenGlow = new THREE.PointLight(0x8fb4ff, 0.4, 3, 2);
screenGlow.position.set(-0.18, 0.8, -0.7);
scene.add(screenGlow);

// --- interaction ---

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouseTarget = new THREE.Vector2(0, 0);
let dragging = null; // 'screen' or 'window' while dragging on one of them

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

const surfaces = {
  screen: { object: tvScreen, onDrag: steer },
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
  // drag on the screen controls its shader, drag elsewhere orbits
  for (const [name, { object, onDrag }] of Object.entries(surfaces)) {
    const hit = castFromEvent(e, object);
    if (hit) {
      dragging = name;
      controls.enabled = false;
      onDrag(hit);
      return;
    }
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (castFromEvent(e, knob)) {
    document.body.style.cursor = 'pointer';
  } else if (dragging || castFromEvent(e, tvScreen)) {
    document.body.style.cursor = 'crosshair';
  } else {
    document.body.style.cursor = '';
  }
  if (!dragging) return;
  const { object, onDrag } = surfaces[dragging];
  const hit = castFromEvent(e, object);
  if (hit) onDrag(hit);
});

window.addEventListener('pointerup', () => {
  dragging = null;
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

  windowLight.intensity = 0.5 + Math.max(0, getLightning(iTime.value)) * 8;

  controls.update();

  // the wall clock shows the real time
  const now = new Date();
  const minutes = now.getMinutes() + now.getSeconds() / 60;
  clock.minutePivot.rotation.z = -(minutes / 60) * Math.PI * 2;
  clock.hourPivot.rotation.z = -(((now.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2;

  renderer.setRenderTarget(renderTarget);
  renderer.render(rtScene, rtCamera);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
});
