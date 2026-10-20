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
  positionLocal,
  screenSize,
  vec2,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import starNestWorldShader from './shaders/starNest/world.wgsl?raw';
import seascapeShader from './shaders/seascape/fragment.wgsl?raw';
import seascapeWorldShader from './shaders/seascape/world.wgsl?raw';
import creationShader from './shaders/creation/fragment.wgsl?raw';
import creationWorldShader from './shaders/creation/world.wgsl?raw';
import heartfeltShader from './shaders/heartfelt/fragment.wgsl?raw';
import { buildRuin, isInOpening } from './ruin.js';
import { buildProps } from './props.js';
import { buildArtifacts } from './artifacts.js';
import { buildDais } from './dais.js';
import { createPhysics } from './physics.js';
import { createPlayer } from './player.js';
import { createDoorway } from './doorway.js';
import { createInteraction } from './interaction.js';
import { createAudio } from './audio.js';

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

const AMBIENT = 0.35; // grows a little with every light that's home
const ambient = new THREE.HemisphereLight(0x4a5280, 0x3a1d4a, AMBIENT);
scene.add(ambient);

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
// key: the tuning (index) that makes the world's light show up, shown by the carving on the archway
// artifact: the light hidden in the world, and where it floats (archway space: -z is into the world)
// lowest: lowest flying height inside (stay above the sea)

const creationLight = uniform(new THREE.Vector3()); // where Creation's light hangs, set once the ruin is built

const worlds = [
  {
    title: 'Star Nest · Kali',
    shader: starNestWorldShader,
    includes: [],
    glow: 0x9fb4ff,
    tunings: [0.53, 0.38, 0.565], // the fractal's "magic formula" parameter: original, glowing nebula, star cluster
    key: 1, // glowing nebula
    artifact: { name: 'star shard', spot: [6, 7, -18] }, // high up to the right
  },
  {
    title: 'Seascape · TDM',
    shader: seascapeWorldShader,
    includes: [seascapeShader],
    glow: 0xcfe8ff,
    tunings: [0, 0.55, 1], // noon, golden hour, dusk
    key: 2, // dusk
    artifact: { name: 'pearl', spot: [-8, 2, -20] }, // low over the waves, to the left
    lowest: 0.1,
  },
  {
    title: 'Creation · Silexars',
    shader: creationWorldShader,
    includes: [creationShader],
    glow: 0xffd2b8,
    tunings: [1, 0.45, 2.2], // size of the light
    key: 1, // the smallest light
    artifact: { name: 'sun seed', spot: [3, 2.5, -16] }, // in front of the light
    inputs: { lightPosition: creationLight },
  },
];

// every world has its own clock (it runs faster when energized), energy and tuning
for (const world of worlds) {
  world.time = uniform(0);
  world.energy = uniform(0); // a crystal thrown in: 1, fades back to 0
  world.tuning = uniform(world.tunings[0]);
  world.tuningTarget = world.tunings[0];
  world.dialIndex = 0;
}

// a world's light only shows up while the world is tuned to its key
const isTuned = (world) => world.dialIndex === world.key;

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

// --- Heartfelt: the way home, behind the final archway ---
// A 2D shader (rain on a window, a night street behind it), so it gets pixel coordinates:
// on the doorway, its position on the opening; at the very end, the whole screen.

const rainTime = uniform(0);
const heartfelt = wgslFn(heartfeltShader);
const FINALE_OPENING = vec2(1.9, 3.45); // size of an archway's opening, in meters
const finaleMaterial = new THREE.MeshBasicNodeMaterial();
finaleMaterial.colorNode = colorSpaceToWorking(
  heartfelt({
    fragCoord: positionLocal.xy.add(vec2(0.95, 0)).mul(400),
    iTime: rainTime,
    iResolution: FINALE_OPENING.mul(400),
  }),
  THREE.SRGBColorSpace
).min(1);
finaleMaterial.fog = false;

const endingRain = colorSpaceToWorking(
  heartfelt({
    fragCoord: vec2(screenUV.x, screenUV.y.oneMinus()).mul(screenSize), // Shadertoy's y points up
    iTime: rainTime,
    iResolution: screenSize,
  }),
  THREE.SRGBColorSpace
);

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

// --- the game: a light hidden in each world, three sockets on the dais, the final archway ---

