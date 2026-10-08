# CRT TV

A Shadertoy shader ported to WebGPU (WGSL), playing on an old CRT television in a Three.js scene rendered with `WebGPURenderer`.

Live: _TODO: add the deployed URL_

## Original shaders

- Star Nest by Kali (Pablo Roman Andrioli): https://www.shadertoy.com/view/XlfGRj

The CRT layer (barrel distortion, scanlines, chromatic aberration, noise, static) is written from scratch in `js/shaders/crt/fragment.wgsl`.

## Interaction

- Drag on the TV screen to steer the flight through the stars (raycast → screen UV → `iMouse`)
- Click the knob to switch channel (burst of static)
- Drag anywhere else to orbit around the TV
- `G` triggers a glitch (temporary, until physics hits drive it)

## How it works

1. The channel shader (Star Nest) renders into a 320×240 render target.
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
