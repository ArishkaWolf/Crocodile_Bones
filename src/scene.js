import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PALETTE = { green: '#229b16', blue: '#1461df', yellow: '#ffd000' };
const positions = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export class TableScene {
  constructor(container, onPick, onRollEnd) {
    this.container = container; this.onPick = onPick; this.onRollEnd = onRollEnd;
    this.dice = new Map(); this.selected = new Set(); this.hero = true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lastRoll = null; this.rollStart = 0; this.disposed = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 14, 12); this.camera.lookAt(0, 0, 0);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      container.classList.add('no-webgl'); this.available = false; return;
    }
    this.available = true;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight('#ffffff', 1.4));
    const key = new THREE.DirectionalLight('#fff6e1', 3);
    key.position.set(-5, 12, 6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 0.5, far: 40 });
    key.shadow.bias = -0.001; key.shadow.normalBias = 0.03;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#efe1cc', 1.1); rim.position.set(8, 6, -6); this.scene.add(rim);

    this.table = new THREE.Group(); this.scene.add(this.table);
    const wood = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/walnut.webp`);
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const edgeProfile = [[0,-.48],[7.12,-.48],[7.30,-.44],[7.43,-.33],[7.48,-.20],[7.45,-.06],[7.36,.10],[0,.10]].map(([r,y])=>new THREE.Vector2(r,y));
    const edge = new THREE.Mesh(new THREE.LatheGeometry(edgeProfile,128), new THREE.MeshStandardMaterial({ color: '#76503a', map:wood, roughness:.42, metalness:0 }));
    edge.scale.z = .66; edge.receiveShadow = true; edge.castShadow = true; this.table.add(edge);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(7.36,128), new THREE.MeshStandardMaterial({ color:'#c9d6d3',map:wood,roughness:.5,metalness:0 }));
    surface.rotation.x = -Math.PI/2; surface.scale.y = .66; surface.position.y = .105;
    surface.receiveShadow = true; this.table.add(surface);

    this.bodyGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.14);
    this.pipGeometry = new THREE.CircleGeometry(0.068, 12);
    this.pipMaterial = new THREE.MeshStandardMaterial({ color: '#17352b', roughness: 0.9, side: THREE.DoubleSide });
    this.bluePipMaterial = new THREE.MeshStandardMaterial({ color: '#fff7e6', roughness: 0.9, side: THREE.DoubleSide });
    this.materials = Object.fromEntries(Object.entries(PALETTE).map(([c, color]) => [c, new THREE.MeshStandardMaterial({ color, roughness: 0.26, metalness: 0.05 })]));
    this.raycaster = new THREE.Raycaster();
    this.pointerDown = event => { this.down = { x: event.clientX, y: event.clientY }; };
    this.pointerUp = event => {
      if (!this.interactive || !this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 12) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const pos = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.raycaster.setFromCamera(pos, this.camera);
      const hit = this.raycaster.intersectObjects([...this.dice.values()].map(d => d.body), false)[0];
      if (hit) this.onPick(hit.object.userData.id);
    };
    container.addEventListener('pointerdown', this.pointerDown); container.addEventListener('pointerup', this.pointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.resize(); this.setHero(); this.animate(performance.now());
  }

  resize() {
    if (!this.available) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    const resized = this.width !== width || this.height !== height;
    this.width=width; this.height=height;
    this.renderer.setSize(width, height); this.camera.aspect = width / height;
    const ratio = width / height;
    this.desktop = innerWidth >= 1000 && innerHeight >= 620;
    const baseDistance = this.hero ? 19.6 : 16.2;
    const distance = ratio < 1.45 ? baseDistance / ratio * 1.45 : baseDistance;
    this.camera.position.set(0, distance * (this.hero ? .76 : .82), distance * (this.hero ? .65 : .57));
    this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    if (resized && this.lastList) this.setDice(this.lastList,this.lastRoll,this.interactive,this.selected);
  }

  createDie(die) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeometry, this.materials[die.color]);
    body.castShadow = true; body.receiveShadow = true; body.userData.id = die.id; group.add(body);
    const faces = new THREE.Group(); group.add(faces);
    // Value is always on the upper face; other five sides form a proper die.
    const rest = [1, 2, 3, 4, 5, 6].filter(v => v !== die.value && v !== 7 - die.value);
    const side = rest.find(v => v !== rest[0] && v !== 7 - rest[0]);
    const values = [die.value, 7 - die.value, rest[0], 7 - rest[0], side, 7 - side];
    const transforms = [
      [[0, 0.502, 0], [-Math.PI / 2, 0, 0]], [[0, -0.502, 0], [Math.PI / 2, 0, 0]],
      [[0, 0, 0.502], [0, 0, 0]], [[0, 0, -0.502], [0, Math.PI, 0]],
      [[0.502, 0, 0], [0, Math.PI / 2, 0]], [[-0.502, 0, 0], [0, -Math.PI / 2, 0]],
    ];
    transforms.forEach(([p, r], i) => {
      const face = new THREE.Group(); face.position.set(...p); face.rotation.set(...r);
      for (const [x, y] of positions[values[i]]) { const pip = new THREE.Mesh(this.pipGeometry, die.color === 'blue' ? this.bluePipMaterial : this.pipMaterial); pip.position.set(x * 0.25, y * 0.25, 0); face.add(pip); }
      faces.add(face);
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.77, 40), new THREE.MeshBasicMaterial({ color: '#e1f8aa', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.43; halo.visible = false; group.add(halo);
    this.scene.add(group);
    return { group, body, halo, value: die.value, color: die.color, target: new THREE.Vector3(), yaw: 0, leaving: false };
  }

  removeDie(id) { const d = this.dice.get(id); if (!d) return; this.scene.remove(d.group); d.halo.geometry.dispose(); this.dice.delete(id); }

  setHero() {
    this.hero = true;
    this.setDice([
      { id: 'hero1', color: 'green', value: 5 }, { id: 'hero2', color: 'yellow', value: 3 },
      { id: 'hero3', color: 'blue', value: 6 }, { id: 'hero4', color: 'green', value: 2 },
      { id: 'hero5', color: 'blue', value: 4 }, { id: 'hero6', color: 'yellow', value: 6 },
    ], 'hero', false);
  }

  setDice(list, rollId, interactive = false, selected = new Set()) {
    if (!this.available) return;
    this.lastList=list;
    this.interactive = interactive; this.selected = selected;
    const rolling = this.lastRoll !== rollId;
    this.lastRoll = rollId;
    if (rolling) { this.rollStart = performance.now(); this.rollNotified = false; }
    const ids = new Set(list.map(d => d.id));
    for (const id of this.dice.keys()) if (!ids.has(id)) this.removeDie(id);
    const columns = list.length <= 6 ? 3 : list.length <= 12 ? 4 : list.length <= 20 ? 6 : 7;
    const rows = Math.ceil(list.length / columns);
    const spacing = list.length > 20 ? 1.08 : list.length > 12 ? 1.25 : 1.6;
    const phoneOffset = !this.hero && innerHeight <= 450 && innerWidth > innerHeight
      ? Math.min(2,Math.max(0,3.7-(rows-1)*spacing/2)) : 0;
    list.forEach((die, i) => {
      let d = this.dice.get(die.id);
      if (d && (d.value !== die.value || d.color !== die.color)) { this.removeDie(die.id); d = null; }
      if (!d) { d = this.createDie(die); this.dice.set(die.id, d); }
      const col = i % columns, row = Math.floor(i / columns);
      const actualCols = Math.min(columns, list.length - row * columns);
      const jitter = Math.sin(i * 13.4) * 0.14;
      const scale = !this.hero ? list.length > 20 ? .86 : list.length > 12 ? 1 : 1.2 : 1;
      d.group.scale.setScalar(scale);
      d.target.set((col - (actualCols - 1) / 2) * spacing - (this.hero ? 0 : .7), 0.18 + scale / 2, (row - (rows - 1) / 2) * spacing + jitter + (this.hero ? 1.4 : phoneOffset));
      d.yaw = Math.sin(i * 2.6) * 0.28;
      d.halo.visible = selected.has(die.id);
      if (!rolling && d.group.position.lengthSq() === 0) d.group.position.copy(d.target);
    });
    this.container.style.cursor = interactive ? 'pointer' : 'default';
  }

  setGame() { this.hero = false; }

  setSelected(ids) { this.selected = new Set(ids); }

  settle() {
    this.rollStart = -1000000000; this.rollNotified = true;
    for (const [id,d] of this.dice) { d.group.position.copy(d.target); if (this.selected.has(id)) d.group.position.y += .25; d.group.rotation.set(0,d.yaw,0); }
  }

  dieScreenPosition(id) {
    const die = this.dice.get(id); if (!die || !this.available) return null;
    const p = die.group.position.clone().project(this.camera), rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, size: Math.max(28, Math.min(70, rect.height / 9)) };
  }

  animate(now) {
    if (this.disposed || !this.available) return;
    requestAnimationFrame(t => this.animate(t));
    if (document.hidden) return;
    const duration = this.reduced ? 120 : 3100;
    const stagger = this.reduced ? 0 : 24;
    const totalDuration = duration + Math.max(0,this.dice.size - 1) * stagger;
    const progress = Math.min((now - this.rollStart) / totalDuration, 1);
    const fov = !this.hero && !this.reduced && progress < 1 ? 38 - Math.sin(progress * Math.PI) * 2.5 : 38;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    for (const [id, d] of this.dice) {
      const i = [...this.dice.keys()].indexOf(id);
      const p = Math.max(0,Math.min((now - this.rollStart - i * stagger) / duration,1));
      if (p < 1) {
        const ease = 1 - (1 - p) ** 3;
        const settle = p > .72 ? Math.abs(Math.sin((p - .72) / .28 * Math.PI * 2)) * (1-p) * 1.2 : 0;
        d.group.position.set(d.target.x + Math.sin(i * 4.4) * (1 - ease) * 4, d.target.y + Math.sin(p * Math.PI) * (2 + (i%3)*.3) + settle, d.target.z + (1 - ease) * 3);
        const spin = (1 - ease) * Math.PI * 6;
        d.group.rotation.set(spin * (i % 2 ? -1 : 1), d.yaw + spin, spin * 0.8);
      } else {
        d.group.position.lerp(d.target.clone().add(new THREE.Vector3(0, this.selected.has(id) ? 0.25 : 0, 0)), 0.17);
        d.group.rotation.set(0, d.yaw, 0);
        if (this.hero && !this.reduced) { d.group.position.y += Math.sin(now * 0.0015 + i) * 0.045; }
      }
      d.halo.visible = this.selected.has(id);
      d.halo.material.opacity = .72 + Math.sin(now * .003) * .2;
    }
    if (progress === 1 && !this.rollNotified) { this.rollNotified = true; this.onRollEnd?.(); }
    this.renderer.render(this.scene, this.camera);
  }
}