const { group: artifactGroup, artifacts } = buildArtifacts({ worlds });
scene.add(artifactGroup);
worlds.forEach((world, i) => (world.artifact.pickup = artifacts[i]));

const dais = buildDais({ worlds, finaleMaterial });
scene.add(dais.group);
const finaleDoorway = createDoorway({ arch: dais.finale.arch, isInOpening });

// the Blender model's animations replace these clips later, with the same names
const mixer = new THREE.AnimationMixer(dais.group);
const playClip = (name) => {
  const action = mixer.clipAction(THREE.AnimationClip.findByName(dais.clips, name));
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true; // stay in the final pose
  action.reset().play();
  return action;
};

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

// the lights: waiting in their worlds (no active body) until you take them
for (const artifact of artifacts) {
  artifact.body = physics.addDynamic(artifact.mesh, RAPIER.ColliderDesc.ball(0.2), { mass: 0.5, angularDamping: 2 });
  artifact.body.setEnabled(false);
  artifact.state = 'inWorld'; // inWorld, held, free (on the ruin), or placed
  artifact.baseScale = artifact.mesh.scale.clone();
  artifact.appear = 1;
  artifact.doorways = worlds.map((world) => createDoorway({ arch: world.arch, isInOpening }));
}
const pickups = [...props.pickups, ...artifacts];

// --- sound: music, effects and a hum from every open doorway (all made in code, see js/audio.js) ---

const audio = createAudio({ camera });
for (const world of worlds) {
  const source = new THREE.Object3D();
  source.position.set(0, 1.6, 0); // the middle of the opening
  world.arch.add(source);
  world.hum = audio.addHum(source, { 'Star Nest · Kali': -24, 'Seascape · TDM': -19, 'Creation · Silexars': -17 }[world.title]);
}
const finaleHumSource = new THREE.Object3D();
finaleHumSource.position.set(0, 1.6, 0);
dais.finale.arch.add(finaleHumSource);
const finaleHum = audio.addHum(finaleHumSource, -12, 0.22);
finaleHum.level = 0; // silent until the archway opens

// --- player ---

const player = createPlayer({
  camera,
  domElement: renderer.domElement,
  spawn: new THREE.Vector3(0, 0, 0.8), // on the dais, facing the first archway
  isGround,
  onLand: (speed) => speed > 3 && audio.play('land'),
});

// start screen: click to lock the mouse, Esc to pause
const startScreen = document.querySelector('.start');
startScreen.addEventListener('click', () => {
  audio.start(); // browsers only allow sound after a click
  // the browser can refuse (e.g. right after pressing Esc): just stay on the start screen
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
});
player.controls.addEventListener('lock', () => {
  startScreen.classList.add('hidden');
  tracker.classList.add('visible');
});
player.controls.addEventListener('unlock', () => {
  if (ending) return; // the ending has its own screen
  startScreen.classList.remove('hidden');
  startScreen.querySelector('.start-title').textContent = 'Paused';
});

// --- hints and the lights tracker at the top ---

const hint = document.querySelector('.hint');
let hintTimeout = null;

const showHint = (text, seconds = 5) => {
  hint.textContent = text;
  hint.classList.add('visible');
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => hint.classList.remove('visible'), seconds * 1000);
};

const tracker = document.querySelector('.lights');
const trackerLights = worlds.map((world) => {
  const light = document.createElement('span');
  light.style.color = `#${new THREE.Color(world.glow).getHexString()}`;
  light.title = world.artifact.name;
  tracker.append(light);
  return light;
});

// --- interacting: picking up, throwing, turning dials, placing the lights ---

let current = null; // the world you're in, or null on the ruin
let ending = false;

const turnDial = (dial) => {
  const { world } = dial;
  dial.index = (dial.index + 1) % world.tunings.length;
  world.dialIndex = dial.index;
  world.tuningTarget = world.tunings[dial.index];
  dial.angle = (dial.angle ?? 0) - (Math.PI * 2) / world.tunings.length; // always turns the same way
  world.energy.value = Math.max(world.energy.value, 0.3); // a little flare, so you see which world changed
  audio.play('dial', dial.index);
  if (isTuned(world) && world.artifact.pickup.state === 'inWorld') {
    world.energy.value = Math.max(world.energy.value, 0.8);
    audio.play('tuned');
    showHint(`The carving lights up: ${world.title.split(' ·')[0]} is tuned. Step through to find its light.`);
  }
};

