# CRT TV: Shadertoy → WebGPU project notes

Handoff notes for the second creative code assignment (Devine, Howest).
---

## 1. The assignment (summary)

- Pick a fragment shader on Shadertoy, port it to WebGPU (WGSL).
- Embed it in a Three.js scene using `WebGPURenderer`.
- The shader must respond to user interaction.
- Submit: a live URL + the source code (separate submissions). **No `node_modules`.**
- `README.md` at the project root must mention the original Shadertoy URL(s).
- Must be fully working online. Not online = no marks. Deploy early and often, use Git/GitHub.

Extra marks:
- Interaction beyond just looking around
- Physics
- Multiple shaders
- Additional WebGPU libraries
- Own Blender models, including baking
- Controlling animations from a Blender model

---

## 2. The concept: an old CRT TV in a baked room

A small retro room (modelled and baked in Blender) with an old CRT television.

- **The TV screen** shows a Shadertoy shader ("the channel").
- **A second shader** sits on top as a CRT/VHS layer: scanlines, barrel distortion, noise, wobble.
- **Channel knob** on the TV is a Blender animation. Clicking it plays the knob turn and switches to another channel shader, with a burst of static in between.
- **Mouse on the screen** (raycast → UV of the screen) becomes `iMouse`, so you steer the flight through stars / over the sea.
- **Physics** (Rapier): throw objects (remote, cassette) at the TV. A hard hit spikes a `glitch` uniform in the CRT shader, which fades back down.

How each extra-marks item is covered:

| Extra marks | How |
| --- | --- |
| Interaction beyond looking around | Raycast steering of `iMouse`, clicking the knob, throwing objects |
| Physics | Rapier (`three/addons/physics/RapierPhysics.js` or `@dimforge/rapier3d-compat`) |
| Multiple shaders | Channel shader → render target → CRT shader samples it as `iChannel0`; 2 to 3 channels |
| Additional WebGPU libraries | Weakest point. Rapier is not WebGPU. Option: a small TSL compute particle effect (sparks / dust when something hits the TV), or a WebGPU-specific post-processing pass |
| Own Blender model + baking | Room + TV baked to `baked.jpg`, course pattern from `blender-three-bake-final` |
| Blender animations | Channel knob turn (and maybe antenna wobble / power button) via `AnimationMixer` |

---

## 3. Shader shortlist

I could not open Shadertoy from my tools, so **open each link and verify it's the right shader** before porting. All are well known.

Channel shaders (on the TV):
- **Star Nest** by Kali: https://www.shadertoy.com/view/XlfGRj
  Volumetric starfield, single pass, already uses `iMouse`. **Easiest port, do this one first.**
- **Fractal Land** by Kali: https://www.shadertoy.com/view/XsBXWt
  Flight over a fractal landscape, single pass.
- **Seascape** by TDM: https://www.shadertoy.com/view/Ms2SzD
  Raymarched ocean, mouse-controllable, single pass. Longer code.
- **Protean Clouds** by nimitz: https://www.shadertoy.com/view/3l23Rh
  Cloud fly-through, single pass, mouse reactive.

CRT layer:
- **VCR distortion** by ryk: https://www.shadertoy.com/view/ldjGzV
  VHS wobble, noise, tracking lines over `iChannel0`. Short.
- Alternative: write scanlines + barrel distortion + vignette yourself (~20 lines WGSL). Shows more of your own work.

