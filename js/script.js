import * as THREE from 'three/webgpu';
import {
  wgslFn,
  wgsl,
  uniform,
  cameraPosition,
  positionWorld,
  positionWorldDirection,
  screenUV,
  texture,
  colorSpaceToWorking,
  color,
  mix,
  smoothstep,
  pass,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import starNestWorldShader from './shaders/starNest/world.wgsl?raw';
import seascapeShader from './shaders/seascape/fragment.wgsl?raw';
import seascapeWorldShader from './shaders/seascape/world.wgsl?raw';
import creationShader from './shaders/creation/fragment.wgsl?raw';
import creationWorldShader from './shaders/creation/world.wgsl?raw';
import { buildRuin, isInOpening } from './ruin.js';
import { buildProps } from './props.js';
import { createPhysics } from './physics.js';
import { createPlayer } from './player.js';
import { createDoorway } from './doorway.js';
import { createInteraction } from './interaction.js';

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
renderer.shadowMap.type = THREE.PCFShadowMap; // with shadow.radius below for softer edges
// Neutral tone mapping: keeps colors (and the shader worlds) close to what they are,
// only rolls off the brightest parts (glowing crystals, Creation's light) instead of clipping them
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);
await renderer.init();

// the void: a faint purple glow far below, darker towards the horizon, near black above.
// The fog has the horizon's color, so far away rocks fade into it.
const VOID_BELOW = 0x2a1238;
const VOID_HORIZON = 0x0d0a18;
const VOID_ABOVE = 0x030308;
const scene = new THREE.Scene();
const viewY = positionWorldDirection.y;
scene.backgroundNode = mix(
  mix(color(VOID_BELOW), color(VOID_HORIZON), smoothstep(-0.7, -0.05, viewY)),
  color(VOID_ABOVE),
  smoothstep(0.0, 0.6, viewY)
);
const voidFog = new THREE.FogExp2(VOID_HORIZON, 0.022);
scene.fog = voidFog;

const FOV = 70;
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.05, 200);

// --- lights ---
// - a cold moon from above, the key light with soft shadows
// - little flat ambient light, so the sides facing away from the moon stay dark and things have shape
// - purple light from the void below, on the island's underside and the bottoms of things
// - each doorway lights its surroundings in its world's color (further down)

scene.add(new THREE.HemisphereLight(0x4a5280, 0x3a1d4a, 0.35));

const moon = new THREE.DirectionalLight(0xb8c4ff, 1.4);
moon.position.set(-8, 14, 6);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -9;
moon.shadow.camera.right = 9;
moon.shadow.camera.top = 9;
moon.shadow.camera.bottom = -9;
moon.shadow.bias = -0.0005;
moon.shadow.normalBias = 0.02; // no shadow speckles on the flat-shaded stone
moon.shadow.radius = 4; // softer edges
scene.add(moon);

const voidGlow = new THREE.DirectionalLight(0x8a4ad0, 0.6);
voidGlow.position.set(4, -10, -3);
scene.add(voidGlow);

// --- the worlds, one behind each archway ---
// includes: the straight port of the shader, so the world version can reuse its functions
// tunings: the values the dial next to the archway steps through (the first is the original)
// lowest: lowest flying height inside (stay above the sea)

const creationLight = uniform(new THREE.Vector3()); // where Creation's light hangs, set once the ruin is built

const worlds = [
  {
    title: 'Star Nest · Kali',
    shader: starNestWorldShader,
    includes: [],
    glow: 0x9fb4ff,
    tunings: [0.53, 0.38, 0.565], // the fractal's "magic formula" parameter: original, glowing nebula, star cluster
  },
  {
    title: 'Seascape · TDM',
    shader: seascapeWorldShader,
    includes: [seascapeShader],
    glow: 0xcfe8ff,
    tunings: [0, 0.55, 1], // noon, golden hour, dusk
    lowest: 0.1,
  },
  {
    title: 'Creation · Silexars',
    shader: creationWorldShader,
    includes: [creationShader],
    glow: 0xffd2b8,
    tunings: [1, 0.45, 2.2], // size of the light
    inputs: { lightPosition: creationLight },
  },
];

