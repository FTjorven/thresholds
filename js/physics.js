import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';

// Rapier physics: static colliders for the ruin, dynamic bodies for the props,
// and a kinematic capsule that follows the player so you can bump into things.

const STEP = 1 / 60;
const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.5; // + radius on both ends = 1.6 m tall

const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();

export const createPhysics = async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const bodies = []; // { body, mesh } pairs to keep in sync
  let accumulator = 0;

  // a static collider matching a mesh made from a BoxGeometry or CylinderGeometry, where it is in the scene
  const addStatic = (mesh) => {
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(position, quaternion, scale);
    const { type, parameters: p } = mesh.geometry;
    let desc;
    if (type === 'BoxGeometry') {
      desc = RAPIER.ColliderDesc.cuboid((p.width * scale.x) / 2, (p.height * scale.y) / 2, (p.depth * scale.z) / 2);
    } else if (type === 'CylinderGeometry') {
      desc = RAPIER.ColliderDesc.cylinder((p.height * scale.y) / 2, Math.max(p.radiusTop, p.radiusBottom) * scale.x);
    } else {
      throw new Error(`No static collider for ${type} (${mesh.name})`);
    }
    desc.setTranslation(position.x, position.y, position.z).setRotation(quaternion);
    world.createCollider(desc);
  };

  // a dynamic body for a prop mesh; shape is a Rapier ColliderDesc
  // angularDamping: how quickly spinning and rolling slows down
  const addDynamic = (mesh, shape, { mass = 1, angularDamping = 0.3 } = {}) => {
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(position, quaternion, scale);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(quaternion)
        .setLinearDamping(0.1)
        .setAngularDamping(angularDamping)
    );
    world.createCollider(shape.setMass(mass).setFriction(0.8).setRestitution(0.2), body);
    bodies.push({ body, mesh });
    return body;
  };

  // the player: a capsule that follows the camera, pushes props, but isn't pushed back
  const playerBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS), playerBody);

  const setPlayer = (eyePosition, present) => {
    playerBody.setEnabled(present); // gone while you're inside a world
    if (present) {
      // the capsule's center is 0.8 m below the eyes
      playerBody.setNextKinematicTranslation({ x: eyePosition.x, y: eyePosition.y - 0.8, z: eyePosition.z });
    }
  };

  // fixed time steps, so the simulation behaves the same at any frame rate
  const step = (delta) => {
    accumulator += delta;
    while (accumulator >= STEP) {
      world.step();
      accumulator -= STEP;
    }
    for (const { body, mesh } of bodies) {
      if (!body.isEnabled()) continue; // put away (e.g. a light waiting in its world): the code places it
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  };

  return { RAPIER, world, addStatic, addDynamic, setPlayer, step };
};
