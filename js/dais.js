import * as THREE from 'three/webgpu';
import { stoneMaterial } from './materials.js';
import { createArch } from './ruin.js';

// The dais mechanism: three sockets for the lights, three stone rings that wake up when a light
// is placed, and a fourth archway that rises out of the dais when all three are home.
// Placeholder from primitives. The animations are real AnimationClips on named objects, played by an
// AnimationMixer, so the Blender version can replace this one to one: same object names, same clip names.
//
// Clips:
// - Awaken_1 .. Awaken_3: ring N rises from the floor and settles, tilted, above the dais
// - Finale: Arch_4 rises out of the dais

const RING_HEIGHT = 5.2; // the rings hang above the dais, clear of the final archway
const RINGS = [
  { radius: 1.6, tilt: new THREE.Euler(0.45, 0, 0) },
  { radius: 1.9, tilt: new THREE.Euler(0, 0, -0.4) },
  { radius: 2.2, tilt: new THREE.Euler(0.1, 0, 0) },
];
const SOCKET_RADIUS = 1.25; // distance from the center of the dais
const DAIS_TOP = 0.3;
const ARCH_BELOW = -4.4; // the final archway waits under the floor, out of sight

const easeInOut = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) ** 3;

// a clip sampled 20 times a second, like a baked Blender action
const sampleClip = (name, duration, tracks) => {
  const times = [];
  for (let t = 0; t <= duration + 1e-6; t += 1 / 20) times.push(Math.min(t, duration));
  const keyframeTracks = tracks.map(({ path, sample }) => {
    const values = times.flatMap((t) => sample(t / duration).toArray());
    const Track = path.endsWith('.quaternion') ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(path, times, values);
  });
  return new THREE.AnimationClip(name, duration, keyframeTracks);
};

const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // a torus lies flat
const upAxis = new THREE.Vector3(0, 1, 0);

const createRing = (index, { radius }, color) => {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 6, 48), stoneMaterial(0x7d776c, { grounded: false }));
  ring.name = `Dais_Ring_${index + 1}`;
  ring.position.y = 0.035; // lying on the floor around the dais, like carved circles
  ring.quaternion.copy(flat);

  // glowing studs in the ring's world color, so you can see it turn
  const studMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + index;
    const stud = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), studMaterial);
    stud.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    stud.rotation.z = angle;
    ring.add(stud);
  }
  return { mesh: ring, studMaterial };
};

const createSocket = (world, index) => {
  const angle = Math.PI + (index * Math.PI * 2) / 3; // facing the socket's archway
  const group = new THREE.Group();
  group.name = `Dais_Socket_${index + 1}`;
  group.position.set(Math.sin(angle) * SOCKET_RADIUS, DAIS_TOP, Math.cos(angle) * SOCKET_RADIUS);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 8), stoneMaterial(0x6f6a60, { grounded: false }));
  base.position.y = 0.06;
  base.userData.static = true;

  const glowMaterial = new THREE.MeshStandardMaterial({ color: world.glow, emissive: world.glow, emissiveIntensity: 0.4 });
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 24), glowMaterial);
  glow.position.y = 0.125;
  glow.quaternion.copy(flat);

  // what the crosshair hits: an invisible column, easier to aim at than the small socket
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  );
  hit.position.y = 0.5;
  hit.userData.noShadow = true;

  const light = new THREE.PointLight(world.glow, 0, 5, 2); // turned on when the light is home
  light.position.y = 0.6;

  group.add(base, glow, hit, light);
  return {
    type: 'socket',
    mesh: hit,
    world,
    filled: false,
    point: group.position.clone().add(new THREE.Vector3(0, 0.55, 0)), // where the light hovers
    light,
    glowMaterial,
    group,
  };
};

export const buildDais = ({ worlds, finaleMaterial }) => {
  const group = new THREE.Group();
  group.name = 'Dais_Mechanism';

  // the rings hang from a parent that the code turns slowly once they're awake
  const ringParent = new THREE.Group();
  ringParent.name = 'Dais_Rings';
  group.add(ringParent);
  const rings = worlds.map((world, i) => createRing(i, RINGS[i], world.glow));
  for (const ring of rings) ringParent.add(ring.mesh);

  const sockets = worlds.map((world, i) => createSocket(world, i));
  for (const socket of sockets) group.add(socket.group);

  // the final archway, facing the open side between the second and third archway
  const { arch, opening } = createArch({ name: 'Arch_4', material: finaleMaterial });
  arch.position.y = ARCH_BELOW;
  arch.traverse((child) => delete child.userData.static); // it moves, so no static colliders
  const archLight = new THREE.PointLight(0xa8c0ff, 0, 9, 2);
  archLight.position.set(0, 1.6, 0.6);
  arch.add(archLight);
  group.add(arch);

  group.traverse((child) => {
    if (child.isMesh && child !== opening && !child.userData.noShadow) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // --- the animation clips ---

  const clips = rings.map(({ mesh }, i) => {
    const tilt = new THREE.Quaternion().setFromEuler(RINGS[i].tilt);
    const spin = new THREE.Quaternion();
    const quaternion = new THREE.Quaternion();
    return sampleClip(`Awaken_${i + 1}`, 4, [
      {
        path: `${mesh.name}.position`,
        // rises, overshoots a little, settles
        sample: (t) => new THREE.Vector3(0, 0.035 + (RING_HEIGHT - 0.035) * easeInOut(t) + Math.sin(t * Math.PI) * 0.4, 0),
      },
      {
        path: `${mesh.name}.quaternion`,
        // turns one and a half times around its axis while it tilts into place
        sample: (t) => {
          const e = easeInOut(t);
          spin.setFromAxisAngle(upAxis, e * Math.PI * 3);
          quaternion.identity().slerp(tilt, e).multiply(spin).multiply(flat);
          return quaternion;
        },
      },
    ]);
  });

  clips.push(
    sampleClip('Finale', 5, [
      {
        path: `${arch.name}.position`,
        // grinds up out of the dais, shaking, slowing down at the top
        sample: (t) =>
          new THREE.Vector3(Math.sin(t * 90) * 0.025 * (1 - t), ARCH_BELOW + (DAIS_TOP - ARCH_BELOW) * easeOut(t), 0),
      },
    ])
  );

  return {
    group,
    ringParent,
    rings,
    sockets,
    clips,
    finale: { arch, opening, light: archLight, risenY: DAIS_TOP },
  };
};
