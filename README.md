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
- Walk through an archway to enter its world. Inside you're weightless: fly where you look, Space to rise, Shift to go faster. The archway leads back.
- Esc: pause

## How it works

Every pixel of a doorway runs the shader with:

- `rayOrigin`: the point on the doorway this pixel shows (`positionWorld`)
- `rayDir`: the direction from the camera through that point (`positionWorld - cameraPosition`)

So walking around the doorway changes the rays, which is the user interaction that drives the shader.

Walking through the doorway puts you inside the world: a big sphere follows you, painted from the inside with the same shader, now with the rays starting at your eye. Looking back, the doorway shows the ruin: the ruin is rendered from your exact viewpoint into a texture, and the back of the doorway shows that texture at the same spot on screen (`screenUV`), so it lines up perfectly.

## Run locally

```sh
npm install
npm run dev
```

Needs a browser with WebGPU (recent Chrome, Edge or Safari on desktop).

## Built with

- [Three.js](https://threejs.org) `WebGPURenderer`, TSL / WGSL
- [Vite](https://vite.dev)