// what the crosshair can use right now
const isAvailable = (thing) => {
  const { held } = interaction;
  if (thing.type === 'socket') return !current && held?.kind === 'artifact' && !thing.filled;
  if (held) return false;
  if (thing.type === 'dial') return !current;
  if (thing.kind === 'artifact' && thing.state === 'inWorld') return thing.world === current && isTuned(current);
  return !current && thing.state === 'free';
};

const onPickUp = (pickup) => {
  audio.play('pickUp');
  if (pickup.kind === 'artifact' && current) showHint(`The ${pickup.label}. Carry it home through the doorway.`);
};

const placedCount = () => dais.sockets.filter((socket) => socket.filled).length;
let finaleOpen = false;

const place = (artifact, socket) => {
  artifact.state = 'placed';
  artifact.body.setEnabled(false);
  socket.filled = true;
  socket.light.intensity = 4;
  socket.glowMaterial.emissiveIntensity = 2;
  const index = dais.sockets.indexOf(socket);
  dais.rings[index].studMaterial.emissiveIntensity = 2.5;
  trackerLights[index].classList.add('home');
  playClip(`Awaken_${index + 1}`);
  audio.play('place', index);
  audio.play('rumble', 4, 0.4);

  const count = placedCount();
  if (count < dais.sockets.length) {
    showHint(`The ruin stirs · ${count} of ${dais.sockets.length} lights home`);
  } else {
    showHint('The ground trembles…');
    playClip('Finale');
    audio.play('rumble', 5.5, 0.9);
  }
};

const interaction = createInteraction({
  camera,
  physics,
  pickups,
  dials: props.dials,
  sockets: dais.sockets,
  isAvailable,
  canThrow: () => !current, // no throwing the light away inside its world
  onPickUp,
  onThrow: () => audio.play('throw'),
  onTurnDial: turnDial,
  onPlace: place,
});

mixer.addEventListener('finished', ({ action }) => {
  if (action.getClip().name !== 'Finale') return;
  finaleOpen = true;
  finaleHum.level = 1;
  audio.play('opened');
  showHint('The way home is open: walk through the archway on the dais');
});

const canInteract = () => player.controls.isLocked && !ending;
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && canInteract()) interaction.interact();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && canInteract()) interaction.interact();
  if (e.code === 'KeyM') showHint(audio.toggleMute() ? 'Sound off · M to turn it back on' : 'Sound on', 2);
});

// a light goes back to where it floats in its world
const returnHome = (artifact) => {
  artifact.state = 'inWorld';
  artifact.body.setEnabled(false);
  artifact.mesh.position.copy(artifact.spot);
  artifact.appear = 0; // grows back in
};

// a prop that goes through a doorway disappears into that world and energizes it.
// A light goes back to its own world.
const sendIntoWorld = (pickup, world, elapsed) => {
  if (interaction.held === pickup) interaction.releaseHeld();
  world.energy.value = Math.min(world.energy.value + 1, 1.5);
  audio.play('swallowed', pickup.mesh.position);
  if (pickup.kind === 'artifact') {
    returnHome(pickup);
    return;
  }
  pickup.state = 'gone';
  pickup.body.setEnabled(false);
  pickup.mesh.visible = false;
  pickup.respawnAt = elapsed + 3;
};

// --- breaking: urns, crystals and stones shatter when they hit something hard enough ---
// A hit shows up as a sudden change in velocity between two frames: stopping, or bouncing off
// (a bounce flips the direction, even when the speed along the floor stays). The pieces are small physics
// bodies that bounce around, then shrink away; the prop grows back at its place a little later.

const BREAK_SPEED = { urn: 3.5, crystal: 4.5, stone: 7 }; // m/s of velocity change in one frame
const SHARD_LIFE = 3; // seconds
const shards = [];
const shardGeometry = new THREE.TetrahedronGeometry(1, 0);

