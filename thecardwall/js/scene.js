// Three.js stage for the slab: interactive viewer (slow turntable, orbit and
// zoom), deterministic turntable frames for the MP4 export, and the flat,
// AR-ready copy of the slab used for Quick Look / WebXR.

import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/addons/controls/OrbitControls.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';

export { THREE };

const SLAB_SIZE = { width: 0.08, height: 0.1355, depth: 0.006 }; // metres
const AUTO_ROTATE_SECONDS = 14; // one slow turn while idle
const RESUME_DELAY_MS = 2500;
const VIEW_BACKGROUND = 0x050607;
const CLEAR_MATERIALS = new Set(['Slab_Clear', 'Slab_Edge']);

export class SlabScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.className = 'stage-canvas';
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(VIEW_BACKGROUND);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 10);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.82;

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.materials = new Map();
    this.textures = new Map();
    this.insets = { top: 0, bottom: 0 };
    this.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.interacting = false;
    this.resumeAt = 0;
    this.clock = new THREE.Clock();
    this.running = false;
    this.held = false; // paused while a full-screen dialog covers the stage
    this.onFrame = null;

    this.controls.addEventListener('start', () => {
      this.interacting = true;
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.resumeAt = performance.now() + RESUME_DELAY_MS;
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.ready && !this.held) this.start();
    });
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.slab = gltf.scene;
    this.slab.traverse((object) => {
      if (!object.isMesh) return;
      const material = object.material;
      if (material?.name) this.materials.set(material.name, material);
    });
    this.turntable.add(this.slab);
    this.ready = true;
    this.resize();
    this.frameCamera(true);
    return this;
  }

  /** Assign a canvas or image to a named material's base colour. */
  setMaterialImage(materialName, image) {
    const material = this.materials.get(materialName);
    if (!material) throw new Error(`Missing material ${materialName}`);
    let texture = this.textures.get(materialName);
    if (!texture || texture.image !== image) {
      texture?.dispose();
      texture = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
      texture.flipY = false; // glTF UV convention
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      texture.userData.mimeType = 'image/jpeg';
      this.textures.set(materialName, texture);
      material.map = texture;
      material.color?.setRGB(1, 1, 1);
      material.needsUpdate = true;
    }
    texture.needsUpdate = true;
    this.requestRender();
  }

  /** Reserve screen space for the HUD so the slab frames between the bars. */
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    this.frameCamera(false);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frameCamera(false);
    this.requestRender();
  }

  frameCamera(resetPosition) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const usable = Math.max(120, h - this.insets.top - this.insets.bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Fit the slab's height into ~78% of the usable band and its width into
    // ~82% of the screen width, whichever needs the camera further away.
    const byHeight = (SLAB_SIZE.height * (h / (usable * 0.78))) / (2 * tan);
    const byWidth = (SLAB_SIZE.width * (w / (w * 0.82))) / (2 * tan * this.camera.aspect);
    const distance = Math.max(byHeight, byWidth);
    this.fitDistance = distance;
    this.controls.minDistance = distance * 0.42;
    this.controls.maxDistance = distance * 1.9;
    // Shift the projection so the slab centres in the band between the bars.
    const shift = (this.insets.top + usable / 2) - h / 2;
    this.camera.setViewOffset(w, h, 0, -shift, w, h);
    if (resetPosition || !this.positioned) {
      const elevation = THREE.MathUtils.degToRad(4);
      this.camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
      this.controls.target.set(0, 0, 0);
      this.positioned = true;
    } else {
      // Keep the user's angle but respect the new zoom limits.
      const offset = this.camera.position.clone().sub(this.controls.target);
      const clamped = THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.copy(this.controls.target).add(offset.setLength(clamped));
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const tick = () => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      if (this.autoRotate && !this.interacting && performance.now() >= this.resumeAt) {
        this.turntable.rotation.y = (this.turntable.rotation.y + (dt * Math.PI * 2) / AUTO_ROTATE_SECONDS) % (Math.PI * 2);
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.();
    };
    tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Pause rendering while the stage is covered (frees the GPU for exports). */
  hold(on) {
    this.held = on;
    if (on) this.stop();
    else if (this.ready && !document.hidden) this.start();
  }

  requestRender() {
    if (!this.running && this.ready) this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ MP4 frames
  /**
   * A separate square renderer for the MP4: same slab (shared geometry and
   * textures), same lighting, pure black background, fixed camera. The live
   * viewer keeps running while it works.
   */
  createExportSession(size) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = this.renderer.toneMapping;
    renderer.toneMappingExposure = this.renderer.toneMappingExposure;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const turntable = new THREE.Group();
    turntable.add(this.slab.clone(true));
    scene.add(turntable);
    const fov = 24;
    const distance = (SLAB_SIZE.height / 0.8) / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    const elevation = THREE.MathUtils.degToRad(4);
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10);
    camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.lookAt(0, 0, 0);
    return {
      canvas: renderer.domElement,
      /** Render one frame; `phase` in [0, 1) maps to one full turn. */
      render(phase) {
        turntable.rotation.y = phase * Math.PI * 2;
        renderer.render(scene, camera);
        return renderer.domElement;
      },
      dispose() {
        scene.environment?.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  }

  // ------------------------------------------------------------- AR model
  /**
   * A copy of the slab lying flat, face up, resting on y = 0, with the
   * glass swapped for a translucent plastic (camera passthrough and Quick
   * Look cannot show refraction).
   */
  buildArModel() {
    const clear = new THREE.MeshStandardMaterial({
      name: 'Slab_Clear_AR', color: 0xffffff, roughness: 0.06, metalness: 0,
      transparent: true, opacity: 0.2, depthWrite: false,
    });
    const edge = new THREE.MeshStandardMaterial({
      name: 'Slab_Edge_AR', color: 0xffffff, roughness: 0.28, metalness: 0,
      transparent: true, opacity: 0.32, depthWrite: false,
    });
    const slab = this.slab.clone(true);
    slab.traverse((object) => {
      if (!object.isMesh) return;
      const name = object.material?.name;
      if (CLEAR_MATERIALS.has(name)) object.material = name === 'Slab_Edge' ? edge : clear;
      object.renderOrder = CLEAR_MATERIALS.has(name) ? 2 : 0;
    });
    slab.rotation.set(-Math.PI / 2, 0, 0);
    const root = new THREE.Group();
    root.name = 'TheCardWallSlab';
    root.add(slab);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(slab);
    slab.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    root.updateMatrixWorld(true);
    return root;
  }
}
