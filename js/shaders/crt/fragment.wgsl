// CRT / VHS layer, samples the channel render target as iChannel0
// glitch: 0..1, spikes when something hits the TV
// staticAmount: 0..1, full static between channels

fn crt(fragCoord: vec2f, iTime: f32, iResolution: vec2f, glitch: f32, staticAmount: f32, iChannel0: texture_2d<f32>, iChannel0Sampler: sampler) -> vec4f {
  var uv = fragCoord / iResolution;

  // barrel distortion: bulge the glass
  let centered = uv * 2.0 - 1.0;
  let bulge = centered * (1.0 + 0.12 * dot(centered, centered));
  uv = bulge * 0.5 + 0.5;

  // horizontal wobble + tearing, stronger on a glitch
  let row = floor(uv.y * 60.0);
  let tear = (hash(vec2f(row, floor(iTime * 20.0))) - 0.5) * glitch * 0.15;
  let wobble = sin(uv.y * 30.0 + iTime * 3.0) * 0.0015;
  uv.x += wobble + tear;

  // chromatic aberration, wider on a glitch
  let shift = 0.002 + glitch * 0.02;
  let r = textureSample(iChannel0, iChannel0Sampler, uv + vec2f(shift, 0.0)).r;
  let g = textureSample(iChannel0, iChannel0Sampler, uv).g;
  let b = textureSample(iChannel0, iChannel0Sampler, uv - vec2f(shift, 0.0)).b;
  var color = vec3f(r, g, b);

  // scanlines
  let scan = 0.8 + 0.2 * sin(fragCoord.y * 3.14159);
  color *= scan;

  // rolling bright band
  let band = smoothstep(0.0, 0.05, abs(fract(uv.y - iTime * 0.1) - 0.5));
  color *= 0.95 + 0.05 * band;

  // noise + static
  let n = hash(fragCoord + fract(iTime) * 100.0);
  color += (n - 0.5) * 0.06;
  color = mix(color, vec3f(n), clamp(staticAmount, 0.0, 1.0));

  // vignette
  let vig = uv * (1.0 - uv);
  color *= pow(clamp(vig.x * vig.y * 16.0, 0.0, 1.0), 0.3);

  // black outside the curved glass
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    color = vec3f(0.0);
  }

  return vec4f(color, 1.0);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
