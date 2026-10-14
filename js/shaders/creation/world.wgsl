// "Creation" by Silexars (Danilo Guanabara)
// https://www.shadertoy.com/view/XsXXDn
//
// "World" version of the port in fragment.wgsl (included, for creationMod).
// The original is a flat 2D effect. Here it becomes a giant pulsing light far out in the world:
// every ray is turned into 2D coordinates around the direction of the light (a stereographic
// projection: 0 straight at the light, growing towards the sides), scaled by how far away the
// light is. Fly towards it and it grows until you're inside it.
// The ripple loop itself is the original.
// - tuning: size of the light, turned by the dial next to the archway (1 = fills the view from 30 m away)

fn creationWorld(rayOrigin: vec3f, rayDir: vec3f, iTime: f32, tuning: f32, lightPosition: vec3f) -> vec4f {
  let lightSize = 30.0 * tuning; // seen from 30 m away, it fills the view like the original fills the screen

  let toLight = lightPosition - rayOrigin;
  let distance = max(length(toLight), 0.5);
  let d = toLight / distance;

  // two directions perpendicular to the light direction, as the x and y of the 2D coordinates
  let side = normalize(cross(d, vec3f(0.0, 1.0, 0.0)));
  let up = cross(side, d);

  // stereographic projection: the whole sphere of directions onto a plane around the light
  let k = max(1.0 + dot(rayDir, d), 0.001);
  let p0 = vec2f(dot(rayDir, side), dot(rayDir, up)) / k * distance / lightSize;

  // original ripple loop (fragCoord / iResolution - 0.5 is p0 here)
  var c = vec3f(0.0);
  var l = 0.0;
  var z = iTime;
  for (var i = 0; i < 3; i++) {
    let p = p0;
    var uv = p + 0.5;
    z += 0.07;
    l = length(p);
    uv += p / l * (sin(z) + 1.0) * abs(sin(l * 9.0 - z - z));
    c[i] = 0.01 / length(creationMod(uv, vec2f(1.0)) - 0.5);
  }
  return vec4f(c / l, 1.0);
}
