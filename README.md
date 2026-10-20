# Thresholds

A first-person walk through Shadertoy worlds, built with Three.js `WebGPURenderer` and WGSL.

You stand on a floating ruin in a void. Its stone archways are doorways into other worlds: each one is a Shadertoy shader, ported to WGSL. The shader doesn't sit on the doorway as a flat picture. It gets the real ray from your eye, so the world behind the doorway has depth and shifts as you move.

Live: https://ftjorven.github.io/thresholds/

## Original shaders

One world behind each archway. For each shader, `fragment.wgsl` is the straight port and `world.wgsl` the version that takes its ray from the 3D scene:

- Star Nest by Kali (Pablo Roman Andrioli): https://www.shadertoy.com/view/XlfGRj: a nebula to float through
- Seascape by Alexander Alekseev (TDM): https://www.shadertoy.com/view/Ms2SD1 (ported from the 2014 version): an open sea to skim over. The world version includes the straight port and reuses all its functions
- Creation by Silexars (Danilo Guanabara): https://www.shadertoy.com/view/XsXXDn: the 2D original becomes a giant pulsing light far away, mapped onto the directions around you (stereographic projection). Fly towards it and it grows around you
- Heartfelt by Martijn Steinrucken (BigWings): https://www.shadertoy.com/view/ltffzl: rain on a window, the way home. A 2D shader, so it gets pixel coordinates: on the final archway its position on the opening, at the very end the whole screen

## The game

Three lights were lost to the worlds beyond the arches. Bring them home.

1. **Tune the world.** Each world hides a light, but it only shows up when the world is tuned right. The carving on the crown of each archway shows where its dial has to point, and lights up when it does.
2. **Find the light.** Fly through the world until you find it: high up in Star Nest, low over the waves in Seascape, in front of the far light in Creation.
3. **Carry it home.** Take it back through the doorway. Drop it into the void or throw it through a doorway, and it goes back to its world.
4. **Place it on the dais.** Each light has its own socket. Placing it wakes a stone ring that rises and hangs, tilted, above the dais (an animation from the Blender model). The ruin brightens with every light.
5. **The way home.** With all three home, a fourth archway rises out of the dais. Through it: Heartfelt's rain, full screen, and the credits.

Along the way, a line at the top tells you the next step, and a marker points at where to go (the world's light, the doorway home, the socket), pinned to the edge of the screen when it's out of view.

## Controls

- Click to enter (locks the mouse)
- Mouse: look around
- WASD / arrow keys: walk, Shift: run, Space: jump
- Click / E: pick up, throw, turn a dial, place a light (look at it, the crosshair turns into a ring)
- Walk through an archway to enter its world. Inside you're weightless: fly where you look, Space to rise, Shift to go faster. The archway leads back.
- M: sound on / off
- Esc: pause

## How it works

Every pixel of a doorway runs the shader with:

- `rayOrigin`: the point on the doorway this pixel shows (`positionWorld`)
- `rayDir`: the direction from the camera through that point (`positionWorld - cameraPosition`)

So walking around the doorway changes the rays, which is the user interaction that drives the shader.

Walking through the doorway puts you inside the world: a big sphere follows you, painted from the inside with the same shader, now with the rays starting at your eye. Looking back, the doorway shows the ruin: the ruin is rendered from your exact viewpoint into a texture, and the back of the doorway shows that texture at the same spot on screen (`screenUV`), so it lines up perfectly.

## Around the archways

- **Crystals** (2 per archway), **urns** and **stones**: pick up and throw, or bump into them (Rapier physics). Throw one through a doorway and it disappears into that world, which energizes it: the world's clock runs up to 6× faster and it brightens, then calms down. The prop comes back after a few seconds. Things that fall off the island come back too.
- **Tuning dials** (1 per archway): each click turns the dial a notch and changes a value in that world's shader:
  - Star Nest: the fractal's "magic formula" parameter (0.53 original, 0.38 glowing nebula, 0.565 star cluster)
  - Seascape: time of day (noon, golden hour, dusk)
  - Creation: the size of the light

## Blender model

`public/assets/dais.glb`, made in Blender by `blender/build_dais.py` (the scene is saved as `blender/dais.blend`):

- **The archway** (pillars with plinths and capitals, the round top, a keystone with the tuning carving on it, the step), used for all four doorways. The doorway opening itself stays in code, because it carries the shader
- **The dais mechanism**: three stone rings with glowing studs lying around the dais, three sockets for the lights, and the final archway waiting under the floor

**Baking**: all stone parts share one 2048×2048 texture (`blender/dais_baked.jpg`). They're unwrapped together, then Cycles bakes the procedural stone color (two layers of noise) and the ambient occlusion, which are multiplied into the final texture. The rings are baked in the pose they end up in (hanging above the dais), the final archway standing on the dais, with a helper floor and dais for the occlusion to touch. In the game the scene's lights shine on top of the baked texture.

**Animations**: four Blender actions, exported as glTF animations and played by an `AnimationMixer` when the game says so:

- `Awaken_1`, `Awaken_2`, `Awaken_3`: placing a light in its socket plays its ring's action: the ring rises from the floor, turns one and a half times and settles, tilted, above the dais. Afterwards the code turns the rings' parent (`Dais_Rings`) slowly, faster with every light
- `Finale`: placing the third light plays it: the final archway grinds up out of the dais, shaking. When it ends (the mixer's `finished` event), its doorway opens

Each action plays once and holds its last frame (`LoopOnce`, `clampWhenFinished`). The glowing parts (studs, socket rings) get their world's color in code, and brighten when their light is home.

## Breaking things

Urns, crystals and stones shatter when they fly into something hard enough: a sudden change in velocity between two frames (stopping, or bouncing off), while they were moving fast. Bumping into them while walking doesn't break them. The pieces are small Rapier bodies that bounce around and shrink away, and the prop grows back at its place a few seconds later. Urns and crystals break easily, stones only when thrown hard.

## The edge

Near the edge of the island the view darkens at its sides and the wind picks up. Fall off and the void closes in, then sends you back to the dais.

## Sound

All sound is made in code with the Web Audio API (`js/audio.js`), no sound files:

- Music: a slow pad in A minor with bells on top. More bells with every light home, a brighter sound inside the worlds, and a resolving chord progression at the end
- Every doorway hums in its world's pitch, from where the archway stands (Three.js `AudioListener` + `PositionalAudio`), louder when the world is energized
- Effects: footsteps, landing, picking up, throwing, knocks and shattering (from where it happens), dial clicks, a chime when a world is tuned, doorway whooshes, bells and stone rumbling at the sockets, wind at the edge, rain at the end

## Lighting

- Cold moonlight with soft shadows as the key light, little flat ambient light, purple light from the void below, and each doorway lighting its surroundings in its world's color
- The void is a gradient (purple glow below, black above); the fog has the horizon's color
- Post-processing (`RenderPipeline`): bloom on everything bright (crystals, gems, doorways), then Neutral tone mapping
- The shader worlds are clamped at 1, like Shadertoy's canvas, which keeps their original look and stops very bright shaders from blowing up the bloom
- Stone gets color variation from 3D noise (TSL `mx_fractal_noise_float`) and darkens towards the floor

## Run locally

```sh
npm install
npm run dev
```

Needs a browser with WebGPU (recent Chrome, Edge or Safari on desktop).

## Built with

- [Three.js](https://threejs.org) `WebGPURenderer`, TSL / WGSL
- [Rapier](https://rapier.rs) physics (`@dimforge/rapier3d-compat`)
- [Vite](https://vite.dev)
