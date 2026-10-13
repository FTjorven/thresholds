# Thresholds: project notes

Second creative code assignment (Devine, Howest): port a Shadertoy shader to WebGPU, in Three.js with `WebGPURenderer`, responding to user interaction.
The earlier CRT TV concept is kept in git under the tag `crt-tv-room`.

## 1. The assignment

- Port a Shadertoy fragment shader to WGSL, inside a Three.js `WebGPURenderer` scene, responding to user interaction.
- Submit a live URL + the source code (separate submissions). **No `node_modules`.**
- `README.md` at the root must mention the original Shadertoy URL(s).
- Must work online. Not online = no marks. Deploy early and often.

Extra marks: interaction beyond looking around, physics, multiple shaders, additional WebGPU libraries, own Blender models with baking, controlling Blender animations.

## 2. The concept

First person on a **floating ruin in a void**. Free-standing stone **archways** are doorways into **Shadertoy worlds**.

- Looking through a doorway shows the world **with real depth**: the shader gets the ray from your eye (`positionWorld`, `cameraPosition`), not a flat picture.
- **Walking through** a doorway puts you inside: the shader becomes the whole world around you.
- In each world you find an **artifact** and carry it back. Placing it on the central dais brings the ruin to life (Blender animation) and opens the next archway.

| Extra marks | How |
| --- | --- |
| Interaction beyond looking around | Walking through doorways, carrying artifacts, unlocking worlds |
| Physics | Rapier: pick up / carry / throw artifacts, things fall into the void |
| Multiple shaders | One world per archway (Star Nest, Seascape, Creation), Heartfelt rain during transitions |
| Additional WebGPU libraries | TSL compute particles: dust drifting around the open archway |
| Own Blender models + baking | The ruin, archways, artifacts (baked) |
| Blender animations | Dais mechanism coming alive, archways unsealing |

## 3. Stages

1. [x] First-person prototype: ruin placeholder, one open archway into Star Nest with real depth. **Deploy.**
2. [x] Walk through the archway: inside, Star Nest surrounds you (sphere around the camera, `rayOrigin = cameraPosition`), weightless flying, the archway shows the ruin from behind (screen-space portal), flash + view stretch on crossing.
3. [ ] Artifacts + Rapier physics: pick up, carry, throw, place on the dais.
4. [x] More worlds: Seascape (ocean, includes the straight port) and Creation (2D, mapped onto directions around a far light) as "world" versions. All three archways open. Note: the artifact/unlock idea from stage 3 now needs a different goal, since every archway is already open.
5. [ ] Blender ruin replaces the placeholder. Baking, animations.
6. [ ] Polish: transitions (Heartfelt rain on the view), compute particles, sound?

## 4. Code structure

```
index.html            start screen, crosshair
css/style.css
js/script.js          renderer, scene, lights, portal materials, draw loop
js/player.js          first person controls (pointer lock, WASD, gravity, respawn, weightless flying)
js/doorway.js         detects walking through an archway (front to back = in, back to front = out)
js/ruin.js            placeholder ruin: floor, archways, pillars, floating rocks, isGround()
js/shaders/<name>/fragment.wgsl    straight port (pixel ray)
js/shaders/<name>/world.wgsl       world version (ray from the 3D scene), for starNest, seascape, creation
js/shaders/heartfelt: ported, not used yet
```

## 5. For the Blender model

Keep these names so the code can find the parts (same names as the placeholder in `js/ruin.js`):

- `Ruin_Floor`, `Ruin_Dais`
- `Arch_1`, `Arch_2`, `Arch_3`, each with an `Arch_N_Portal` mesh: the flat opening inside the archway. Its **front** (normal) faces the side you look in from. Exclude it from the bake.
- Units in meters, floor top at y = 0, archway openings about 1.9 m wide and 3.4 m tall.
- Bake to `public/assets/baked.jpg`, export `public/assets/Ruin.glb` (animations included).

Course pattern for loading a baked model: `threejs/projects/blender-three-bake-final` in https://github.com/devinekask/creative-development-f26

## 6. GLSL → WGSL gotchas (met so far)

- `vec3` → `vec3f`, `float x =` → `let` / `var`, `#define` → `const`
- `from` is a reserved word in WGSL (Star Nest's camera origin)
- GLSL `mod()` ≠ WGSL `%` for negative numbers: use a floor-based helper
- No swizzle assignment (`dir.xz *= rot`): split it up
- `smoothstep` with reversed edges isn't guaranteed: write the formula out (Heartfelt's `S()`)
- `pow` of a negative number is NaN: clamp first (Seascape)
- `wgslFn` reads the **first** function in the file: main function first, helpers below
- Shadertoy's y axis points up; a render target's points down (flip when rendering a channel into a texture)

## 7. Testing + deployment

- `npm run build` → `dist/`. Host on Netlify / Vercel (connect the GitHub repo, build `npm run build`, publish `dist`), or GitHub Pages with `base` in `vite.config.js`.
- Render targets in this dark scene need `type: THREE.HalfFloatType`: 8-bit linear storage crushes the dark colors.
- Automated tests: use **headless** Chrome (`--enable-unsafe-webgpu --use-angle=metal`); a visible test window steals keyboard focus.