// every world has its own clock (it runs faster when energized), energy and tuning
for (const world of worlds) {
  world.time = uniform(0);
  world.energy = uniform(0); // a crystal thrown in: 1, fades back to 0
  world.tuning = uniform(world.tunings[0]);
  world.tuningTarget = world.tunings[0];
}

// The shader gets a real ray from your eye instead of a pixel position:
// - seen through a doorway, the ray starts where it passes through the doorway
// - inside the world, the ray starts at your eye
// Either way the world has depth, and moving around changes what you see.
const createWorldMaterial = (world, rayOrigin) => {
  const material = new THREE.MeshBasicNodeMaterial();
  const shader = wgslFn(world.shader, world.includes.map((code) => wgsl(code)));
  const color = colorSpaceToWorking(
    shader({
      rayOrigin,
      rayDir: positionWorld.sub(cameraPosition).normalize(),
      iTime: world.time,
      tuning: world.tuning,
      ...world.inputs,
    }),
    THREE.SRGBColorSpace
  );
  // Shadertoy's canvas cuts colors off at 1, so this keeps the original look,
  // and stops very bright shaders (Creation's light) from blowing up the bloom.
  // Energized, a world goes past 1 for a moment: a deliberate flare.
  material.colorNode = color.min(1).mul(world.energy.mul(0.7).add(1));
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
  world.glowLight = new THREE.PointLight(world.glow, 6, 9, 2);
  world.glowLight.position.set(0, 1.6, 0.6);
  arch.add(world.glowLight);
});

// Creation's light hangs 30 m behind its archway, at eye height
worlds[2].arch.localToWorld(creationLight.value.set(0, 1.6, -30));

// --- props around the archways, with physics ---

const props = buildProps({ worlds });
scene.add(props.group);

const physics = await createPhysics();
scene.traverse((child) => child.userData.static && physics.addStatic(child));

const { RAPIER } = physics;
for (const pickup of props.pickups) {
  const { mesh, kind } = pickup;
  let shape;
  if (kind === 'urn') {
    shape = RAPIER.ColliderDesc.cylinder(0.25, 0.17);
  } else {
    // crystals and stones: the exact shape of the mesh (its convex hull), scaled like the mesh
    const points = mesh.geometry.attributes.position.array.slice();
    for (let i = 0; i < points.length; i += 3) {
      points[i] *= mesh.scale.x;
      points[i + 1] *= mesh.scale.y;
      points[i + 2] *= mesh.scale.z;
    }
    shape = RAPIER.ColliderDesc.convexHull(points);
  }
  pickup.body = physics.addDynamic(mesh, shape, {
    mass: { crystal: 0.5, stone: 0.8, urn: 2 }[kind],
    angularDamping: kind === 'urn' ? 3 : 0.3, // a tipped-over urn shouldn't roll off the island
  });
  pickup.state = 'free'; // free, held, or gone (thrown into a world, comes back later)
  pickup.baseScale = mesh.scale.clone();
  pickup.appear = 1;
  // one tracker per archway, to notice when it flies through a doorway
  pickup.doorways = worlds.map((world) => createDoorway({ arch: world.arch, isInOpening }));
}

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

// --- interacting: picking up, throwing, turning dials ---

const turnDial = (dial) => {
  const { world } = dial;
  dial.index = (dial.index + 1) % world.tunings.length;
  world.tuningTarget = world.tunings[dial.index];
  dial.angle = (dial.angle ?? 0) - (Math.PI * 2) / world.tunings.length; // always turns the same way
  world.energy.value = Math.max(world.energy.value, 0.3); // a little flare, so you see which world changed
};

const interaction = createInteraction({
  camera,
  physics,
  pickups: props.pickups,
  dials: props.dials,
  onTurnDial: turnDial,
});

const canInteract = () => player.controls.isLocked && !current;
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && canInteract()) interaction.interact();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && canInteract()) interaction.interact();
});

// a prop that goes through a doorway disappears into that world and energizes it
const sendIntoWorld = (pickup, world, elapsed) => {
  if (interaction.held === pickup) interaction.releaseHeld();
  pickup.state = 'gone';
  pickup.body.setEnabled(false);
  pickup.mesh.visible = false;
  pickup.respawnAt = elapsed + 3;
  world.energy.value = Math.min(world.energy.value + 1, 1.5);
};

