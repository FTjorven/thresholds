# Thresholds

A first-person walk through Shadertoy worlds, built with Three.js `WebGPURenderer` and WGSL.

You stand on a floating ruin in a void. Its stone archways are doorways into other worlds: each one is a Shadertoy shader, ported to WGSL. The shader doesn't sit on the doorway as a flat picture. It gets the real ray from your eye, so the world behind the doorway has depth and shifts as you move.

Live: _TODO: add the deployed URL_

## Original shaders

One world behind each archway. For each shader, `fragment.wgsl` is the straight port and `world.wgsl` the version that takes its ray from the 3D scene:

- Star Nest by Kali (Pablo Roman Andrioli): https://www.shadertoy.com/view/XlfGRj: a nebula to float through
- Seascape by Alexander Alekseev (TDM): https://www.shadertoy.com/view/Ms2SD1 (ported from the 2014 version): an open sea to skim over. The world version includes the straight port and reuses all its functions
- Creation by Silexars (Danilo Guanabara): https://www.shadertoy.com/view/XsXXDn: the 2D original becomes a giant pulsing light far away, mapped onto the directions around you (stereographic projection). Fly towards it and it grows around you

Ported, not used yet:

- Heartfelt by Martijn Steinrucken (BigWings): https://www.shadertoy.com/view/ltffzl

## Controls

- Click to enter (locks the mouse)
- Mouse: look around
- WASD / arrow keys: walk, Shift: run, Space: jump
- Click / E: pick up, throw, turn a dial (look at it, the crosshair turns into a ring)
- Walk through an archway to enter its world. Inside you're weightless: fly where you look, Space to rise, Shift to go faster. The archway leads back.
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
