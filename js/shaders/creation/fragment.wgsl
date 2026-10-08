// "Creation" by Silexars (Danilo Guanabara)
// https://www.shadertoy.com/view/XsXXDn
// Changes: the center of the ripples follows iMouse (the original has no mouse input)

fn creation(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f) -> vec4f {
  // no mouse yet: keep the original center
  let center = select(iMouse / iResolution, vec2f(0.5), all(iMouse == vec2f(0.0)));

  var c = vec3f(0.0);
  var l = 0.0;
  var z = iTime;
  for (var i = 0; i < 3; i++) {
    var p = fragCoord / iResolution;
    var uv = p;
    p -= center;
    p.x *= iResolution.x / iResolution.y;
    z += 0.07;
    l = length(p);
    uv += p / l * (sin(z) + 1.0) * abs(sin(l * 9.0 - z - z));
    c[i] = 0.01 / length(creationMod(uv, vec2f(1.0)) - 0.5);
  }
  return vec4f(c / l, 1.0);
}

// GLSL mod() floors, WGSL % truncates: they differ for negative numbers
fn creationMod(x: vec2f, y: vec2f) -> vec2f {
  return x - y * floor(x / y);
}