Avoid **Cyber Fuji** (https://www.shadertoy.com/view/Wt33Wf): that one is already used in the course example.

Plan: Star Nest first → deploy → CRT layer → deploy → Blender room → physics → second channel.

---

## 4. How the course does things (follow this)

Course repo: https://github.com/devinekask/creative-development-f26
- `threejs/projects/shadertoy`: Shadertoy port with a buffer + render target (plasma). **Closest to this project.**
- `threejs/projects/blender-three-bake-final`: baked Blender room + shader on the monitor plane (Cyber Fuji).
- `webgpu/README.md` has a GLSL → WGSL cheat sheet at the bottom.
- `threejs/README.md` section "Shadertoy shader in Three.js" explains the whole porting process step by step.

### Project setup

Vite + three, same versions as the course:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.186.0"
  },
  "devDependencies": {
    "vite": "^8.3.0"
  }
}
```

Folder structure (course style):

```
index.html
css/style.css
js/script.js
js/shaders/starNest/fragment.wgsl
js/shaders/crt/fragment.wgsl
public/assets/Room.glb
public/assets/baked.jpg
README.md
.gitignore        (node_modules, dist)
```

### Imports

```js
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, texture, colorSpaceToWorking } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import starNestShader from './shaders/starNest/fragment.wgsl?raw';
```

### Porting a shader to a WGSL function

- Put the shader in its own `.wgsl` file, import it with `?raw`.
- **The main function must come first in the file**: `wgslFn` reads the signature of the first function. Helper functions go *below* it.
- Every Shadertoy input becomes a named parameter:

```wgsl
// https://www.shadertoy.com/view/XlfGRj
fn starNest(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iMouse: vec2f) -> vec4f {
  // ... ported mainImage body, returns the color instead of writing fragColor
}
```

- A texture input becomes two parameters: `iChannel0: texture_2d<f32>, iChannel0Sampler: sampler`, and `texture(...)` becomes `textureSample(iChannel0, iChannel0Sampler, uv)`.
- `fragCoord` is faked from the mesh UVs, so the shader works on any mesh (like the TV screen):

```js
const iTime = uniform(0);
const iResolution = uniform(new THREE.Vector2(4, 3)); // 4:3 for a CRT
const iMouse = uniform(new THREE.Vector2(0, 0));

const starNest = wgslFn(starNestShader);
const material = new THREE.MeshBasicNodeMaterial();
material.colorNode = starNest({
  fragCoord: uv().mul(iResolution),
  iTime,
  iResolution,
  iMouse,
});

// in the draw loop
iTime.value = clock.getElapsedTime();
```

### GLSL → WGSL gotchas

- `vec3` → `vec3f`, `float` → `f32`, `mat3` → `mat3x3f`
- `float x = 1.0;` → `let x = 1.0;` (constant) or `var x = 1.0;` (changes later)
- `mod(x, y)` is **not** the same as WGSL `%` for negative numbers. Use a helper (the course has `glslMod` in the Cyber Fuji shader):

```wgsl
fn glslMod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
```

- `color.rgb *= 0.5;` is not allowed → `color = vec4f(color.rgb * 0.5, color.a);`
- `if (x) y = 0.0;` needs braces: `if (x) { y = 0.0; }`
- No `#define`. Replace with `const` or inline the value.
- Only `xyzw` / `rgba` swizzles (no `.st`).
- Loops: `for (int i = 0; i < 20; i++)` → `for (var i = 0; i < 20; i++)`. Integer/float mixing must be explicit: `f32(i)`.
- Shadertoy's `fragCoord` has its origin bottom-left. If the image is upside down, flip: `uv().mul(iResolution)` with `vec2f(fragCoord.x, iResolution.y - fragCoord.y)`, or flip the UV in JS.

### Two shaders: render target (channel) → CRT shader

Same pattern as the plasma "Buffer A" in the course:

```js
// 1. the channel renders into a texture
const rtScene = new THREE.Scene();
const rtCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const rtMaterial = new THREE.MeshBasicNodeMaterial();
rtMaterial.colorNode = starNest({ fragCoord: uv().mul(rtResolution), iTime, iResolution: rtResolution, iMouse });
rtScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rtMaterial));

const renderTarget = new THREE.RenderTarget(640, 480, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});

// 2. the CRT shader samples that texture, on the TV screen mesh
const iChannel0 = texture(renderTarget.texture);
const crt = wgslFn(crtShader);
screenMaterial.colorNode = colorSpaceToWorking(crt({
  fragCoord: uv().mul(iResolution),
  iTime,
  iResolution,
  glitch,               // own uniform, spikes on physics hits
  iChannel0,
  iChannel0Sampler: iChannel0,  // passed twice: once as texture, once as sampler
}), THREE.SRGBColorSpace);

// 3. in the draw loop
renderer.setRenderTarget(renderTarget);
renderer.render(rtScene, rtCamera);
renderer.setRenderTarget(null);
renderer.render(scene, camera);
```

