import * as THREE from 'three/webgpu';
import { color, mix, positionWorld, mx_fractal_noise_float, smoothstep } from 'three/tsl';

// Stone for the placeholder ruin and props. Instead of one flat color:
// - noise in the 3D position breaks the color up into lighter and darker patches
// - things standing on the floor get darker towards their base, like dirt and shadow collecting there
//   (grounded: false for the floor itself, which would otherwise be darkened everywhere)
// Your baked Blender textures replace this later.

export const stoneMaterial = (hex, { grounded = true, ...extra } = {}) => {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, flatShading: true, ...extra });
  const noise = mx_fractal_noise_float(positionWorld.mul(1.8), 4).mul(0.5).add(0.5).clamp(0, 1);
  let stoneColor = color(hex).mul(mix(0.6, 1.15, noise));
  if (grounded) stoneColor = stoneColor.mul(mix(0.6, 1.0, smoothstep(0.0, 0.7, positionWorld.y)));
  material.colorNode = stoneColor;
  material.roughnessNode = mix(0.75, 1.0, noise); // lighter patches a bit shinier
  return material;
};
