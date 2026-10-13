import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// First person player: mouse look (pointer lock), WASD to walk, Shift to run, Space to jump.
// Simple gravity: you stand on whatever isGround() says is below you, otherwise you fall.
// Physics (Rapier) replaces this later, once there are objects to pick up and throw.

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 3;
const RUN_SPEED = 6;
const JUMP_SPEED = 4.5;
const GRAVITY = 12;
const RESPAWN_BELOW = -40;

export const createPlayer = ({ camera, domElement, spawn, isGround }) => {
  const controls = new PointerLockControls(camera, domElement);
  const keys = new Set();
  const velocity = new THREE.Vector3();
  let onGround = false;

  const respawn = () => {
    camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);
    camera.rotation.set(0, 0, 0);
    velocity.set(0, 0, 0);
  };
  respawn();

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space' && onGround && controls.isLocked) {
      velocity.y = JUMP_SPEED;
      onGround = false;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  controls.addEventListener('unlock', () => keys.clear());

  const update = (delta) => {
    // walking: input direction relative to where you look
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const length = Math.hypot(forward, right) || 1; // no faster diagonally
    if (controls.isLocked) {
      controls.moveForward((forward / length) * speed * delta);
      controls.moveRight((right / length) * speed * delta);
    }

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

  return { controls, update, respawn };
};
