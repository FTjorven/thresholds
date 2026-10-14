import * as THREE from 'three/webgpu';

// Looking at things and using them: a ray from the middle of the screen (the crosshair)
// finds what you're looking at. Click or E to pick it up, throw it, or turn a dial.

const REACH = 3; // meters
const THROW_SPEED = 9;

const screenCenter = new THREE.Vector2(0, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const holdPoint = new THREE.Vector3();

export const createInteraction = ({ camera, physics, pickups, dials, onTurnDial }) => {
  const { RAPIER } = physics;
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const prompt = document.querySelector('.prompt');
  const crosshair = document.querySelector('.crosshair');
  let held = null;
  let target = null;

  // every mesh points back to the thing it belongs to
  for (const pickup of pickups) pickup.mesh.traverse((child) => (child.userData.owner = pickup));
  for (const dial of dials) dial.mesh.traverse((child) => (child.userData.owner = dial));

  const findTarget = () => {
    raycaster.setFromCamera(screenCenter, camera);
    const candidates = [...pickups.filter((p) => p.state === 'free').map((p) => p.mesh), ...dials.map((d) => d.mesh)];
    const hit = raycaster.intersectObjects(candidates, true)[0];
    return hit ? hit.object.userData.owner : null;
  };

  const setPrompt = (text) => {
    prompt.textContent = text ?? '';
    prompt.classList.toggle('visible', Boolean(text));
    crosshair.classList.toggle('active', Boolean(text));
  };

  const pickUp = (pickup) => {
    held = pickup;
    pickup.state = 'held';
    // kinematic while held: it follows your hand, gravity doesn't pull it
    pickup.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  };

  const throwHeld = () => {
    const pickup = held;
    held = null;
    pickup.state = 'free';
    pickup.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    camera.getWorldDirection(forward);
    pickup.body.setLinvel({ x: forward.x * THROW_SPEED, y: forward.y * THROW_SPEED + 1.5, z: forward.z * THROW_SPEED }, true);
    pickup.body.setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, true);
  };

  const interact = () => {
    if (held) throwHeld();
    else if (target?.body) pickUp(target);
    else if (target) onTurnDial(target);
  };

  // drop whatever you're holding without throwing it (e.g. it went into a world with you)
  const releaseHeld = () => {
    const pickup = held;
    held = null;
    return pickup;
  };

  const update = (enabled) => {
    if (held) {
      // hold it in front of you, a bit to the right and down
      camera.getWorldDirection(forward);
      right.crossVectors(forward, camera.up).normalize();
      holdPoint.copy(camera.position).addScaledVector(forward, 0.9).addScaledVector(right, 0.3);
      holdPoint.y -= 0.3;
      held.body.setNextKinematicTranslation(holdPoint);
      held.body.setNextKinematicRotation(camera.quaternion);
      setPrompt('Click · throw');
      return;
    }
    target = enabled ? findTarget() : null;
    if (!target) setPrompt(null);
    else if (target.body) setPrompt(`Click · pick up ${target.kind}`);
    else setPrompt(`Click · tune ${target.world.title.split(' ·')[0]}`);
  };

  return { update, interact, releaseHeld, get held() { return held; } };
};