const shatter = (pickup, elapsed) => {
  const { mesh, body, kind } = pickup;
  audio.play('shatter', kind, mesh.position.clone());
  const velocity = body.linvel();
  const size = { urn: 0.07, crystal: 0.05, stone: 0.05 }[kind];
  const count = kind === 'urn' ? 10 : 7;
  for (let i = 0; i < count; i++) {
    const shard = new THREE.Mesh(shardGeometry, mesh.material);
    shard.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    shard.position.copy(mesh.position).add(new THREE.Vector3().randomDirection().multiplyScalar(0.08));
    shard.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    shard.castShadow = true;
    props.group.add(shard);
    const shardBody = physics.addDynamic(shard, RAPIER.ColliderDesc.ball(shard.scale.x * 0.6), { mass: 0.05 });
    const burst = new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 2);
    shardBody.setLinvel({ x: velocity.x * 0.3 + burst.x, y: Math.abs(burst.y) + 1, z: velocity.z * 0.3 + burst.z }, true);
    shards.push({ mesh: shard, body: shardBody, size: shard.scale.x, until: elapsed + SHARD_LIFE + Math.random() });
  }
  pickup.state = 'gone';
  body.setEnabled(false);
  mesh.visible = false;
  pickup.respawnAt = elapsed + 4;
};

const updateShards = (elapsed) => {
  for (let i = shards.length - 1; i >= 0; i--) {
    const shard = shards[i];
    const left = shard.until - elapsed;
    if (left < 0) {
      physics.remove(shard.body);
      props.group.remove(shard.mesh);
      shards.splice(i, 1);
    } else if (left < 0.5) {
      shard.mesh.scale.setScalar(shard.size * (left / 0.5)); // shrink away
    }
  }
};

// a sudden change in velocity: break, or just knock
const checkImpact = (pickup, elapsed) => {
  const v = pickup.body.linvel();
  const last = pickup.lastVelocity;
  pickup.lastVelocity = { x: v.x, y: v.y, z: v.z };
  if (!last) return; // just thrown: nothing to compare with yet
  const change = Math.hypot(v.x - last.x, v.y - last.y, v.z - last.z);
  // only when it was flying into something: being bumped from standing still (by you) doesn't count
  const speedBefore = Math.hypot(last.x, last.y, last.z);
  if (change > BREAK_SPEED[pickup.kind] && speedBefore > BREAK_SPEED[pickup.kind]) shatter(pickup, elapsed);
  else if (change > 1.2 && speedBefore > 1.2) audio.play('impact', change, pickup.mesh.position.clone());
};

const respawn = (pickup) => {
  if (pickup.kind === 'artifact') {
    returnHome(pickup); // fell into the void: back to its world, not lost
    return;
  }
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
  pickup.lastVelocity = null;
};

const updatePickups = (delta, elapsed) => {
  for (const pickup of pickups) {
    if (pickup.state === 'gone') {
      if (elapsed >= pickup.respawnAt) respawn(pickup);
      continue;
    }
    // the trackers follow it everywhere (also a light waiting in its world), so they never jump
    const loose = () => pickup.state === 'free' || pickup.state === 'held';
    worlds.forEach((world, i) => {
      if (pickup.doorways[i].update(pickup.mesh.position, false) === 'enter' && loose()) {
        sendIntoWorld(pickup, world, elapsed);
      }
    });
    if (loose() && pickup.mesh.position.y < -30) respawn(pickup); // fell into the void
    if (pickup.state === 'free' && pickup.kind !== 'artifact') checkImpact(pickup, elapsed);
    else pickup.lastVelocity = null;
    if (pickup.appear < 1) {
      pickup.appear = Math.min(pickup.appear + delta * 3, 1);
      const grow = 1 - (1 - pickup.appear) ** 3; // ease out
      pickup.mesh.scale.copy(pickup.baseScale).multiplyScalar(grow);
    }
  }
};

// lights waiting in their worlds bob and turn; placed ones hover over their sockets
const updateArtifacts = (delta, elapsed) => {
  artifacts.forEach((artifact, i) => {
    if (artifact.state === 'inWorld') {
      artifact.mesh.position.copy(artifact.spot);
      artifact.mesh.position.y += Math.sin(elapsed * 1.2 + i) * 0.25;
      artifact.mesh.rotation.y += delta * 0.6;
    } else if (artifact.state === 'placed') {
      const { point } = dais.sockets[i];
      artifact.mesh.position.lerp(point, 1 - Math.exp(-delta * 4)); // settles into place
      artifact.mesh.position.y += Math.sin(elapsed * 1.5 + i) * 0.002;
      artifact.mesh.rotation.y += delta * 0.8;
    }
    artifact.halo.rotation.z += delta * 1.5;
  });
};

