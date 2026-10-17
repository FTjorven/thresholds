import * as THREE from 'three/webgpu';
import { stoneMaterial as stone } from './materials.js';

// Placeholder ruin built from primitives, in meters, floor at y = 0.
// Meshes with userData.static get a matching physics collider (boxes and cylinders only).
// A floating stone island in a void with archways. Your Blender model replaces this later:
// keep the names (Ruin_Floor, Arch_1_Portal, ...) so the code can find the parts.


// small seeded random, so the ruin looks the same on every load
const createRandom = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// the opening of an archway: a rectangle with a half circle on top
const ARCH_HALF_WIDTH = 0.95;
const ARCH_PILLAR_HEIGHT = 2.5;
const OPENING_Y = 0.12; // the opening starts on top of the step

// is a point (in the archway's local space) inside the opening? Used to detect walking through it.
// A bit of extra room below, so your feet don't have to be exactly inside.
export const isInOpening = (x, y) => {
  const height = y - OPENING_Y;
  if (Math.abs(x) > ARCH_HALF_WIDTH || height < -0.5) return false;
  if (height <= ARCH_PILLAR_HEIGHT) return true;
  return x * x + (height - ARCH_PILLAR_HEIGHT) ** 2 <= ARCH_HALF_WIDTH ** 2;
};
const createOpeningShape = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-ARCH_HALF_WIDTH, 0);
  shape.lineTo(ARCH_HALF_WIDTH, 0);
  shape.lineTo(ARCH_HALF_WIDTH, ARCH_PILLAR_HEIGHT);
  shape.absarc(0, ARCH_PILLAR_HEIGHT, ARCH_HALF_WIDTH, 0, Math.PI, false);
  shape.lineTo(-ARCH_HALF_WIDTH, 0);
  return shape;
};

export const createArch = ({ name, material, sealedMaterial }) => {
  const arch = new THREE.Group();
  arch.name = name;
  const archStone = stone(0x8a8478);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, ARCH_PILLAR_HEIGHT, 0.6), archStone);
    pillar.name = `${name}_Pillar`;
    pillar.position.set(side * (ARCH_HALF_WIDTH + 0.25), ARCH_PILLAR_HEIGHT / 2, 0);
    pillar.userData.static = true;
    arch.add(pillar);
  }

  const top = new THREE.Mesh(new THREE.TorusGeometry(ARCH_HALF_WIDTH + 0.25, 0.25, 6, 16, Math.PI), archStone);
  top.name = `${name}_Top`;
  top.position.y = ARCH_PILLAR_HEIGHT;
  top.scale.z = 1.2;
  arch.add(top);

  const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 1.2), stone(0x6f6a60));
  step.name = `${name}_Step`;
  step.position.y = 0.06;
  step.userData.static = true;
  arch.add(step);

  // the doorway itself: a window into a shader world, or sealed stone for worlds that aren't open yet
  const opening = new THREE.Mesh(new THREE.ShapeGeometry(createOpeningShape(), 24), material ?? sealedMaterial);
  opening.name = `${name}_Portal`;
  opening.position.y = OPENING_Y;
  arch.add(opening);

  return { arch, opening };
};

// portalMaterials: one per archway (3), or null for a sealed one
export const buildRuin = ({ portalMaterials }) => {
  const ruin = new THREE.Group();
  ruin.name = 'Ruin';
  const random = createRandom(7);

  // --- the floating island: flat top, rocky underside ---

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(7, 6.6, 1.2, 9), stone(0x6d675e, { grounded: false }));
  floor.name = 'Ruin_Floor';
  floor.position.y = -0.6;
  floor.userData.static = true;
  ruin.add(floor);

  const underside = new THREE.Mesh(new THREE.ConeGeometry(6.6, 7, 9), stone(0x4a4038, { grounded: false }));
  underside.name = 'Ruin_Underside';
  underside.rotation.x = Math.PI; // point down
  underside.position.y = -1.2 - 3.5;
  ruin.add(underside);

  // raised circle in the middle, where the artifacts will go later
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.3, 9), stone(0x7d776c));
  dais.name = 'Ruin_Dais';
  dais.position.y = 0.15;
  dais.userData.static = true;
  ruin.add(dais);

  // --- three archways around the dais, facing the center, each a doorway into its own world ---

  const sealedMaterial = stone(0x2a2622);
  const arches = [];
  const archRadius = 4.6;
  [0, 1, 2].forEach((i) => {
    const angle = Math.PI + (i * Math.PI * 2) / 3; // first one straight ahead of the spawn point
    const material = portalMaterials[i] ?? null;
    const { arch, opening } = createArch({ name: `Arch_${i + 1}`, material, sealedMaterial });
    arch.position.set(Math.sin(angle) * archRadius, 0, Math.cos(angle) * archRadius);
    arch.lookAt(0, 0, 0); // front of the doorway faces the center
    ruin.add(arch);
    arches.push({ arch, opening, open: material !== null });
  });

  // --- broken pillars along the edge ---

  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.3;
    const height = 0.6 + random() * 2.2;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, height, 7), stone(0x857f74));
    pillar.name = 'Ruin_BrokenPillar';
    pillar.position.set(Math.sin(angle) * 6.3, height / 2, Math.cos(angle) * 6.3);
    pillar.rotation.z = (random() - 0.5) * 0.15;
    pillar.userData.static = true;
    ruin.add(pillar);
  }

  // --- rocks floating in the void ---

  const rocks = [];
  const rockMaterial = stone(0x5a5048, { grounded: false });
  for (let i = 0; i < 40; i++) {
    const size = 0.3 + random() * random() * 3;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMaterial);
    rock.name = 'Ruin_FloatingRock';
    const angle = random() * Math.PI * 2;
    const distance = 11 + random() * 40;
    rock.position.set(Math.sin(angle) * distance, -18 + random() * 34, Math.cos(angle) * distance);
    rock.rotation.set(random() * 6, random() * 6, random() * 6);
    rock.userData.bob = { base: rock.position.y, phase: random() * Math.PI * 2, spin: (random() - 0.5) * 0.2 };
    ruin.add(rock);
    rocks.push(rock);
  }

  // --- shadows: everything casts and receives, except the self-lit doorways ---

  ruin.traverse((child) => {
    if (child.isMesh && !portalMaterials.includes(child.material)) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // height of the ground at a point, or null above the void.
  // Simple shapes for now; Rapier colliders replace this later.
  const isGround = (x, z) => {
    const distance = Math.hypot(x, z);
    if (distance < 1.45) return 0.3; // dais
    if (distance < 6.8) return 0;
    return null;
  };

  const animate = (time) => {
    for (const rock of rocks) {
      const { base, phase, spin } = rock.userData.bob;
      rock.position.y = base + Math.sin(time * 0.3 + phase) * 0.4;
      rock.rotation.y += spin * 0.01;
    }
  };

  return { ruin, arches, isGround, animate };
};
