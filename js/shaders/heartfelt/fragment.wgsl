// "Heartfelt" by Martijn Steinrucken aka BigWings - 2017
// https://www.shadertoy.com/view/ltffzl
// License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
// Changes:
// - the version without the heart (HAS_HEART off): endless rain instead of the 100 second story
// - iChannel0 (a photo, blurred with textureLod) is replaced by hfView(): a procedural night street,
//   blurred by growing its lights the same amount a mip level would
// - mouseDown replaces iMouse.z
// - left out a droplets calculation in DropLayer2 that the original overwrites right away (no visual change)

fn heartfelt(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f, mouseDown: f32) -> vec4f {
  var uv = (fragCoord - 0.5 * iResolution) / iResolution.y;
  var UV = fragCoord / iResolution;
  let M = iMouse / iResolution;
  let T = iTime + M.x * 2.0;
  var t = T * 0.2;

  let rainAmount = select(sin(T * 0.05) * 0.3 + 0.7, M.y, mouseDown > 0.0);

  let maxBlur = mix(3.0, 6.0, rainAmount);
  let minBlur = 2.0;

  let zoom = -cos(T * 0.2);
  uv *= 0.7 + zoom * 0.3;
  UV = (UV - 0.5) * (0.9 + zoom * 0.1) + 0.5;

  let staticDrops = hfS(-0.5, 1.0, rainAmount) * 2.0;
  let layer1 = hfS(0.25, 0.75, rainAmount);
  let layer2 = hfS(0.0, 0.5, rainAmount);

  let c = hfDrops(uv, t, staticDrops, layer1, layer2);
  let e = vec2f(0.001, 0.0);
  let cx = hfDrops(uv + e, t, staticDrops, layer1, layer2).x;
  let cy = hfDrops(uv + e.yx, t, staticDrops, layer1, layer2).x;
  let n = vec2f(cx - c.x, cy - c.x); // expensive normals

  let focus = mix(maxBlur - c.y, minBlur, hfS(0.1, 0.2, c.x));
  var col = hfView(UV + n, focus, iTime);

  t = (T + 3.0) * 0.5; // make time sync with first lightning
  let colFade = sin(t * 0.2) * 0.5 + 0.5;
  col *= mix(vec3f(1.0), vec3f(0.8, 0.9, 1.3), colFade); // subtle color shift
  let fade = hfS(0.0, 10.0, T); // fade in at the start
  var lightning = sin(t * sin(t * 10.0)); // lightning flicker
  lightning *= pow(max(0.0, sin(t + sin(t))), 10.0); // lightning flash
  col *= 1.0 + lightning * fade; // composite lightning
  let vignette = UV - 0.5;
  col *= 1.0 - dot(vignette, vignette); // vignette

  col *= fade; // composite start fade
  return vec4f(col, 1.0);
}

