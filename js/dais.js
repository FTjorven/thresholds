import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createOpening } from './ruin.js';

// The Blender model (blender/build_dais.py → public/assets/dais.glb): the archway, and the dais mechanism.
// Its stone has baked ambient occlusion in its texture; the scene's lights shine on top of that.
//
// - Arch: the archway, copied onto all four doorways
// - Dais_Rings with Dais_Ring_1..3: rings lying around the dais that wake up when a light is placed
// - Dais_Socket_1..3: where the lights go
// - Arch_4: the final archway, waiting under the floor
//
// Its animations (Blender actions, played by the script's AnimationMixer):
// - Awaken_1 .. Awaken_3: ring N rises from the floor and settles, tilted, above the dais
// - Finale: Arch_4 rises out of the dais

const DAIS_TOP = 0.3;

// the glowing parts get the color of their world, and the code turns them up and down
const glowMaterial = (color, intensity) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

export const loadDais = async ({ worlds, finaleMaterial }) => {
  const gltf = await new GLTFLoader().loadAsync('assets/dais.glb');
  const group = gltf.scene;
  group.name = 'Dais_Mechanism';
  const find = (name) => group.getObjectByName(name);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const rings = worlds.map((world, i) => {
    const studMaterial = glowMaterial(world.glow, 0.2);
    find(`Dais_Ring_${i + 1}_Studs`).material = studMaterial;
    return { mesh: find(`Dais_Ring_${i + 1}`), studMaterial };
  });

  const sockets = worlds.map((world, i) => {
    const socket = find(`Dais_Socket_${i + 1}`);
    const material = glowMaterial(world.glow, 0.4);
    find(`Dais_Socket_${i + 1}_Glow`).material = material;

    // what the crosshair hits: an invisible column, easier to aim at than the small socket
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    );
    hit.position.y = 0.5;
    const light = new THREE.PointLight(world.glow, 0, 5, 2); // turned on when the light is home
    light.position.y = 0.6;
    socket.add(hit, light);

    return {
      type: 'socket',
      mesh: hit,
      world,
      filled: false,
      point: socket.position.clone().add(new THREE.Vector3(0, 0.55, 0)), // where the light hovers
      light,
      glowMaterial: material,
    };
  });

  // the archway to copy onto the doorways (it waits out of the way in the file)
  const archModel = find('Arch');
  archModel.removeFromParent();
  archModel.position.set(0, 0, 0);

  // the final archway gets its doorway, into Heartfelt
  const arch = find('Arch_4');
  const opening = createOpening('Arch_4', finaleMaterial);
  opening.castShadow = false;
  arch.add(opening);
  const archLight = new THREE.PointLight(0xa8c0ff, 0, 9, 2);
  archLight.position.set(0, 1.6, 0.6);
  arch.add(archLight);

  return {
    group,
    ringParent: find('Dais_Rings'),
    rings,
    sockets,
    clips: gltf.animations,
    archModel,
    finale: { arch, opening, light: archLight, risenY: DAIS_TOP },
  };
};
