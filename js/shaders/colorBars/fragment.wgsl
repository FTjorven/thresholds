// SMPTE-style color bars test card (own shader, not from Shadertoy)
// iMouse.x shifts the hue, like the tint knob on an old TV

fn colorBars(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f) -> vec4f {
  let uv = fragCoord / iResolution;
  let bar = clamp(i32(floor(uv.x * 7.0)), 0, 6);
  var color: vec3f;

  if (uv.y > 0.33) {
    // top: gray, yellow, cyan, green, magenta, red, blue at 75%
    var top = array<vec3f, 7>(
      vec3f(0.75, 0.75, 0.75), vec3f(0.75, 0.75, 0.0), vec3f(0.0, 0.75, 0.75), vec3f(0.0, 0.75, 0.0),
      vec3f(0.75, 0.0, 0.75), vec3f(0.75, 0.0, 0.0), vec3f(0.0, 0.0, 0.75)
    );
    color = top[bar];
  } else if (uv.y > 0.25) {
    // middle: the top bars in reverse, with black in between
    var middle = array<vec3f, 7>(
      vec3f(0.0, 0.0, 0.75), vec3f(0.0), vec3f(0.75, 0.0, 0.75), vec3f(0.0),
      vec3f(0.0, 0.75, 0.75), vec3f(0.0), vec3f(0.75, 0.75, 0.75)
    );
    color = middle[bar];
  } else {
    // bottom: dark blue, white, purple, black, with a slow moving bright line
    let x = uv.x * 7.0;
    if (x < 1.25) {
      color = vec3f(0.0, 0.13, 0.3);
    } else if (x < 2.5) {
      color = vec3f(1.0);
    } else if (x < 3.75) {
      color = vec3f(0.2, 0.0, 0.42);
    } else {
      color = vec3f(0.03);
    }
    let sweep = fract(iTime * 0.2) * 1.2 - 0.1;
    color += vec3f(0.4) * smoothstep(0.02, 0.0, abs(uv.x - sweep));
  }

  // tint knob: rotate the hue around the gray axis
  let angle = iMouse.x / iResolution.x * 6.2831;
  let k = vec3f(0.57735);
  let cosA = cos(angle);
  color = color * cosA + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - cosA);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
