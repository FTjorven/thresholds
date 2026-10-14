import * as THREE from 'three/webgpu';
import { stoneMaterial } from './materials.js';

// Props around the archways: things to pick up and throw, and a tuning dial per archway.
// Placeholders from primitives; the Blender versions replace them later.
//
// pickups: { mesh, kind, home, homeRotation } — physics bodies are added by the script
// dials:   { mesh, world, index } — the part you click and that turns

// props get picked up and moved around, so no darkening towards the floor
const stone = (color) => stoneMaterial(color, { grounded: false });

const createCrystal = (color) => {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true })
  );
  mesh.name = 'Crystal';
  mesh.scale.y = 1.5; // taller than wide
  return mesh;
};

const createUrn = () => {
  // a profile turned around the y axis
  const profile = [
    [0.0, -0.25], [0.12, -0.25], [0.17, -0.12], [0.18, 0.02], [0.12, 0.17], [0.08, 0.21], [0.1, 0.25],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 12), stone(0x9a6a48));
  mesh.name = 'Urn';
  return mesh;
};

const createStone = () => {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), stone(0x77706a));
  mesh.name = 'Stone';
  return mesh;
};

const createDial = (color) => {
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.0, 8), stone(0x7d776c));
  pedestal.name = 'Dial_Pedestal';
  pedestal.position.y = 0.5;
  pedestal.userData.static = true;

  // the turning part sits on top, tilted towards you
  const tilt = new THREE.Group();
  tilt.position.y = 1.03;
  tilt.rotation.x = 0.5;
  const dial = new THREE.Group();
  dial.name = 'Dial';
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), stone(0x5e5850));
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.03, 0.16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 })
  );
  marker.position.set(0, 0.04, 0.09);
  dial.add(disc, marker);
  tilt.add(dial);

  // a gem in the world's color on the front, so you know which world it tunes
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.05, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 })
  );
  gem.position.set(0, 0.75, 0.25);

  const group = new THREE.Group();
  group.add(pedestal, tilt, gem);
  return { group, dial, pedestal };
};

export const buildProps = ({ worlds }) => {
  const group = new THREE.Group();
  group.name = 'Props';
  const pickups = [];
  const dials = [];
  const statics = [];

  const place = (mesh, kind, position) => {
    mesh.position.copy(position);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
    pickups.push({ mesh, kind, home: position.clone(), homeRotation: mesh.quaternion.clone() });
  };

  worlds.forEach((world) => {
    const { arch } = world;
    arch.updateWorldMatrix(true, false);
    const local = (x, y, z) => arch.localToWorld(new THREE.Vector3(x, y, z));

    // two crystals on either side of the path into the archway
    place(createCrystal(world.glow), 'crystal', local(-0.9, 0.25, 1.7));
    place(createCrystal(world.glow), 'crystal', local(0.9, 0.25, 1.7));

    // an urn next to the left pillar
    place(createUrn(), 'urn', local(-2.0, 0.26, 0.7));

    // the dial next to the right pillar, turned to face the path
    const { group: dialGroup, dial, pedestal } = createDial(world.glow);
    dialGroup.position.copy(local(2.0, 0, 0.7));
    dialGroup.quaternion.copy(arch.quaternion);
    dialGroup.rotateY(-0.5);
    group.add(dialGroup);
    statics.push(pedestal);
    dials.push({ mesh: dial, world, index: 0 });
  });

  // loose stones around the dais
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.6;
    place(createStone(), 'stone', new THREE.Vector3(Math.sin(angle) * 2.1, 0.13, Math.cos(angle) * 2.1));
  }

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return { group, pickups, dials, statics };
};
