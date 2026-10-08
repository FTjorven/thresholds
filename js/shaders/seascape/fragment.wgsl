// "Seascape" by Alexander Alekseev aka TDM - 2014
// https://www.shadertoy.com/view/Ms2SD1
// License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
// Ported from the 2014 version of the shader.
// Changes: map() and map_detailed() merged into one function with an iteration count,
// SEA_TIME passed in as a parameter (WGSL has no #define)

fn seascape(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f) -> vec4f {
  var uv = fragCoord / iResolution;
  uv = uv * 2.0 - 1.0;
  uv.x *= iResolution.x / iResolution.y;
  let time = iTime * 0.3 + iMouse.x * 0.01;
  let seaTime = 1.0 + iTime * SEA_SPEED;

  // ray
  let ang = vec3f(sin(time * 3.0) * 0.1, sin(time) * 0.2 + 0.3, time);
  let ori = vec3f(0.0, 3.5, time * 5.0);
  var dir = normalize(vec3f(uv, -2.0));
  dir.z += length(uv) * 0.15;
  dir = normalize(dir) * seaFromEuler(ang);

  // tracing
  let p = seaHeightMapTracing(ori, dir, seaTime);
  let dist = p - ori;
  let n = seaGetNormal(p, dot(dist, dist) * (0.1 / iResolution.x), seaTime);
  let light = normalize(vec3f(0.0, 1.0, 0.8));

  // color
  // smoothstep(0.0, -0.05, x) has its edges reversed, which WGSL doesn't allow: 1 - smoothstep(-0.05, 0.0, x) is the same curve
  let color = mix(
    seaGetSkyColor(dir),
    seaGetSeaColor(p, n, light, dir, dist),
    pow(1.0 - smoothstep(-0.05, 0.0, dir.y), 0.3)
  );

  // post (max: pow of a negative number is NaN in WGSL)
  return vec4f(pow(max(color, vec3f(0.0)), vec3f(0.75)), 1.0);
}

const SEA_NUM_STEPS = 8;
const SEA_PI = 3.141592;

const SEA_ITER_GEOMETRY = 3;
const SEA_ITER_FRAGMENT = 5;
const SEA_HEIGHT = 0.6;
const SEA_CHOPPY = 4.0;
const SEA_SPEED = 0.8;
const SEA_FREQ = 0.16;
const SEA_BASE = vec3f(0.1, 0.19, 0.22);
const SEA_WATER_COLOR = vec3f(0.8, 0.9, 0.6);
const SEA_OCTAVE_M = mat2x2f(1.6, 1.2, -1.2, 1.6);

// math
fn seaFromEuler(ang: vec3f) -> mat3x3f {
  let a1 = vec2f(sin(ang.x), cos(ang.x));
  let a2 = vec2f(sin(ang.y), cos(ang.y));
  let a3 = vec2f(sin(ang.z), cos(ang.z));
  return mat3x3f(
    vec3f(a1.y * a3.y + a1.x * a2.x * a3.x, a1.y * a2.x * a3.x + a3.y * a1.x, -a2.y * a3.x),
    vec3f(-a2.y * a1.x, a1.y * a2.y, a2.x),
    vec3f(a3.y * a1.x * a2.x + a1.y * a3.x, a1.x * a3.x - a1.y * a3.y * a2.x, a2.y * a3.y)
  );
}

fn seaHash(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn seaNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return -1.0 + 2.0 * mix(
    mix(seaHash(i + vec2f(0.0, 0.0)), seaHash(i + vec2f(1.0, 0.0)), u.x),
    mix(seaHash(i + vec2f(0.0, 1.0)), seaHash(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

// lighting
fn seaDiffuse(n: vec3f, l: vec3f, p: f32) -> f32 {
  return pow(dot(n, l) * 0.4 + 0.6, p);
}

fn seaSpecular(n: vec3f, l: vec3f, e: vec3f, s: f32) -> f32 {
  let nrm = (s + 8.0) / (SEA_PI * 8.0);
  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
}

// sky
fn seaGetSkyColor(eye: vec3f) -> vec3f {
  let y = max(eye.y, 0.0);
  return vec3f(pow(1.0 - y, 2.0), 1.0 - y, 0.6 + (1.0 - y) * 0.4);
}

// sea
fn seaOctave(uvIn: vec2f, choppy: f32) -> f32 {
  let uv = uvIn + seaNoise(uvIn);
  var wv = 1.0 - abs(sin(uv));
  let swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

fn seaMap(p: vec3f, seaTime: f32, iterations: i32) -> f32 {
  var freq = SEA_FREQ;
  var amp = SEA_HEIGHT;
  var choppy = SEA_CHOPPY;
  var uv = p.xz;
  uv.x *= 0.75;

  var h = 0.0;
  for (var i = 0; i < iterations; i++) {
    var d = seaOctave((uv + seaTime) * freq, choppy);
    d += seaOctave((uv - seaTime) * freq, choppy);
    h += d * amp;
    uv = uv * SEA_OCTAVE_M;
    freq *= 1.9;
    amp *= 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return p.y - h;
}

fn seaGetSeaColor(p: vec3f, n: vec3f, l: vec3f, eye: vec3f, dist: vec3f) -> vec3f {
  var fresnel = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
  fresnel = pow(fresnel, 3.0) * 0.65;

  let reflected = seaGetSkyColor(reflect(eye, n));
  let refracted = SEA_BASE + seaDiffuse(n, l, 80.0) * SEA_WATER_COLOR * 0.12;

  var color = mix(refracted, reflected, fresnel);

  let atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  color += SEA_WATER_COLOR * (p.y - SEA_HEIGHT) * 0.18 * atten;

  color += vec3f(seaSpecular(n, l, eye, 60.0));

  return color;
}

// tracing
fn seaGetNormal(p: vec3f, eps: f32, seaTime: f32) -> vec3f {
  let y = seaMap(p, seaTime, SEA_ITER_FRAGMENT);
  let x = seaMap(vec3f(p.x + eps, p.y, p.z), seaTime, SEA_ITER_FRAGMENT) - y;
  let z = seaMap(vec3f(p.x, p.y, p.z + eps), seaTime, SEA_ITER_FRAGMENT) - y;
  return normalize(vec3f(x, eps, z));
}

// returns the hit point (the original returns the distance and writes the point to an out parameter)
fn seaHeightMapTracing(ori: vec3f, dir: vec3f, seaTime: f32) -> vec3f {
  var tm = 0.0;
  var tx = 1000.0;
  var hx = seaMap(ori + dir * tx, seaTime, SEA_ITER_GEOMETRY);
  if (hx > 0.0) {
    return ori + dir * tx;
  }
  var hm = seaMap(ori + dir * tm, seaTime, SEA_ITER_GEOMETRY);
  var p = ori;
  for (var i = 0; i < SEA_NUM_STEPS; i++) {
    let tmid = mix(tm, tx, hm / (hm - hx));
    p = ori + dir * tmid;
    let hmid = seaMap(p, seaTime, SEA_ITER_GEOMETRY);
    if (hmid < 0.0) {
      tx = tmid;
      hx = hmid;
    } else {
      tm = tmid;
      hm = hmid;
    }
  }
  return p;
}