const respawn = (pickup) => {
  const { body, home, homeRotation } = pickup;
  body.setEnabled(true);
  body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  body.setTranslation(home, true);
  body.setRotation(homeRotation, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  pickup.state = 'free';
  pickup.mesh.visible = true;
  pickup.appear = 0; // grows back in
};

const updatePickups = (delta, elapsed) => {
  for (const pickup of props.pickups) {
    if (pickup.state === 'gone') {
      if (elapsed >= pickup.respawnAt) respawn(pickup);
      continue;
    }
    worlds.forEach((world, i) => {
      if (pickup.state !== 'gone' && pickup.doorways[i].update(pickup.mesh.position, false) === 'enter') {
        sendIntoWorld(pickup, world, elapsed);
      }
    });
    if (pickup.mesh.position.y < -30) respawn(pickup); // fell into the void
    if (pickup.appear < 1) {
      pickup.appear = Math.min(pickup.appear + delta * 3, 1);
      const grow = 1 - (1 - pickup.appear) ** 3; // ease out
      pickup.mesh.scale.copy(pickup.baseScale).multiplyScalar(grow);
    }
  }
};

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

// --- post-processing: bloom ---
// Everything brighter than the threshold (glowing crystals, gems, bright doorways, Creation's light)
// bleeds a soft glow into its surroundings. Tone mapping is applied after, to the result.

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera, { samples: 4 }); // samples: keep the edges smooth
const sceneColor = scenePass.getTextureNode('output');
const glow = bloom(sceneColor, 0.45, 0.5, 0.8);
renderPipeline.outputNode = sceneColor.add(glow);

// inside a world the whole view is the shader: less glow, so it stays close to the original
const BLOOM_OUTSIDE = 0.45;
const BLOOM_INSIDE = 0.15;

const render = () => {
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
    props.group.visible = false;
    for (const world of worlds) world.arch.visible = world === current;
    worldSphere.position.copy(camera.position);
    worldSphere.visible = true;
    current.opening.visible = true;
    scene.fog = null;
    glow.strength.value = BLOOM_INSIDE;
    renderPipeline.render();
    ruin.visible = true;
    props.group.visible = true;
    for (const world of worlds) world.arch.visible = true;
  } else {
    scene.fog = voidFog;
    glow.strength.value = BLOOM_OUTSIDE;
    renderPipeline.render();
  }
};

// warm up while loading: draw one frame inside each world, so all its shaders are compiled
// before you walk in (otherwise the first step into each world stutters)
// The camera stands just inside each world looking back at its archway, so everything you'd see
// from there gets drawn once.
for (const world of worlds) {
  current = world;
  world.opening.material = ruinView;
  worldSphere.material = world.insideMaterial;
  world.arch.localToWorld(camera.position.set(0, 1.6, -1));
  camera.lookAt(world.arch.localToWorld(new THREE.Vector3(0, 1.6, 5)));
  render();
  world.opening.material = world.doorwayMaterial;
}
current = null;
worldSphere.visible = false;
player.respawn(); // back to the start

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
  const elapsed = timer.getElapsed();

  player.update(delta);
  animate(elapsed);

  // worlds: clocks run faster while energized, energy fades, tuning eases to the dial's value
  for (const world of worlds) {
    world.time.value += delta * (1 + world.energy.value * 5);
    world.energy.value *= Math.exp(-delta * 0.7);
    world.tuning.value += (world.tuningTarget - world.tuning.value) * (1 - Math.exp(-delta * 3));
    world.glowLight.intensity = 6 * (1 + world.energy.value * 2);
  }
  for (const dial of props.dials) {
    dial.mesh.rotation.y += ((dial.angle ?? 0) - dial.mesh.rotation.y) * (1 - Math.exp(-delta * 10));
  }

  // physics: props, and you as a capsule that pushes them (not there while you're inside a world)
  interaction.update(canInteract());
  physics.setPlayer(camera.position, !current);
  physics.step(delta);
  updatePickups(delta, elapsed);

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

  render();
});