// the original's #define S(a, b, t) smoothstep(a, b, t), written out because it's
// often called with the edges reversed (a > b), which isn't guaranteed to work with WGSL's smoothstep
fn hfS(a: f32, b: f32, t: f32) -> f32 {
  let x = clamp((t - a) / (b - a), 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

fn hfN13(p: f32) -> vec3f {
  // from DAVE HOSKINS
  var p3 = fract(vec3f(p) * vec3f(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3f((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

fn hfN(t: f32) -> f32 {
  return fract(sin(t * 12345.564) * 7658.76);
}

fn hfSaw(b: f32, t: f32) -> f32 {
  return hfS(0.0, b, t) * hfS(1.0, b, t);
}

fn hfDropLayer2(uvIn: vec2f, t: f32) -> vec2f {
  let UV = uvIn;
  var uv = uvIn;

  uv.y += t * 0.75;
  let a = vec2f(6.0, 1.0);
  let grid = a * 2.0;
  var id = floor(uv * grid);

  let colShift = hfN(id.x);
  uv.y += colShift;

  id = floor(uv * grid);
  let n = hfN13(id.x * 35.2 + id.y * 2376.1);
  let st = fract(uv * grid) - vec2f(0.5, 0.0);

  var x = n.x - 0.5;

  var y = UV.y * 20.0;
  let wiggle = sin(y + sin(y));
  x += wiggle * (0.5 - abs(x)) * (n.z - 0.5);
  x *= 0.7;
  let ti = fract(t + n.z);
  y = (hfSaw(0.85, ti) - 0.5) * 0.9 + 0.5;
  let p = vec2f(x, y);

  let d = length((st - p) * a.yx);

  let mainDrop = hfS(0.4, 0.0, d);

  let r = sqrt(hfS(1.0, y, st.y));
  let cd = abs(st.x - x);
  var trail = hfS(0.23 * r, 0.15 * r * r, cd);
  let trailFront = hfS(-0.02, 0.02, st.y - y);
  trail *= trailFront * r * r;

  y = UV.y;
  y = fract(y * 10.0) + (st.y - 0.5);
  let dd = length(st - vec2f(x, y));
  let droplets = hfS(0.3, 0.0, dd);
  let m = mainDrop + droplets * r * trailFront;

  return vec2f(m, trail);
}

fn hfStaticDrops(uvIn: vec2f, t: f32) -> f32 {
  var uv = uvIn * 40.0;

  let id = floor(uv);
  uv = fract(uv) - 0.5;
  let n = hfN13(id.x * 107.45 + id.y * 3543.654);
  let p = (n.xy - 0.5) * 0.7;
  let d = length(uv - p);

  let fade = hfSaw(0.025, fract(t + n.z));
  return hfS(0.3, 0.0, d) * fract(n.z * 10.0) * fade;
}

fn hfDrops(uv: vec2f, t: f32, l0: f32, l1: f32, l2: f32) -> vec2f {
  let s = hfStaticDrops(uv, t) * l0;
  let m1 = hfDropLayer2(uv, t) * l1;
  let m2 = hfDropLayer2(uv * 1.85, t) * l2;

  var c = s + m1.x + m2.x;
  c = hfS(0.3, 1.0, c);

  return vec2f(c, max(m1.y * l0, m2.y * l1));
}

// --- replacement for iChannel0: a night street seen through the window (own code) ---

fn hfHash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// a soft light that grows as it gets blurrier, keeping its total brightness (like a mipmap does):
// sharp = small and very bright, blurry = big and dim
fn hfBokeh(uv: vec2f, pos: vec2f, size: f32, blur: f32) -> f32 {
  let r = size + blur;
  let d = length(uv - pos);
  return hfS(r, r * 0.7, d) * (size * size) / (r * r);
}

fn hfView(uv: vec2f, blur: f32, time: f32) -> vec3f {
  let b = exp2(blur) / 1024.0; // blur radius in uv, the size of a texel at this mip level of a 1024px texture

  // sky: rainy clouds lit orange by the city, darker blue higher up
  var col = mix(vec3f(0.3, 0.17, 0.12), vec3f(0.05, 0.06, 0.11), hfS(0.3, 1.0, uv.y));

  // buildings across the street, with lit windows
  let height = 0.42 + 0.2 * hfHash(vec2f(floor(uv.x * 6.0), 3.0));
  let inBuilding = hfS(height + b, height - b, uv.y) * step(0.22, uv.y);
  let cellSize = vec2f(1.0 / 36.0, 1.0 / 30.0);
  let cell = floor(uv / cellSize);
  let local = fract(uv / cellSize) - 0.5;
  let lit = step(0.55, hfHash(cell));
  let shape = hfS(0.32, 0.2, max(abs(local.x), abs(local.y)));
  let warm = mix(vec3f(1.0, 0.6, 0.25), vec3f(0.9, 0.85, 0.7), hfHash(cell + 7.0));
  // blurry: the windows melt into their average glow
  let windows = mix(shape * lit, 0.45 * 0.35, clamp(b * 25.0, 0.0, 1.0));
  col = mix(col, vec3f(0.04, 0.035, 0.045) + warm * windows, inBuilding);

  // street with a wet glow
  let street = 1.0 - hfS(0.2, 0.24, uv.y);
  col = mix(col, vec3f(0.05, 0.04, 0.045) + vec3f(0.6, 0.33, 0.14) * (0.24 - uv.y), street);

  // street lamps
  for (var i = 0; i < 4; i++) {
    let pos = vec2f(f32(i) * 0.33 + 0.08, 0.38);
    col += hfBokeh(uv, pos, 0.012, b) * vec3f(1.0, 0.62, 0.28) * 10.0;
  }

  // traffic: headlights one way, tail lights the other
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let forward = i % 2 == 0;
    let speed = (0.04 + fi * 0.012) * select(-1.0, 1.0, forward);
    let x = fract(time * speed + hfHash(vec2f(fi, 1.0))) * 1.4 - 0.2;
    let y = select(0.1, 0.14, forward);
    let light = select(vec3f(1.0, 0.08, 0.04), vec3f(1.0, 0.92, 0.75), forward);
    col += (hfBokeh(uv, vec2f(x, y), 0.006, b) + hfBokeh(uv, vec2f(x + 0.035, y), 0.006, b)) * light * 12.0;
  }

  // haze from the rain
  return col + vec3f(0.02, 0.02, 0.03);
}
