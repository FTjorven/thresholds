import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  instancedArray,
  instanceIndex,
  uniform,
  uniformArray,
  hash,
  vec3,
  float,
  uint,
  sin,
  cos,
  max,
  select,
  smoothstep,
  varying,
  uv,
} from 'three/tsl';

// Dust drifting in front of every doorway, slowly drawn into it: a WebGPU compute shader.
// The motes' positions live in a storage buffer on the GPU. Every frame a compute pass moves all of
// them (no positions ever go through the CPU), and the sprites read their positions straight from
// that buffer. Compute shaders are WebGPU only: WebGL can't do this.
//
// Each mote belongs to one archway (its index % 3) and lives in that archway's space:
// x across the opening, y up, z out in front of it. Motes drift towards the doorway, steering to a
// spot inside the opening, and start over out in front once they're through.
// An energized world (something thrown in, a dial turned) pulls its dust in much faster.

const PER_DOORWAY = 150;
const SPAWN_NEAR = 1.5; // meters in front of the doorway
const SPAWN_FAR = 3.5;

export const createDust = ({ worlds }) => {
  const doorways = worlds.length;
  const count = PER_DOORWAY * doorways;
  const positions = instancedArray(count, 'vec3');
  const delta = uniform(0);
  const elapsed = uniform(0);

  // each archway's place and orientation in the scene, and its world's color
  const archVectors = (local, isDirection) =>
    worlds.map((world) => {
      const vector = new THREE.Vector3(...local);
      return isDirection ? vector.transformDirection(world.arch.matrixWorld) : world.arch.localToWorld(vector);
    });
  const centers = uniformArray(archVectors([0, 0, 0], false), 'vec3');
  const rights = uniformArray(archVectors([1, 0, 0], true), 'vec3');
  const forwards = uniformArray(archVectors([0, 0, 1], true), 'vec3');
  const colors = uniformArray(
    worlds.map((world) => {
      const { r, g, b } = new THREE.Color(world.glow);
      return new THREE.Vector3(r, g, b);
    }),
    'vec3'
  );

  const doorwayOf = (index) => index.mod(uint(doorways));
  const energyOf = (doorway) =>
    select(doorway.equal(uint(0)), worlds[0].energy, select(doorway.equal(uint(1)), worlds[1].energy, worlds[2].energy));

  // a random number per mote (and per salt), the same every time it's asked
  const random = (index, salt) => hash(index.add(uint(salt * 7919)));

  // a new mote, somewhere out in front of the doorway; generation makes every rebirth land somewhere else
  const spawn = (index, generation, near) =>
    vec3(
      random(index.add(generation), 1).sub(0.5).mul(3.6),
      random(index.add(generation), 2).mul(3.6).add(0.1),
      random(index.add(generation), 3).mul(SPAWN_FAR - near).add(near)
    );

  // at the start: scattered over the whole space in front of the doorway
  const init = Fn(() => {
    positions.element(instanceIndex).assign(spawn(instanceIndex, uint(0), 0.1));
  })().compute(count);

  const update = Fn(() => {
    const position = positions.element(instanceIndex);
    const energy = energyOf(doorwayOf(instanceIndex));
    const seed = instanceIndex.toFloat();

    // drawn in: slowly, much faster when the world is energized
    const pull = float(0.2).add(energy.mul(1.5));
    // each mote aims for its own spot inside the opening, and steers so it gets there as it arrives
    const target = vec3(random(instanceIndex, 4).sub(0.5).mul(1.6), random(instanceIndex, 5).mul(2.8).add(0.4), 0);
    const steer = target.sub(position).mul(pull.div(max(position.z, 0.3))).mul(vec3(1, 1, 0));
    // and wanders a little on the way
    const wander = vec3(
      sin(elapsed.mul(0.7).add(seed.mul(0.37)).add(position.y.mul(2))),
      cos(elapsed.mul(0.5).add(seed.mul(0.73)).add(position.x.mul(2))),
      0
    ).mul(0.12);

    position.addAssign(vec3(0, 0, pull.negate()).add(steer).add(wander).mul(delta));

    // through the doorway: start over, out in front
    If(position.z.lessThan(0.02), () => {
      position.assign(spawn(instanceIndex, elapsed.mul(60).toUint(), SPAWN_NEAR));
    });
  })().compute(count);

  // --- drawing: one tiny glowing sprite per mote, positioned from the buffer ---

  const local = positions.toAttribute();
  const doorway = doorwayOf(instanceIndex);
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = centers
    .element(doorway)
    .add(rights.element(doorway).mul(local.x))
    .add(vec3(0, local.y, 0))
    .add(forwards.element(doorway).mul(local.z));
  material.scaleNode = random(instanceIndex, 6).mul(0.014).add(0.008);
  const tint = varying(colors.element(doorway));
  // fades in out in front, out as it reaches the doorway
  const fade = varying(smoothstep(0.0, 0.6, local.z).mul(smoothstep(SPAWN_FAR, SPAWN_FAR - 1, local.z)));
  const round = smoothstep(0.5, 0.1, uv().sub(0.5).length()); // a soft dot instead of a square
  material.colorNode = tint.mul(2.5); // bright enough to bloom
  material.opacityNode = round.mul(fade).mul(0.55);

  const sprites = new THREE.Sprite(material);
  sprites.count = count;
  sprites.frustumCulled = false;
  sprites.name = 'Dust';

  return {
    object: sprites,
    init: (renderer) => renderer.compute(init),
    update: (renderer, frameDelta, time) => {
      delta.value = frameDelta;
      elapsed.value = time;
      renderer.compute(update);
    },
  };
};