// --- going in and out of the worlds ---

let fovKick = 0;
const flash = document.querySelector('.flash');
let controlsExplained = false;

const playCrossingEffect = () => {
  // restart the CSS flash animation
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
  fovKick = 20; // the view stretches for a moment, then settles
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
  audio.play('doorway', true);
  // the world's name (and its author), whether its light is out there, plus the controls the first time
  let text = world.title;
  const { state } = world.artifact.pickup;
  if (state === 'inWorld') {
    text += isTuned(world)
      ? '\nSomething glows out there. Follow the marker.'
      : '\nNothing out here answers. Go back and turn its dial to match the carving above the archway.';
  } else if (state === 'placed') {
    text += '\nIts light is home.';
  }
  if (!controlsExplained) {
    controlsExplained = true;
    text += '\nWeightless. Fly where you look · Space to rise · the doorway leads back';
  }
  showHint(text, 7);
};

const exitWorld = () => {
  current.opening.material = current.doorwayMaterial;
  current = null;
  worldSphere.visible = false;
  player.setFlying(false);
  playCrossingEffect();
  audio.play('doorway', false);
};

// --- the end: through the final archway, rain on a window, and the credits ---

const endingScreen = document.querySelector('.ending');
const crosshair = document.querySelector('.crosshair');
const endFade = uniform(0);
let endFadeTarget = 0;

const startEnding = () => {
  ending = true;
  playCrossingEffect();
  endFadeTarget = 1;
  renderPipeline.outputNode = endingOutput;
  renderPipeline.needsUpdate = true;
  tracker.classList.remove('visible');
  crosshair.hidden = true;
  player.controls.unlock();
  endingScreen.hidden = false;
  void endingScreen.offsetWidth;
  endingScreen.classList.add('visible');
};

// click: back on the ruin, in front of the final archway
endingScreen.addEventListener('click', () => {
  if (!ending) return;
  endingScreen.classList.remove('visible');
  endingScreen.hidden = true;
  endFadeTarget = 0;
  endFade.value = 0;
  renderPipeline.outputNode = normalOutput;
  renderPipeline.needsUpdate = true;
  player.respawn();
  crosshair.hidden = false;
  ending = false;
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
});

// --- guidance: the next step at the top, and a marker pointing where to go ---

const objective = document.querySelector('.objective');
const marker = document.querySelector('.marker');
const markerDistance = marker.querySelector('.marker-distance');
const worldName = (world) => world.title.split(' ·')[0];
const center = (doorway) => doorway.getCenter(new THREE.Vector3());

// what to do now: { text, at (a point in the scene, or none), color }
const getGoal = () => {
  if (ending) return { text: '' };
  const { held } = interaction;
  const heldLight = held?.kind === 'artifact' ? held : null;

  if (current) {
    const light = current.artifact.pickup;
    const home = center(current.doorway);
    if (heldLight) return { text: `Carry the ${heldLight.label} home through the doorway`, at: home, color: heldLight.world.glow };
    if (light.state !== 'inWorld') return { text: 'Head back through the doorway', at: home };
    if (isTuned(current)) return { text: `Find the ${light.label}, glowing somewhere out here`, at: light.mesh.position, color: current.glow };
    return { text: `Nothing here yet. Go back and tune ${worldName(current)}: match its dial to the carving above the archway`, at: home };
  }

  if (heldLight) {
    const socket = dais.sockets[artifacts.indexOf(heldLight)];
    return { text: `Place the ${heldLight.label} in its socket on the dais`, at: socket.point, color: heldLight.world.glow };
  }
  if (finaleOpen) return { text: 'Walk through the archway on the dais', at: center(finaleDoorway), color: 0xa8c0ff };
  if (placedCount() === dais.sockets.length) return { text: '' }; // the archway is rising
  const loose = artifacts.find((artifact) => artifact.state === 'free');
  if (loose) return { text: `Bring the ${loose.label} to the dais`, at: loose.mesh.position, color: loose.world.glow };
  const waiting = worlds.find((world) => isTuned(world) && world.artifact.pickup.state === 'inWorld');
  if (waiting) {
    return { text: `${worldName(waiting)} is tuned: step through its archway and find its light`, at: center(waiting.doorway), color: waiting.glow };
  }
  return { text: 'Turn the dial beside an archway until its pointer matches the carving above the arch' };
};