Switching channels: keep one `MeshBasicNodeMaterial` per channel shader and swap `rtMesh.material`, or make one material with a `channel` uniform. Swapping materials is simpler.

A low render target resolution (e.g. 320×240) looks more like an old TV and is cheaper to render.

### Colors

- Shader only on screen → `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`.
- **This project mixes a shader with a baked room**, so do NOT change the renderer. Wrap the shader output in `colorSpaceToWorking(..., THREE.SRGBColorSpace)` instead (see above).

### Blender: baking + loading

From `blender-three-bake-final`:

```js
const bakedTexture = new THREE.TextureLoader().load('assets/baked.jpg');
bakedTexture.flipY = false;                     // glTF expects this
bakedTexture.colorSpace = THREE.SRGBColorSpace; // baked image = display colors
const bakedMaterial = new THREE.MeshBasicMaterial({ map: bakedTexture });

new GLTFLoader().load('assets/Room.glb', (gltf) => {
  gltf.scene.traverse((child) => {
    if (child.name === 'TV_Screen') {
      child.material = screenMaterial;
    } else {
      child.material = bakedMaterial;
    }
  });
  scene.add(gltf.scene);
});
```

- Name the screen mesh clearly in Blender (e.g. `TV_Screen`) and give it a clean 0 to 1 UV unwrap, so `uv()` maps the full shader onto it.
- Exclude the screen from the bake (or bake it black).
- Assets go in `public/assets/` so Vite copies them to `dist/` as-is.

---

## 5. Interaction pieces (not in the course, standard Three.js)

### Mouse on the screen → `iMouse`

```js
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(tvScreen)[0];
  if (hit) {
    // hit.uv is 0..1 on the screen; scale to "pixels" like Shadertoy expects
    iMouse.value.set(hit.uv.x * rtResolution.value.x, hit.uv.y * rtResolution.value.y);
  }
});
```

Same raycaster on `click` against the knob mesh → play the knob animation + switch channel.

### Blender animations

```js
const mixer = new THREE.AnimationMixer(gltf.scene);
const knobClip = THREE.AnimationClip.findByName(gltf.animations, 'KnobTurn');
const knobAction = mixer.clipAction(knobClip);
knobAction.setLoop(THREE.LoopOnce);
knobAction.clampWhenFinished = true;

// on click
knobAction.reset().play();

// draw loop
mixer.update(delta);
```

