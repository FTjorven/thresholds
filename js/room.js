import * as THREE from 'three/webgpu';

// Placeholder room built from primitives, in meters, floor at y = 0.
// Mesh names match the names to use in Blender, so the GLB can replace this 1:1.
// Interactables are tagged with userData.interactable (not wired up yet, see NOTES.md).

const mat = (color, roughness = 0.7, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

const box = (name, w, h, d, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
};

const tag = (object, interactable) => {
  object.userData.interactable = interactable;
  return object;
};

export const buildRoom = (screenMaterial) => {
  const room = new THREE.Group();
  room.name = 'Room';

  const wood = mat(0x7a5236, 0.6);
  const darkWood = mat(0x4a3020, 0.6);
  const blackPlastic = mat(0x1c1c1c, 0.4);
  const metal = mat(0xb8b8b8, 0.3, { metalness: 0.8 });
  const paper = mat(0xeeeae0, 0.9);

  // --- shell: floor, three walls (front open), single-sided so the camera can look in from outside ---

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4), mat(0x5a4636, 0.8));
  floor.name = 'Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 0.4;
  room.add(floor);

  const wallMaterial = mat(0x8c7a5b, 0.9);
  const walls = [
    { name: 'Wall_Back', w: 4.5, pos: [0, 1.3, -1.6], rotY: 0 },
    { name: 'Wall_Left', w: 4, pos: [-2.25, 1.3, 0.4], rotY: Math.PI / 2 },
    { name: 'Wall_Right', w: 4, pos: [2.25, 1.3, 0.4], rotY: -Math.PI / 2 },
  ];
  for (const { name, w, pos, rotY } of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.6), wallMaterial);
    wall.name = name;
    wall.position.set(...pos);
    wall.rotation.y = rotY;
    room.add(wall);
  }

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), mat(0x7c2f2a, 1));
  rug.name = 'Rug';
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.002, 0.3);
  room.add(rug);

  // --- TV cabinet (open front, VCR + tapes on the bottom shelf) ---

  const cabinet = new THREE.Group();
  cabinet.name = 'TV_Cabinet';
  cabinet.position.set(0, 0, -1.3);
  cabinet.add(
    box('TV_Cabinet_Top', 1.2, 0.03, 0.45, wood, 0, 0.485, 0),
    box('TV_Cabinet_Bottom', 1.2, 0.03, 0.45, wood, 0, 0.05, 0),
    box('TV_Cabinet_Left', 0.03, 0.5, 0.45, wood, -0.585, 0.25, 0),
    box('TV_Cabinet_Right', 0.03, 0.5, 0.45, wood, 0.585, 0.25, 0),
    box('TV_Cabinet_Back', 1.2, 0.5, 0.02, darkWood, 0, 0.25, -0.215)
  );
  room.add(cabinet);

  const vcr = tag(box('VCR', 0.42, 0.09, 0.3, blackPlastic, -0.2, 0.11, 0.02), 'vcr');
  const vcrDisplay = box('VCR_Display', 0.08, 0.02, 0.002, mat(0x000000, 1, { emissive: 0x33ff66 }), 0.12, 0.01, 0.151);
  const vcrSlot = box('VCR_Slot', 0.2, 0.025, 0.002, mat(0x050505, 1), -0.06, 0.01, 0.151);
  vcr.add(vcrDisplay, vcrSlot);
  cabinet.add(vcr);

  const tapeColors = [0x222222, 0x2b2b44, 0x442222];
  tapeColors.forEach((color, i) => {
    const tape = tag(box(`Tape_${i + 1}`, 0.19, 0.025, 0.105, mat(color, 0.5), 0.3, 0.078 + i * 0.026, 0.05), 'tape');
    tape.rotation.y = (i - 1) * 0.15;
    const label = box(`Tape_${i + 1}_Label`, 0.12, 0.016, 0.002, paper, 0, 0, 0.053);
    tape.add(label);
    cabinet.add(tape);
  });

  // --- TV, origin at the bottom center of the case ---

  const tv = new THREE.Group();
  tv.name = 'TV';
  tv.position.set(-0.1, 0.5, -1.3);
  room.add(tv);

  tv.add(box('TV_Case', 0.7, 0.55, 0.5, mat(0x6b4a2f, 0.5), 0, 0.275, 0));
  tv.add(box('TV_Bezel', 0.48, 0.37, 0.002, blackPlastic, -0.08, 0.29, 0.251));

  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), screenMaterial);
  tvScreen.name = 'TV_Screen';
  tvScreen.position.set(-0.08, 0.29, 0.253);
  tv.add(tvScreen);

  const knobGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 24);
  const knob = tag(new THREE.Mesh(knobGeometry, blackPlastic), 'channelKnob');
  knob.name = 'TV_Knob';
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.25, 0.4, 0.265);
  knob.add(box('TV_Knob_Marker', 0.008, 0.032, 0.03, metal, 0, 0, -0.025)); // shows the knob turning
  tv.add(knob);

  const volumeKnob = tag(new THREE.Mesh(knobGeometry, blackPlastic), 'volumeKnob');
  volumeKnob.name = 'TV_VolumeKnob';
  volumeKnob.rotation.x = Math.PI / 2;
  volumeKnob.position.set(0.25, 0.28, 0.265);
  tv.add(volumeKnob);

  tv.add(box('TV_Speaker', 0.12, 0.1, 0.002, mat(0x2a2018, 1), 0.25, 0.12, 0.251));

  // rabbit-ear antenna on top
  const antenna = tag(new THREE.Group(), 'antenna');
  antenna.name = 'TV_Antenna';
  antenna.position.set(0, 0.55, -0.05);
  const antennaBase = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), blackPlastic);
  antennaBase.name = 'TV_Antenna_Base';
  antenna.add(antennaBase);
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.name = side < 0 ? 'TV_Antenna_Left' : 'TV_Antenna_Right';
    ear.rotation.z = side * 0.5;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.45, 8), metal);
    rod.position.y = 0.225;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), metal);
    tip.position.y = 0.45;
    ear.add(rod, tip);
    antenna.add(ear);
  }
  tv.add(antenna);

  // --- coffee table with throwables ---

  const table = new THREE.Group();
  table.name = 'CoffeeTable';
  table.position.set(0, 0, 0.5);
  table.add(box('CoffeeTable_Top', 1.0, 0.04, 0.55, wood, 0, 0.42, 0));
  for (const [x, z] of [[-0.45, -0.22], [0.45, -0.22], [-0.45, 0.22], [0.45, 0.22]]) {
    table.add(box('CoffeeTable_Leg', 0.04, 0.4, 0.04, darkWood, x, 0.2, z));
  }
  room.add(table);

  const remote = tag(box('Remote', 0.05, 0.02, 0.17, blackPlastic, -0.25, 0.45, 0.5), 'remote');
  remote.rotation.y = 0.3;
  const powerButton = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 12), mat(0xcc2222, 0.4));
  powerButton.name = 'Remote_Power';
  powerButton.position.set(0, 0.011, -0.06);
  remote.add(powerButton);
  for (let i = 0; i < 6; i++) {
    const button = box('Remote_Button', 0.01, 0.005, 0.01, mat(0x666666, 0.5), (i % 2) * 0.018 - 0.009, 0.011, -0.02 + Math.floor(i / 2) * 0.025);
    remote.add(button);
  }
  room.add(remote);

  const sodaCan = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 20), mat(0xb3202a, 0.3, { metalness: 0.6 })), 'throwable');
  sodaCan.name = 'SodaCan';
  sodaCan.position.set(0.3, 0.5, 0.45);
  room.add(sodaCan);

  const paperBallGeometry = new THREE.IcosahedronGeometry(0.04, 1);
  const paperBall = (x, y, z) => {
    const ball = tag(new THREE.Mesh(paperBallGeometry, paper), 'throwable');
    ball.name = 'PaperBall';
    ball.position.set(x, y, z);
    ball.rotation.set(x * 10, y * 10, z * 10);
    return ball;
  };
  room.add(paperBall(0.1, 0.48, 0.65));

  // --- wastebasket full of paper balls (ammo) ---

  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.12, 0.3, 24, 1, true),
    mat(0x3a5a40, 0.6, { side: THREE.DoubleSide })
  );
  basket.name = 'Wastebasket';
  basket.position.set(1.1, 0.15, 0.3);
  room.add(basket);
  room.add(paperBall(1.06, 0.28, 0.28), paperBall(1.14, 0.29, 0.34), paperBall(1.1, 0.33, 0.26));

  // --- floor lamp (left corner), its light is the room's main light ---

  const lamp = tag(new THREE.Group(), 'lamp');
  lamp.name = 'FloorLamp';
  lamp.position.set(-1.6, 0, -1.1);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), metal);
  lampBase.position.y = 0.015;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), metal);
  pole.position.y = 0.75;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.22, 0.25, 24, 1, true),
    mat(0xf0e0c0, 0.9, { side: THREE.DoubleSide, emissive: 0x806040 })
  );
  shade.name = 'FloorLamp_Shade';
  shade.position.y = 1.55;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), mat(0xffffff, 1, { emissive: 0xffe0b0, emissiveIntensity: 2 }));
  bulb.position.y = 1.5;
  const lampLight = new THREE.PointLight(0xffc98a, 3.5, 0, 2);
  lampLight.position.y = 1.5;
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lampLight.shadow.bias = -0.002;
  lamp.add(lampBase, pole, shade, bulb, lampLight);
  room.add(lamp);

  // --- plant (right corner) ---

  const plant = tag(new THREE.Group(), 'plant');
  plant.name = 'Plant';
  plant.position.set(1.6, 0, -1.1);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.35, 20), mat(0xa0522d, 0.8));
  pot.name = 'Plant_Pot';
  pot.position.y = 0.175;
  plant.add(pot);
  const leafMaterial = mat(0x3f7a3a, 0.7);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 6), leafMaterial);
    const angle = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * 0.07, 0.6, Math.sin(angle) * 0.07);
    leaf.rotation.set(Math.sin(angle) * 0.4, 0, -Math.cos(angle) * 0.4);
    plant.add(leaf);
  }
  room.add(plant);

  // --- wall clock (back wall, left) ---

  const clock = tag(new THREE.Group(), 'clock');
  clock.name = 'Clock';
  clock.position.set(-1.2, 1.9, -1.58);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 32), mat(0xf4efe4, 0.6));
  face.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 8, 32), darkWood);
  const hourHand = box('Clock_HourHand', 0.012, 0.09, 0.005, blackPlastic, 0, 0.045, 0.02);
  const minuteHand = box('Clock_MinuteHand', 0.008, 0.14, 0.005, blackPlastic, 0, 0.07, 0.025);
  const hourPivot = new THREE.Group();
  hourPivot.name = 'Clock_HourPivot';
  hourPivot.add(hourHand);
  const minutePivot = new THREE.Group();
  minutePivot.name = 'Clock_MinutePivot';
  minutePivot.add(minuteHand);
  clock.add(face, rim, hourPivot, minutePivot);
  room.add(clock);

  // --- poster (back wall, right) ---

  const poster = tag(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.85), mat(0x2b4a6b, 0.9)), 'poster');
  poster.name = 'Poster';
  poster.position.set(1.1, 1.5, -1.595);
  room.add(poster);

  // --- light switch (left wall) ---

  const lightSwitch = tag(box('LightSwitch', 0.08, 0.12, 0.015, mat(0xf0ead8, 0.5), 0, 0, 0), 'lightSwitch');
  lightSwitch.position.set(-2.245, 1.1, -0.6);
  lightSwitch.rotation.y = Math.PI / 2;
  lightSwitch.add(box('LightSwitch_Toggle', 0.02, 0.04, 0.015, mat(0xe0d8c0, 0.5), 0, 0.01, 0.01));
  room.add(lightSwitch);

  // --- shadows: everything casts and receives, except the self-lit screen ---

  room.traverse((child) => {
    if (child.isMesh && child !== tvScreen) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  shade.castShadow = false; // the light sits inside it
  bulb.castShadow = false;

  const interactables = [];
  room.traverse((child) => {
    if (child.userData.interactable) interactables.push(child);
  });

  return { room, tv, tvScreen, knob, lampLight, clock: { hourPivot, minutePivot }, interactables };
};
