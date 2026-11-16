import * as THREE from "three";
import type { RuntimeExhibition } from "../../exhibition/runtime";

/**
 * 由运行时展览构建三维场景：展厅尺寸、作品位置/尺寸/画面全部来自
 * 当前展览数据。展览切换时整体 dispose 并重建 —— 场景内不存在
 * 跨展览共享的资源引用。
 */
export function buildScene(runtime: RuntimeExhibition) {
  const { width, depth } = runtime.space;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d7d5ce");
  scene.fog = new THREE.Fog("#d7d5ce", 14, 32);
  scene.add(new THREE.HemisphereLight("#fff8e8", "#74675a", 2.2));
  const sun = new THREE.DirectionalLight("#fff2d7", 3);
  sun.position.set(3, 9, 4);
  scene.add(sun);
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };
  box(width, 0.15, depth, 0, -0.08, 0, "#b4b0a7");
  box(0.3, 5.8, depth, -width / 2, 2.9, 0, "#e2ded4");
  box(0.3, 5.8, depth, width / 2, 2.9, 0, "#e2ded4");
  box(width, 5.8, 0.3, 0, 2.9, -depth / 2, "#d7d5cb");
  box(width, 5.8, 0.3, 0, 2.9, depth / 2, "#e2ded4");
  for (let z = -depth / 2; z <= depth / 2; z += 2) {
    box(width, 0.012, 0.018, 0, 0.01, z, "#9d9b93");
  }
  for (let x = -width / 2; x <= width / 2; x += 2)
    box(0.018, 0.012, depth, x, 0.01, 0, "#9d9b93");
  for (let z = -5; z <= 5; z += 5) {
    box(width - 2, 0.16, 0.2, 0, 5.1, z, "#b7b4aa");
    box(width - 5, 0.03, 0.12, 0, 5, z, "#fff6d9");
  }
  box(1.8, 0.7, 1.5, 0, 0.35, -0.3, "#d3cfc4");
  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.65, 0.14, 100, 16),
    new THREE.MeshStandardMaterial({
      color: "#81765f",
      metalness: 0.72,
      roughness: 0.25,
    }),
  );
  sculpture.position.set(0, 1.7, -0.3);
  scene.add(sculpture);
  const frames: THREE.Mesh[] = [];
  for (const a of runtime.artworks) {
    const group = new THREE.Group();
    group.position.set(a.position.x, 2.45, a.position.z);
    group.rotation.y = a.facing;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(a.size.w + 0.17, a.size.h + 0.17, 0.12),
      new THREE.MeshStandardMaterial({ color: "#423e35" }),
    );
    group.add(frame);
    const texture = new THREE.CanvasTexture(a.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(a.size.w, a.size.h),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    image.position.z = 0.07;
    image.userData.artworkId = a.id;
    group.add(image);
    frames.push(image);
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.13),
      new THREE.MeshBasicMaterial({ color: "#f2eee3" }),
    );
    plaque.position.set(a.size.w / 2 - 0.45, -a.size.h / 2 - 0.21, 0.08);
    group.add(plaque);
    scene.add(group);
  }
  return { scene, frames, sculpture };
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m))
          if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    }
  });
}
