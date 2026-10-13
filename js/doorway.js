import * as THREE from 'three/webgpu';

// Detects walking through an archway's opening.
// The opening's front (local +z) faces the ruin. Going through it from the front takes you
// into its world, going back through it from behind takes you out. Walking around the archway
// or through it the "wrong" way changes nothing, like a free-standing gate.

// switch a little before the opening itself, so the camera's near plane never cuts through it
const THRESHOLD = 0.1;

const local = new THREE.Vector3();

export const createDoorway = ({ arch, isInOpening }) => {
  let previousZ = null;

  // returns 'enter', 'exit' or null
  const update = (cameraPosition, inside) => {
    local.copy(cameraPosition);
    arch.worldToLocal(local);
    const z = local.z;
    let crossing = null;
    if (previousZ !== null && isInOpening(local.x, local.y)) {
      if (!inside && previousZ >= THRESHOLD && z < THRESHOLD) crossing = 'enter';
      if (inside && previousZ < THRESHOLD && z >= THRESHOLD) crossing = 'exit';
    }
    previousZ = z;
    return crossing;
  };

  // the middle of the opening, in the scene: home base while you're inside
  const getCenter = (target) => arch.localToWorld(target.set(0, 1.6, 0));

  return { update, getCenter };
};
