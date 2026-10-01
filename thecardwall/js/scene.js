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
const MAX_PIXEL_RATIO = 3; // full sharpness on 3x phones
const CLEAR_MATERIALS = new Set(['Slab_Clear', 'Slab_Edge']);

// Clear acrylic without a refraction pass: the card and label render directly
// (full texture sharpness) and an additive layer draws only the plastic's
// reflections on top. The case edges also get a faint frosted tint.
const PLASTIC = {
  Slab_Clear: { tint: 0, roughness: 0.03, gloss: 0.5 },
  Slab_Edge: { tint: 0.22, roughness: 0.3, gloss: 0.8 },
};
// Printed surfaces are lit so a card facing the viewer shows the artwork's
// own colours (calibrated against the template and label files).
const PRINTED_MATERIALS = new Set(['Card_Front', 'Card_Back', 'Label_Front', 'Label_Back']);
const PRINT_LIGHT = 0.72;
// The holder's through-holes are wider than the inserts (model units: m).
const INSERT_GAPS = [
  { name: 'Card', gap: 0.0005, radius: 0.001 },
  { name: 'Label', gap: 0.00025, radius: 0.0004 },
];

function plasticLayers(name) {
  const spec = PLASTIC[name];
  const tint = spec.tint > 0 ? new THREE.MeshBasicMaterial({
    name: `${name}_Tint`, color: 0xdfe6ec, transparent: true, opacity: spec.tint,
    depthWrite: false, side: THREE.DoubleSide,
  }) : null;
  // Black base, so only the reflection is drawn; specularIntensity sets its
  // strength (independent of the WebGL context, so the MP4 renderer matches).
  const gloss = new THREE.MeshPhysicalMaterial({
    name: `${name}_Gloss`, color: 0x000000, metalness: 0, roughness: spec.roughness,
    ior: 1.49, specularIntensity: spec.gloss, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  return { tint, gloss };
}

function roundedRect(path, hw, hh, r) {
  path.moveTo(-hw + r, -hh);
  path.lineTo(hw - r, -hh);
  path.quadraticCurveTo(hw, -hh, hw, -hh + r);
  path.lineTo(hw, hh - r);
  path.quadraticCurveTo(hw, hh, hw - r, hh);
  path.lineTo(-hw + r, hh);
  path.quadraticCurveTo(-hw, hh, -hw, hh - r);
  path.lineTo(-hw, -hh + r);
  path.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return path;
}

/** The same surface facing the other way (reversed winding and normals). */
function flippedGeometry(geometry) {
  const flipped = geometry.clone();
  const index = flipped.index;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  const normal = flipped.attributes.normal;
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  return flipped;
}

/**
 * A flat frosted ring in the gap between an insert (card or label) and the
 * holder's through-hole, at the insert's mid-plane. Without the blur of a
 * refraction pass, that gap would read as a dark outline; on a real slab the
 * frosted sleeve fills it.
 */
function gapRing(insert, { gap, radius }, material) {
  const box = new THREE.Box3().setFromObject(insert);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const overlap = 0.0002; // tuck both edges under the insert and the holder
  const shape = roundedRect(new THREE.Shape(), size.x / 2 + gap + overlap, size.y / 2 + gap + overlap, radius + gap + overlap);
  shape.holes.push(roundedRect(new THREE.Path(), size.x / 2 - overlap, size.y / 2 - overlap, Math.max(radius - overlap, 0.0001)));
  const geometry = new THREE.ShapeGeometry(shape, 6);
  const uv = geometry.attributes.uv; // holder frost repeats every 10 mm
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 100, uv.getY(i) * 100);
  geometry.translate(center.x, center.y, center.z);
  const ring = new THREE.Mesh(geometry, material);
  ring.name = `${insert.name}_GapFill`;
  ring.userData.gapFill = true;
  return ring;
}

export class SlabScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
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
    const clearMeshes = [];
    this.slab.traverse((object) => {
      if (!object.isMesh) return;
      const material = object.material;
      if (material?.name) this.materials.set(material.name, material);
      if (CLEAR_MATERIALS.has(material?.name)) clearMeshes.push(object);
      if (PRINTED_MATERIALS.has(material?.name)) material.color.setScalar(PRINT_LIGHT);
      // Seen sharply now (no refraction blur), so the frost is a touch softer.
      if (material?.name === 'Holder_Frosted') material.normalScale.setScalar(0.8);
    });
    const layers = new Map([...CLEAR_MATERIALS].map((name) => [name, plasticLayers(name)]));
    for (const mesh of clearMeshes) {
      const name = mesh.material.name;
      const { tint, gloss } = layers.get(name);
      mesh.userData.clearMaterial = name;
      mesh.material = gloss;
      mesh.renderOrder = 3;
      if (tint) {
        const haze = new THREE.Mesh(mesh.geometry, tint);
        haze.name = `${mesh.name}_Tint`;
        haze.userData.tintLayer = true;
        haze.renderOrder = 2;
        mesh.add(haze);
      }
    }
    const frost = this.materials.get('Holder_Frosted')?.clone();
    if (frost) {
      frost.side = THREE.DoubleSide;
      for (const spec of INSERT_GAPS) {
        const insert = this.slab.getObjectByName(spec.name);
        if (insert) this.slab.add(gapRing(insert, spec, frost));
      }
    }
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
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      texture.userData.mimeType = 'image/jpeg';
      this.textures.set(materialName, texture);
      material.map = texture;
      material.color?.setScalar(PRINTED_MATERIALS.has(materialName) ? PRINT_LIGHT : 1);
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
    // AR formats have no additive blending: the plastic gets a plain
    // translucent material instead of the reflection (and tint) layers.
    const tintLayers = [];
    const gapFills = [];
    const printed = new Map();
    slab.traverse((object) => {
      if (!object.isMesh) return;
      if (object.userData.tintLayer) {
        tintLayers.push(object);
        return;
      }
      if (object.userData.gapFill) {
        gapFills.push(object);
        return;
      }
      // AR has its own lighting: printed surfaces keep their full albedo.
      const printName = object.material?.name;
      if (PRINTED_MATERIALS.has(printName)) {
        if (!printed.has(printName)) {
          const material = object.material.clone();
          material.color.setScalar(1);
          printed.set(printName, material);
        }
        object.material = printed.get(printName);
      }
      const name = object.userData.clearMaterial;
      if (name) object.material = name === 'Slab_Edge' ? edge : clear;
      object.renderOrder = name ? 2 : 0;
    });
    tintLayers.forEach((object) => object.removeFromParent());
    // USDZ has no double-sided materials: give each gap ring a back face.
    if (gapFills.length) {
      const frost = gapFills[0].material.clone();
      frost.side = THREE.FrontSide;
      for (const ring of gapFills) {
        ring.material = frost;
        ring.add(new THREE.Mesh(flippedGeometry(ring.geometry), frost));
      }
    }
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