const projected = new THREE.Vector3();
const viewDirection = new THREE.Vector3();
const toGoal = new THREE.Vector3();

const updateGuidance = () => {
  const goal = getGoal();
  if (objective.textContent !== goal.text) objective.textContent = goal.text;

  const distance = goal.at ? camera.position.distanceTo(goal.at) : 0;
  const show = goal.at && distance > 1.5 && player.controls.isLocked;
  marker.classList.toggle('visible', Boolean(show));
  if (!show) return;
  // where it is on screen; behind you or off screen, the marker stays at the edge, on its side
  projected.copy(goal.at).project(camera);
  camera.getWorldDirection(viewDirection);
  const behind = toGoal.subVectors(goal.at, camera.position).dot(viewDirection) < 0;
  let { x, y } = projected;
  if (behind) {
    x = -x;
    y = -y;
  }
  const edge = Math.max(Math.abs(x), Math.abs(y), 1e-3);
  if (behind || edge > 0.88) {
    x *= 0.88 / edge;
    y *= 0.88 / edge;
  }
  marker.style.transform = `translate(${(x * 0.5 + 0.5) * window.innerWidth}px, ${(-y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -50%)`;
  marker.style.color = `#${new THREE.Color(goal.color ?? 0xe6e2f0).getHexString()}`;
  markerDistance.textContent = `${Math.round(distance)} m`;
};

// --- the edge of the island, and falling off it ---
// Near the edge the view darkens at its sides and the wind picks up; falling, the void closes in,
// and a little further down it sends you back to the dais.

const edgeVignette = document.querySelector('.edge-vignette');
const fallFade = document.querySelector('.fall-fade');
const EYE = 1.6;
const ISLAND_SAFE = 5.6; // meters from the center where the warning starts
const ISLAND_EDGE = 6.7;
const FALL_RESPAWN = -14; // feet height
let lastEdgeHint = -Infinity;

// returns how windy it is (0..1)
const updateEdge = (elapsed) => {
  if (current || ending) {
    edgeVignette.style.opacity = 0;
    fallFade.style.opacity = 0;
    return 0;
  }
  const feet = camera.position.y - EYE;
  const fromCenter = Math.hypot(camera.position.x, camera.position.z);
  const near = feet > -0.5 ? THREE.MathUtils.smoothstep(fromCenter, ISLAND_SAFE, ISLAND_EDGE) : 1;
  const fall = THREE.MathUtils.clamp((-feet - 0.5) / (-FALL_RESPAWN - 0.5), 0, 1);
  edgeVignette.style.opacity = near;
  fallFade.style.opacity = fall;

  if (near > 0.6 && fall === 0 && elapsed - lastEdgeHint > 20) {
    lastEdgeHint = elapsed;
    showHint('Careful: the island ends here');
  }
  if (feet < FALL_RESPAWN) {
    player.respawn();
    playCrossingEffect();
    audio.play('respawn');
    showHint('You fell into the void, and it sent you back');
  }
  return Math.max(near * 0.3, fall);
};

// footsteps: one every so many meters walked on the ground
const lastPosition = new THREE.Vector3();
let walked = 0;
const updateFootsteps = () => {
  const step = Math.hypot(camera.position.x - lastPosition.x, camera.position.z - lastPosition.z);
  lastPosition.copy(camera.position);
  if (!player.onGround || current || step > 1) return; // step > 1: teleported, e.g. respawned
  walked += step;
  if (walked > 0.75) {
    walked = 0;
    audio.play('footstep');
  }
};

// --- post-processing: bloom ---
// Everything brighter than the threshold (glowing crystals, gems, bright doorways, Creation's light)
// bleeds a soft glow into its surroundings. Tone mapping is applied after, to the result.

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera, { samples: 4 }); // samples: keep the edges smooth
const sceneColor = scenePass.getTextureNode('output');
const glow = bloom(sceneColor, 0.45, 0.5, 0.8);
const normalOutput = sceneColor.add(glow);
// at the end, the view fades into Heartfelt's rain, full screen (only built in when it's needed)
const endingOutput = mix(normalOutput, endingRain, endFade);
renderPipeline.outputNode = normalOutput;

