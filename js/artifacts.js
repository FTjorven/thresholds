import * as THREE from 'three/webgpu';
import { stoneMaterial } from './materials.js';

// The three lights, one hidden in each world, and the carvings that tell you how to find them.
// A light only shows up when its world is tuned right: the carving above each archway shows
// where its dial has to point. Placeholders from primitives; the Blender versions replace them later.
//
// artifacts: { mesh, kind: 'artifact', label, world, spot } — physics bodies are added by the script

const SHAPES = [
  () => new THREE.IcosahedronGeometry(0.16, 0), // Star Nest: a star shard
  () => new THREE.SphereGeometry(0.14, 24, 16), // Seascape: a pearl
  () => new THREE.DodecahedronGeometry(0.15, 0), // Creation: a sun seed
];

const createArtifact = (index, color) => {
  const glowing = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.5,
    roughness: 0.2,
    flatShading: index !== 1,
    fog: false, // the same in the worlds (no fog) and on the ruin, so it's compiled once
  });
  const group = new THREE.Group();
  group.name = `Artifact_${index + 1}`;
  const core = new THREE.Mesh(SHAPES[index](), glowing);
  // a thin ring around it, so it catches your eye from far away
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.012, 6, 48), glowing);
  halo.rotation.x = 1.2;
  group.add(core, halo);
  return { group, halo };
};

// the dial's turning part points at its setting; the carving shows the same pointer, standing up.
// Built like the dial and rotated a quarter turn, so "towards you" on the dial is "down" on the carving.
const addCarving = (world) => {
  const stand = new THREE.Group();
  stand.position.set(0, 3.7, 0.32); // the front of the archway's crown
  stand.rotation.x = Math.PI / 2;
  const turn = new THREE.Group();
  turn.rotation.y = -(world.key * Math.PI * 2) / world.tunings.length; // same angle as the dial at that setting
  // the same size as the dial, so they're easy to compare
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), stoneMaterial(0x5e5850, { grounded: false }));
  const material = new THREE.MeshStandardMaterial({ color: world.glow, emissive: world.glow, emissiveIntensity: 0.4 });
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.16), material);
  marker.position.set(0, 0.035, 0.09);
  turn.add(disc, marker);
  stand.add(turn);
  world.arch.add(stand);
  return material;
};

export const buildArtifacts = ({ worlds }) => {
  const group = new THREE.Group();
  group.name = 'Artifacts';

  const artifacts = worlds.map((world, i) => {
    const { group: mesh, halo } = createArtifact(i, world.glow);
    const spot = world.arch.localToWorld(new THREE.Vector3(...world.artifact.spot));
    mesh.position.copy(spot);
    group.add(mesh);
    world.carving = addCarving(world);
    return { mesh, halo, kind: 'artifact', label: world.artifact.name, world, spot };
  });

  return { group, artifacts };
};