- In Blender: animate the knob, push each action to the NLA (or make sure it's stored as an action), export glTF with Animations enabled.
- Name actions clearly (`KnobTurn`), that's the name `findByName` uses.

### Physics (Rapier)

- Three.js ships a helper: `three/addons/physics/RapierPhysics.js` (loads Rapier itself, easy start).
- For more control: `npm i @dimforge/rapier3d-compat` and step the world yourself in the draw loop.
- Use simple colliders (boxes) for the room/TV, not the full mesh.
- On a collision with the TV: `glitch.value = Math.min(1, impactStrength)`; in the draw loop decay it: `glitch.value *= 0.92`.

### Static between channels

On a channel switch, set a `static` uniform to 1 and decay it, same trick as `glitch`. In the CRT shader, mix the image with noise based on that value.

---

## 6. Deployment

The course doesn't prescribe a host. `npm run build` → `dist/` folder → host it.

- **Netlify / Vercel**: connect the GitHub repo, build command `npm run build`, publish dir `dist`. Auto-deploys on every push. Easiest.
- **GitHub Pages**: needs `base` in `vite.config.js`, otherwise assets 404 online:

```js
// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  base: '/your-repo-name/',
});
```

- WebGPU needs a browser that supports it (Chrome / Edge, recent Safari). Test the live URL in the browser the teachers will likely use.
- Paths: load assets with relative paths (`'assets/Room.glb'`, no leading `/`), works both locally and with a `base`.
- **Deploy the first working version (Star Nest on a plane) on day one.** Then every step after that.

---

## 7. README.md (required)

Must include at least the original shader URL(s). Suggested content:

```md
# CRT TV

Live: <url>

Original shaders:
- Star Nest by Kali: https://www.shadertoy.com/view/XlfGRj
- (CRT layer source, if ported)
- (other channels)

Interaction: ...
Built with: Three.js WebGPURenderer, TSL/WGSL, Rapier, Blender (baked)
```

---

## 8. Step-by-step plan

1. [ ] Vite + three project, Git repo, push to GitHub.
2. [ ] Star Nest ported to WGSL on a plane, OrbitControls. **Deploy.**
3. [ ] Render target + CRT shader on top (scanlines, distortion, noise). **Deploy.**
4. [ ] Placeholder TV (box + screen plane), raycast → `iMouse`.
5. [ ] Blender: model the room + TV, bake, export `Room.glb` + `baked.jpg`. Swap out the placeholder. **Deploy.**
6. [ ] Knob animation in Blender → `AnimationMixer` on click → channel switch with static.
7. [ ] Second channel shader (Fractal Land or Seascape).
8. [ ] Rapier: throwable objects, hits → glitch. **Deploy.**
9. [ ] Optional: TSL compute sparks on impact (extra WebGPU points).
10. [ ] README with shader URLs, final check of the live URL, submit URL + source (no node_modules).

---

## 9. Placeholder room + interactables

`js/room.js` builds a placeholder room from primitives, in meters (floor at y = 0), so physics sizes are realistic.
Mesh names are the names to use in Blender (`TV_Screen`, `TV_Knob`, `VCR`, `Remote`, ...), so the GLB can replace it 1:1.
Interactables are tagged with `userData.interactable` and collected in `interactables` (not wired up yet, except the channel knob).

Layout: back wall with the TV on an open cabinet (VCR + tapes on the bottom shelf), floor lamp left corner, plant right corner,
clock + poster on the back wall, light switch on the left wall, coffee table + rug in front, wastebasket next to the table.

| Object | Tag | Interaction idea | Extra marks |
| --- | --- | --- | --- |
| Channel knob | `channelKnob` | ✅ Click: next channel + static. Later: Blender `KnobTurn` animation | Blender animation |
| Volume knob | `volumeKnob` | Drag to rotate: controls a shader param (CRT warp/saturation) or real audio volume | Interaction |
| Rabbit-ear antenna | `antenna` | Drag the ears: signal quality. Bad angle = more `staticAmount`, perfect angle = clean picture | Interaction, Blender animation |
| Remote | `remote` | Pick up: buttons switch channels from the couch. Or throw it at the TV | Physics |
| Paper balls + soda can | `throwable` | Click + flick to throw (Rapier). Hits on the TV spike `glitch`. Wastebasket = ammo (respawns) | Physics |
| Tapes + VCR | `tape`, `vcr` | Drag a tape into the VCR slot: plays a "recorded" channel (different shader, VHS tracking lines stronger). Eject button | Multiple shaders, Blender animation (tape sliding in) |
| Floor lamp | `lamp` | Click: toggle. Room goes dark, the TV becomes the only light | Interaction |
| Light switch | `lightSwitch` | Same as the lamp but for the whole room: swap between a "day" and "night" bake | Blender baking (two bakes) |
| Wall clock | `clock` | ✅ Shows the real time. Idea: drag the minute hand to scrub `iTime` (rewind the flight) | Interaction |
| Poster | `poster` | Another shader as the poster image (e.g. a small TSL pattern) that reacts to the channel | Multiple shaders |
| Plant | `plant` | Dynamic physics body: knock it over with a thrown ball | Physics |

Fun extra: smack the side of the TV (click the case) to "fix" the picture: clears static, like a real old TV.

Suggested order: throwables + glitch (physics) → antenna (static) → tapes/VCR (second shader) → lamp/light switch (baking).
