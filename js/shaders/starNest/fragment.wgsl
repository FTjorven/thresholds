// Star Nest by Pablo Roman Andrioli (Kali)
// https://www.shadertoy.com/view/XlfGRj
// License: MIT

fn starNest(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f) -> vec4f {
  const iterations = 17;
  const formuparam = 0.53;

  const volsteps = 20;
  const stepsize = 0.1;

  const zoom = 0.8;
  const tile = 0.85;
  const speed = 0.01;

  const brightness = 0.0015;
  const darkmatter = 0.3;
  const distfading = 0.73;
  const saturation = 0.85;

  // get coords and direction
  var uv = fragCoord / iResolution - 0.5;
  uv.y *= iResolution.y / iResolution.x;
  var dir = vec3f(uv * zoom, 1.0);
  let time = iTime * speed + 0.25;

  // mouse rotation
  let a1 = 0.5 + iMouse.x / iResolution.x * 2.0;
  let a2 = 0.8 + iMouse.y / iResolution.y * 2.0;
  let rot1 = mat2x2f(cos(a1), sin(a1), -sin(a1), cos(a1));
  let rot2 = mat2x2f(cos(a2), sin(a2), -sin(a2), cos(a2));
  let dirXZ = dir.xz * rot1;
  dir = vec3f(dirXZ.x, dir.y, dirXZ.y);
  let dirXY = dir.xy * rot2;
  dir = vec3f(dirXY, dir.z);

  var origin = vec3f(1.0, 0.5, 0.5); // "from" in the original, reserved in WGSL
  origin += vec3f(time * 2.0, time, -2.0);
  let originXZ = origin.xz * rot1;
  origin = vec3f(originXZ.x, origin.y, originXZ.y);
  let originXY = origin.xy * rot2;
  origin = vec3f(originXY, origin.z);

  // volumetric rendering
  var s = 0.1;
  var fade = 1.0;
  var v = vec3f(0.0);
  for (var r = 0; r < volsteps; r++) {
    var p = origin + s * dir * 0.5;
    p = abs(vec3f(tile) - glslMod3(p, vec3f(tile * 2.0))); // tiling fold
    var pa = 0.0;
    var a = 0.0;
    for (var i = 0; i < iterations; i++) {
      p = abs(p) / dot(p, p) - formuparam; // the magic formula
      a += abs(length(p) - pa); // absolute sum of average change
      pa = length(p);
    }
    let dm = max(0.0, darkmatter - a * a * 0.001); // dark matter
    a *= a * a; // add contrast
    if (r > 6) { fade *= 1.0 - dm; } // dark matter, don't render near
    v += fade;
    v += vec3f(s, s * s, s * s * s * s) * a * brightness * fade; // coloring based on distance
    fade *= distfading; // distance fading
    s += stepsize;
  }
  v = mix(vec3f(length(v)), v, saturation); // color adjust
  return vec4f(v * 0.01, 1.0);
}

// GLSL mod() floors, WGSL % truncates: they differ for negative numbers
fn glslMod3(x: vec3f, y: vec3f) -> vec3f {
  return x - y * floor(x / y);
}