// inside a world the whole view is the shader: less glow, so it stays close to the original
const BLOOM_OUTSIDE = 0.45;
const BLOOM_INSIDE = 0.15;

// the lights belong to a place: the one in its world only shows up there (and only when it's tuned),
// the others are on the ruin. The one in your hand comes with you.
const showArtifacts = (inWorld) => {
  for (const artifact of artifacts) {
    const { state } = artifact;
    artifact.mesh.visible = inWorld
      ? state === 'held' || (state === 'inWorld' && artifact.world === current && isTuned(current))
      : state === 'free' || state === 'placed' || (state === 'held' && !current);
  }
};

const render = () => {
  if (current) {
    // 1. the ruin as seen from here, for the view back through the doorway
    worldSphere.visible = false;
    current.opening.visible = false;
    scene.fog = voidFog;
    showArtifacts(false);
    renderer.setRenderTarget(ruinTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2. the world around you: only the archway you came through is left
    ruin.visible = false;
    props.group.visible = false;
    dais.group.visible = false;
    for (const world of worlds) world.arch.visible = world === current;
    worldSphere.position.copy(camera.position);
    worldSphere.visible = true;
    current.opening.visible = true;
    scene.fog = null;
    showArtifacts(true);
    glow.strength.value = BLOOM_INSIDE;
    renderPipeline.render();
    ruin.visible = true;
    props.group.visible = true;
    dais.group.visible = true;
    for (const world of worlds) world.arch.visible = true;
  } else {
    scene.fog = voidFog;
    showArtifacts(false);
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

// the same for what only shows up later: the lights, the final archway and the ending,
// all put in front of the camera for one frame
{
  const { arch } = dais.finale;
  const waitingY = arch.position.y;
  arch.position.y = dais.finale.risenY;
  for (const artifact of artifacts) artifact.state = 'free';
  artifacts.forEach((artifact, i) => artifact.mesh.position.set(i - 1, 1.6, 2));
  camera.position.set(0, 1.6, 4);
  camera.lookAt(0, 1.6, 0);
  renderPipeline.outputNode = endingOutput;
  render();
  renderPipeline.outputNode = normalOutput;
  arch.position.y = waitingY;
  for (const artifact of artifacts) {
    artifact.state = 'inWorld';
    artifact.mesh.position.copy(artifact.spot);
  }
}
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
    // the carving glows while the dial points where it does
    const carvingGlow = isTuned(world) ? 3 : 0.4;
    world.carving.emissiveIntensity += (carvingGlow - world.carving.emissiveIntensity) * (1 - Math.exp(-delta * 4));
  }
  for (const dial of props.dials) {
    dial.mesh.rotation.y += ((dial.angle ?? 0) - dial.mesh.rotation.y) * (1 - Math.exp(-delta * 10));
  }

  // the dais: its animations, the awake rings turning, the ruin brightening with every light home
  mixer.update(delta);
  const placed = placedCount();
  dais.ringParent.rotation.y += delta * (placed * 0.06 + (finaleOpen ? 0.15 : 0));
  ambient.intensity += (AMBIENT + placed * 0.08 - ambient.intensity) * (1 - Math.exp(-delta * 2));
  dais.finale.light.intensity = finaleOpen ? 8 : 0;
  rainTime.value += delta;
  endFade.value += (endFadeTarget - endFade.value) * (1 - Math.exp(-delta * 1.5));

  // physics: props, and you as a capsule that pushes them (not there while you're inside a world)
  interaction.update(canInteract());
  physics.setPlayer(camera.position, !current);
  physics.step(delta);
  updatePickups(delta, elapsed);
  updateArtifacts(delta, elapsed);
  updateShards(elapsed);

  // guidance, the edge, sound
  updateGuidance();
  const windAmount = updateEdge(elapsed);
  updateFootsteps();
  for (const world of worlds) world.hum.level = 1 + world.energy.value;
  audio.update({ inside: Boolean(current), lights: placed, ending, windAmount });

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
  if (finaleDoorway.update(camera.position, false) === 'enter' && finaleOpen && !current && !ending) startEnding();

  fovKick *= Math.exp(-delta * 4);
  camera.fov = FOV + fovKick;
  camera.updateProjectionMatrix();

  render();
});



