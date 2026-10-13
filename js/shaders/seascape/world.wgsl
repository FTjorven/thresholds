// "Seascape" by Alexander Alekseev aka TDM - 2014
// https://www.shadertoy.com/view/Ms2SD1
// License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
//
// "World" version of the port in fragment.wgsl, which is included: all the sea, sky and lighting
// functions are reused as they are. Only the camera part of mainImage changes: instead of a camera
// that flies along by itself, the ray comes from the player's eye in the 3D scene.
// - 1 meter in the scene = 1 unit in the sea
// - eye height on the ruin (1.6 m) = the original camera height (3.5 units above the sea)

fn seascapeWorld(rayOrigin: vec3f, rayDir: vec3f, iTime: f32) -> vec4f {
  let seaTime = 1.0 + iTime * SEA_SPEED;

  let ori = vec3f(rayOrigin.x, rayOrigin.y + 1.9, rayOrigin.z);
  let dir = rayDir;

  // tracing
  let p = seaHeightMapTracing(ori, dir, seaTime);
  let dist = p - ori;
  // EPSILON_NRM is 0.1 / iResolution.x in the original: a fixed value for an 500 pixel wide view
  let n = seaGetNormal(p, dot(dist, dist) * 0.0002, seaTime);
  let light = normalize(vec3f(0.0, 1.0, 0.8));

  // color
  let color = mix(
    seaGetSkyColor(dir),
    seaGetSeaColor(p, n, light, dir, dist),
    pow(1.0 - smoothstep(-0.05, 0.0, dir.y), 0.3)
  );

  // post
  return vec4f(pow(max(color, vec3f(0.0)), vec3f(0.75)), 1.0);
}
