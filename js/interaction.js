import * as THREE from 'three/webgpu';

// Looking at things and using them: a ray from the middle of the screen (the crosshair)
// finds what you're looking at. Click or E to pick it up, throw it, turn a dial, or place a light.
// What can be used right now (isAvailable) is up to the script: inside a world, only its light.

const REACH = 3; // meters
const THROW_SPEED = 9;

const screenCenter = new THREE.Vector2(0, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const holdPoint = new THREE.Vector3();

export const createInteraction = ({
  camera,
  physics,
  pickups,
  dials,
  sockets,
  isAvailable,
  canThrow,
  onPickUp,
  onTurnDial,
  onPlace,
}) => {
  const { RAPIER } = physics;
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const prompt = document.querySelector('.prompt');
  const crosshair = document.querySelector('.crosshair');
  let held = null;
  let target = null;

  // every mesh points back to the thing it belongs to
  for (const thing of [...pickups, ...dials, ...sockets]) thing.mesh.traverse((child) => (child.userData.owner = thing));

  const findTarget = () => {
    raycaster.setFromCamera(screenCenter, camera);
    const candidates = [...pickups, ...dials, ...sockets].filter(isAvailable).map((thing) => thing.mesh);
    const hit = raycaster.intersectObjects(candidates, true)[0];
    return hit ? hit.object.userData.owner : null;
  };

  const setPrompt = (text, usable = true) => {
    prompt.textContent = text ?? '';
    prompt.classList.toggle('visible', Boolean(text));
    crosshair.classList.toggle('active', Boolean(text) && usable);
  };

  const pickUp = (pickup) => {
    held = pickup;
    pickup.state = 'held';
    // a light taken from its world has no active body yet: start it where the light is
    if (!pickup.body.isEnabled()) {
      pickup.body.setTranslation(pickup.mesh.position, true);
      pickup.body.setEnabled(true);
    }
    // kinematic while held: it follows your hand, gravity doesn't pull it
    pickup.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    onPickUp(pickup);
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

  // a socket only takes its own light
  const fits = (socket) => held?.kind === 'artifact' && socket.world === held.world;

  const interact = () => {
    if (held) {
      if (target?.type === 'socket') {
        if (fits(target)) onPlace(releaseHeld(), target);
      } else if (canThrow()) {
        throwHeld();
      }
    } else if (target?.type === 'dial') onTurnDial(target);
    else if (target) pickUp(target);
  };

  // let go of whatever you're holding without throwing it (it went into a world, or into a socket)
  const releaseHeld = () => {
    const pickup = held;
    held = null;
    return pickup;
  };

  const update = (enabled) => {
    target = enabled ? findTarget() : null;
    if (held) {
      // hold it in front of you, a bit to the right and down
      camera.getWorldDirection(forward);
      right.crossVectors(forward, camera.up).normalize();
      holdPoint.copy(camera.position).addScaledVector(forward, 0.9).addScaledVector(right, 0.3);
      holdPoint.y -= 0.3;
      held.body.setNextKinematicTranslation(holdPoint);
      held.body.setNextKinematicRotation(camera.quaternion);
      if (!enabled) setPrompt(null);
      else if (target?.type === 'socket' && fits(target)) setPrompt(`Click · place the ${held.label}`);
      else if (target?.type === 'socket') setPrompt(`This place is for the ${target.world.artifact.name}`, false);
      else if (canThrow()) setPrompt('Click · throw');
      else setPrompt('Carry it home through the doorway', false);
      return;
    }
    if (!target) setPrompt(null);
    else if (target.type === 'dial') setPrompt(`Click · tune ${target.world.title.split(' ·')[0]}`);
    else setPrompt(`Click · pick up ${target.kind === 'artifact' ? `the ${target.label}` : target.kind}`);
  };

  return { update, interact, releaseHeld, get held() { return held; } };
};
