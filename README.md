# CRT TV

A Shadertoy shader ported to WebGPU (WGSL), playing on an old CRT television in a Three.js scene rendered with `WebGPURenderer`.

Live: _TODO: add the deployed URL_

## Original shaders

The TV has four channels, switched with the channel knob:

1. Star Nest by Kali (Pablo Roman Andrioli): https://www.shadertoy.com/view/XlfGRj
2. Seascape by Alexander Alekseev (TDM): https://www.shadertoy.com/view/Ms2SD1 (ported from the 2014 version)
3. Creation by Silexars (Danilo Guanabara): https://www.shadertoy.com/view/XsXXDn (changed: the center follows the mouse)
4. Color bars test card: own shader

On the window:

- Heartfelt by Martijn Steinrucken (BigWings): https://www.shadertoy.com/view/ltffzl (the version without the heart; the photo it blurs behind the glass is replaced by our own procedural night street)

The CRT layer (barrel distortion, scanlines, chromatic aberration, noise, static) is written from scratch in `js/shaders/crt/fragment.wgsl`.

## Interaction

- Drag on the TV screen to control the channel (raycast → screen UV → `iMouse`): steer through the stars, move along the sea, move the center of Creation, shift the hue of the color bars
- Click the channel knob to switch channel (burst of static)
- The rain on the window comes and goes by itself; lightning in the shader also lights up the room
- Drag anywhere else to orbit around the TV
- `G` triggers a glitch (temporary, until physics hits drive it)

## How it works

1. The current channel shader renders into a 320×240 render target.
2. The CRT shader samples that render target as `iChannel0` on the TV screen mesh.

Both shaders are WGSL functions loaded with `wgslFn` from Three.js TSL.

## Run locally

```sh
npm install
npm run dev
```

Needs a browser with WebGPU (recent Chrome, Edge or Safari).

## Built with

- [Three.js](https://threejs.org) `WebGPURenderer`, TSL / WGSL
- [Vite](https://vite.dev)
