import * as THREE from 'three/webgpu';

// All sound is made in code with the Web Audio API: no sound files.
// - music: a slow pad (A minor) with bells on top; more bells with every light home, brighter inside a world
// - a hum from every open doorway, positioned at the archway (Three.js PositionalAudio), in its world's pitch
// - one-shot effects: pick up, throw, dial, breaking, doorways, sockets, rumbling, footsteps
// - wind that rises when you get near the edge or fall, rain at the end
// Browsers only allow sound after a click: start() is called from the start screen.

const hz = (semitones) => 440 * 2 ** (semitones / 12); // semitones from A4

// chords as semitones from A4, low and wide
const PROGRESSION = [
  [-24, -21, -17, -12], // Am
  [-28, -21, -16, -12], // F
  [-33, -21, -17, -14], // C
  [-26, -14, -10, -7], // G
];
const ENDING_PROGRESSION = [
  [-28, -21, -16, -12], // F
  [-26, -14, -10, -7], // G
  [-24, -20, -17, -12], // A major: home
];
const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 19]; // A minor pentatonic, for the bells
const CHORD_LENGTH = 8; // seconds

export const createAudio = ({ camera }) => {
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const ctx = listener.context;

  const master = ctx.createGain();
  master.connect(listener.getInput());
  const sfx = ctx.createGain();
  sfx.connect(master);
  const music = ctx.createGain();
  music.gain.value = 0.9;
  music.connect(master);

  // reverb: a convolver with a made up impulse (decaying noise), for the big empty void
  const reverb = ctx.createConvolver();
  const impulse = ctx.createBuffer(2, ctx.sampleRate * 3.5, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2.5;
  }
  reverb.buffer = impulse;
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.6;
  reverb.connect(reverbReturn).connect(master);

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  // --- building blocks ---

  // send a sound to a bus, dry + some reverb, optionally from a point in the scene
  const route = (node, { bus = sfx, wet = 0.25, at = null } = {}) => {
    let out = node;
    if (at) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.refDistance = 2;
      panner.rolloffFactor = 1.2;
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
      out = node.connect(panner);
    }
    out.connect(bus);
    const send = ctx.createGain();
    send.gain.value = wet;
    out.connect(send).connect(reverb);
  };

  // a quick rise and an exponential fall
  const envelope = (param, start, attack, peak, decay) => {
    param.setValueAtTime(0.0001, start);
    param.exponentialRampToValueAtTime(peak, start + attack);
    param.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  };

  const tone = ({ freq, type = 'sine', start = ctx.currentTime, attack = 0.005, decay = 0.3, gain = 0.2, glideTo, ...where }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + attack + decay);
    const amp = ctx.createGain();
    envelope(amp.gain, start, attack, gain, decay);
    osc.connect(amp);
    route(amp, where);
    osc.start(start);
    osc.stop(start + attack + decay + 0.05);
  };

  const noise = ({ filter = 'lowpass', freq = 1000, sweepTo, q = 1, start = ctx.currentTime, attack = 0.005, decay = 0.2, gain = 0.3, ...where }) => {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const shape = ctx.createBiquadFilter();
    shape.type = filter;
    shape.Q.value = q;
    shape.frequency.setValueAtTime(freq, start);
    if (sweepTo) shape.frequency.exponentialRampToValueAtTime(sweepTo, start + attack + decay);
    const amp = ctx.createGain();
    envelope(amp.gain, start, attack, gain, decay);
    source.connect(shape).connect(amp);
    route(amp, where);
    source.start(start, Math.random() * 1.5);
    source.stop(start + attack + decay + 0.05);
  };

  // a bell: a sine with two inharmonic partials, rings out long
  const bell = (freq, { start = ctx.currentTime, gain = 0.08, decay = 2.5, ...where } = {}) => {
    tone({ freq, start, decay, gain, ...where });
    tone({ freq: freq * 2.76, start, decay: decay * 0.5, gain: gain * 0.35, ...where });
    tone({ freq: freq * 5.4, start, decay: decay * 0.25, gain: gain * 0.15, ...where });
  };

  // a looping noise source through a filter, for wind and rain; returns its filter and volume
  const loop = (filterType, freq, q) => {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const shape = ctx.createBiquadFilter();
    shape.type = filterType;
    shape.frequency.value = freq;
    shape.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    source.connect(shape).connect(amp).connect(master);
    source.start();
    return { shape, amp };
  };

  // --- effects ---

  const effects = {
    pickUp: () => {
      tone({ freq: 520, glideTo: 780, attack: 0.01, decay: 0.15, gain: 0.12 });
      tone({ freq: 1560, attack: 0.01, decay: 0.2, gain: 0.03, start: ctx.currentTime + 0.05 });
    },
    throw: () => noise({ filter: 'bandpass', freq: 400, sweepTo: 1800, q: 1.5, attack: 0.03, decay: 0.25, gain: 0.35 }),
    dial: (index) => {
      noise({ freq: 2500, decay: 0.04, gain: 0.5, wet: 0.1 });
      tone({ freq: 110, type: 'triangle', decay: 0.12, gain: 0.25, wet: 0.1 });
      tone({ freq: hz([-5, -2, 0][index] ?? 0), attack: 0.02, decay: 0.8, gain: 0.05, wet: 0.5 });
    },
    tuned: () => [0, 7, 12].forEach((note, i) => bell(hz(note), { start: ctx.currentTime + i * 0.13, gain: 0.07, wet: 0.6 })),
    impact: (strength, at) =>
      noise({ freq: 700, decay: 0.07, gain: Math.min(0.05 + strength * 0.08, 0.4), at, wet: 0.15 }),
    shatter: (kind, at) => {
      if (kind === 'crystal') {
        for (let i = 0; i < 6; i++) {
          bell(1800 + Math.random() * 2600, { start: ctx.currentTime + Math.random() * 0.08, gain: 0.05, decay: 0.6, at, wet: 0.4 });
        }
        noise({ filter: 'highpass', freq: 3500, decay: 0.3, gain: 0.35, at });
      } else {
        noise({ freq: kind === 'urn' ? 1400 : 900, decay: 0.35, gain: 0.7, at });
        noise({ filter: 'bandpass', freq: 2600, q: 2, decay: 0.15, gain: 0.3, at });
        tone({ freq: 70, decay: 0.25, gain: 0.35, at, wet: 0.1 });
      }
    },
    doorway: (entering) => {
      noise({ filter: 'bandpass', freq: entering ? 200 : 3000, sweepTo: entering ? 3000 : 200, q: 2, attack: 0.1, decay: 0.9, gain: 0.4, wet: 0.6 });
      bell(hz(entering ? 12 : 7), { gain: 0.05, wet: 0.8 });
    },
    swallowed: (at) => noise({ filter: 'bandpass', freq: 1500, sweepTo: 150, q: 3, decay: 0.6, gain: 0.3, at, wet: 0.5 }),
    place: (index) => {
      const root = [0, 5, 7][index] ?? 0;
      [root - 12, root - 5, root, root + 7].forEach((note, i) => bell(hz(note), { start: ctx.currentTime + i * 0.08, gain: 0.08, decay: 4, wet: 0.7 }));
      tone({ freq: 55, attack: 0.05, decay: 3, gain: 0.3, wet: 0.3 });
    },
    // stone grinding: low noise swelling over a few seconds
    rumble: (seconds, gain = 0.5) => {
      noise({ freq: 160, attack: seconds * 0.3, decay: seconds * 0.7, gain, wet: 0.3 });
      noise({ filter: 'bandpass', freq: 600, q: 4, attack: seconds * 0.4, decay: seconds * 0.6, gain: gain * 0.25 });
      tone({ freq: 41, type: 'triangle', attack: seconds * 0.3, decay: seconds * 0.7, gain: gain * 0.6, wet: 0.1 });
    },
    opened: () => [-12, -5, 0, 4, 7, 12].forEach((note, i) => bell(hz(note), { start: ctx.currentTime + i * 0.15, gain: 0.07, decay: 5, wet: 0.8 })),
    footstep: () => {
      noise({ freq: 500 + Math.random() * 300, decay: 0.06, gain: 0.12, wet: 0.05 });
      tone({ freq: 75 + Math.random() * 15, decay: 0.05, gain: 0.08, wet: 0 });
    },
    land: () => {
      noise({ freq: 400, decay: 0.1, gain: 0.3, wet: 0.05 });
      tone({ freq: 60, decay: 0.1, gain: 0.25, wet: 0 });
    },
    respawn: () => {
      noise({ filter: 'bandpass', freq: 3000, sweepTo: 300, q: 2, attack: 0.2, decay: 1, gain: 0.3, wet: 0.8 });
      bell(hz(-12), { gain: 0.08, decay: 3, wet: 0.8 });
    },
  };

  // --- continuous sounds ---

  const wind = loop('bandpass', 400, 0.8);
  const rain = loop('highpass', 1200, 0.5);

  // a hum from an archway, heard from where it stands
  const hums = [];
  const addHum = (object, semitones, volume = 0.18) => {
    const hum = new THREE.PositionalAudio(listener);
    hum.setRefDistance(1.5);
    hum.setRolloffFactor(1.6);
    const mix = ctx.createGain();
    mix.gain.value = 0; // silent until start()
    const shape = ctx.createBiquadFilter();
    shape.type = 'lowpass';
    shape.frequency.value = 500;
    for (const [ratio, detune, type] of [[1, 0, 'sine'], [1.5, 4, 'sine'], [2, -6, 'triangle']]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(semitones) * ratio;
      osc.detune.value = detune;
      const amp = ctx.createGain();
      amp.gain.value = ratio === 1 ? 1 : 0.3;
      osc.connect(amp).connect(shape);
      osc.start();
    }
    shape.connect(mix);
    hum.setNodeSource(mix);
    object.add(hum);
    const entry = { hum, mix, volume, level: 1 };
    hums.push(entry);
    return entry;
  };

  // --- music ---

  const mood = { inside: false, lights: 0, ending: false };
  let started = false;
  let nextChord = 0;
  let chordIndex = 0;
  let drone = null;

  const playChord = (notes, start) => {
    const cutoff = mood.ending ? 2200 : mood.inside ? 1400 : 650 + mood.lights * 150;
    const shape = ctx.createBiquadFilter();
    shape.type = 'lowpass';
    shape.frequency.value = cutoff;
    route(shape, { bus: music, wet: 0.5 });
    const end = start + CHORD_LENGTH + 4;
    for (const note of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(note);
        osc.detune.value = detune;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, start);
        amp.gain.linearRampToValueAtTime(0.022, start + 3); // slow swell
        amp.gain.setValueAtTime(0.022, start + CHORD_LENGTH);
        amp.gain.linearRampToValueAtTime(0.0001, end); // overlaps the next chord
        osc.connect(amp).connect(shape);
        osc.start(start);
        osc.stop(end + 0.1);
      }
    }
  };

  // look a little ahead and schedule what's due: chords every few seconds, bells now and then
  const schedule = () => {
    const now = ctx.currentTime;
    if (now + 0.5 >= nextChord) {
      const progression = mood.ending ? ENDING_PROGRESSION : PROGRESSION;
      playChord(progression[chordIndex % progression.length], Math.max(nextChord, now));
      chordIndex++;
      nextChord = Math.max(nextChord, now) + CHORD_LENGTH;
    }
    const chance = 0.04 + mood.lights * 0.05 + (mood.inside ? 0.05 : 0) + (mood.ending ? 0.1 : 0);
    if (Math.random() < chance) {
      const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)] - (Math.random() < 0.4 ? 12 : 0);
      bell(hz(note), { start: now + Math.random() * 0.25, gain: 0.03 + Math.random() * 0.03, decay: 3, bus: music, wet: 0.9 });
    }
  };

  const start = () => {
    ctx.resume();
    if (started) return;
    started = true;
    nextChord = ctx.currentTime + 0.2;
    setInterval(schedule, 250);
    // a low drone under everything
    drone = ctx.createGain();
    drone.gain.setValueAtTime(0.0001, ctx.currentTime);
    drone.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    drone.connect(music);
    for (const freq of [55, 82.4]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(drone);
      osc.start();
    }
    for (const entry of hums) entry.mix.gain.setTargetAtTime(entry.volume, ctx.currentTime, 1);
  };

  let muted = false;
  const toggleMute = () => {
    muted = !muted;
    listener.setMasterVolume(muted ? 0 : 1);
    return muted;
  };

  // called every frame: wind (0..1), rain at the end, how loud each hum is
  const update = ({ inside, lights, ending, windAmount }) => {
    Object.assign(mood, { inside, lights, ending });
    if (!started) return;
    const t = ctx.currentTime;
    wind.amp.gain.setTargetAtTime(windAmount * 0.5, t, 0.2);
    wind.shape.frequency.setTargetAtTime(300 + windAmount * 900, t, 0.2);
    rain.amp.gain.setTargetAtTime(ending ? 0.12 : 0, t, 1);
    for (const entry of hums) entry.mix.gain.setTargetAtTime(entry.volume * entry.level, t, 0.3);
  };

  return { start, play: (name, ...args) => started && effects[name](...args), addHum, update, toggleMute };
};
