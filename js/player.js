import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// First person player: mouse look (pointer lock), WASD to walk, Shift to run, Space to jump.
// Two modes:
// - walking: simple gravity, you stand on whatever isGround() says is below you, otherwise you fall
// - flying: weightless inside a shader world, you glide where you look, Space to rise
// Physics (Rapier) replaces the walking part later, once there are objects to pick up and throw.

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 3;
const RUN_SPEED = 6;
const JUMP_SPEED = 4.5;
const GRAVITY = 12;
const RESPAWN_BELOW = -40;

const FLY_SPEED = 4;
const FLY_FAST_SPEED = 9;
const FLY_RESPONSE = 2.5; // how quickly you reach the speed you steer towards (lower = floatier)
const FLY_RANGE = 45; // drifting further than this from home pulls you back

const forwardDir = new THREE.Vector3();
const rightDir = new THREE.Vector3();
const targetVelocity = new THREE.Vector3();
const toHome = new THREE.Vector3();

export const createPlayer = ({ camera, domElement, spawn, isGround }) => {
  const controls = new PointerLockControls(camera, domElement);
  const keys = new Set();
  const velocity = new THREE.Vector3();
  let onGround = false;
  let flying = false;
  let home = null; // where the pull brings you back to while flying
  let minY = -Infinity; // lowest height while flying (e.g. stay above the sea)

  const respawn = () => {
    camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);
    camera.rotation.set(0, 0, 0);
    velocity.set(0, 0, 0);
  };
  respawn();

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space' && onGround && !flying && controls.isLocked) {
      velocity.y = JUMP_SPEED;
      onGround = false;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  controls.addEventListener('unlock', () => keys.clear());

  const getInput = () => {
    if (!controls.isLocked) return { forward: 0, right: 0, fast: false };
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const length = Math.hypot(forward, right) || 1; // no faster diagonally
    return { forward: forward / length, right: right / length, fast: keys.has('ShiftLeft') || keys.has('ShiftRight') };
  };

  const updateWalking = (delta) => {
    const { forward, right, fast } = getInput();
    const speed = fast ? RUN_SPEED : WALK_SPEED;
    controls.moveForward(forward * speed * delta);
    controls.moveRight(right * speed * delta);

    // gravity + ground
    velocity.y -= GRAVITY * delta;
    camera.position.y += velocity.y * delta;
    const feet = camera.position.y - EYE_HEIGHT;
    const groundY = isGround(camera.position.x, camera.position.z);
    // only snap onto the ground if you're near it (falling past an edge shouldn't teleport you up)
    if (groundY !== null && feet <= groundY && feet > groundY - 0.5) {
      camera.position.y = groundY + EYE_HEIGHT;
      velocity.y = 0;
      onGround = true;
    } else {
      onGround = false;
    }

    if (camera.position.y < RESPAWN_BELOW) respawn();
  };

  const updateFlying = (delta) => {
    const { forward, right, fast } = getInput();
    const speed = fast ? FLY_FAST_SPEED : FLY_SPEED;
    const up = controls.isLocked && keys.has('Space') ? 1 : 0;

    // fly where you look (including up and down)
    camera.getWorldDirection(forwardDir);
    rightDir.crossVectors(forwardDir, camera.up).normalize();
    targetVelocity
      .copy(forwardDir)
      .multiplyScalar(forward)
      .addScaledVector(rightDir, right)
      .addScaledVector(camera.up, up)
      .multiplyScalar(speed);

    // ease towards it: no instant stops, you drift a little
    velocity.lerp(targetVelocity, 1 - Math.exp(-delta * FLY_RESPONSE));

    // too far out: a gentle pull back home
    toHome.subVectors(home, camera.position);
    const distance = toHome.length();
    if (distance > FLY_RANGE) {
      velocity.addScaledVector(toHome.normalize(), (distance - FLY_RANGE) * delta * 2);
    }

    camera.position.addScaledVector(velocity, delta);

    if (camera.position.y < minY) {
      camera.position.y = minY;
      velocity.y = Math.max(velocity.y, 0);
    }
  };

  const update = (delta) => {
    if (flying) updateFlying(delta);
    else updateWalking(delta);
  };

  // switch between walking and weightless flying, keeping your momentum
  const setFlying = (value, { homePosition = null, lowest = -Infinity } = {}) => {
    if (value === flying) return;
    flying = value;
    home = homePosition;
    minY = lowest;
    onGround = false;
    if (flying) {
      // carry the walking speed into the glide
      const { forward, right, fast } = getInput();
      camera.getWorldDirection(forwardDir);
      rightDir.crossVectors(forwardDir, camera.up).normalize();
      const speed = fast ? RUN_SPEED : WALK_SPEED;
      velocity.copy(forwardDir).multiplyScalar(forward * speed).addScaledVector(rightDir, right * speed);
    } else {
      velocity.set(0, Math.min(velocity.y, 0), 0);
    }
  };

  return { controls, update, respawn, setFlying };
};
