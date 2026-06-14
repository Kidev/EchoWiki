import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { useEchoUrl, resolveEchoPath } from "../../lib/echo";
import { getExt, getFileName } from "../assetUtils";

// Resolve an echo asset reference into a configured THREE.Texture. `flipY`
// follows the model's UV convention: glTF/GLB store UVs top-left (flipY=false),
// while OBJ/STL/PLY/FBX/Collada use the conventional bottom-left (flipY=true).
async function loadEchoTexture(
  loader: THREE.TextureLoader,
  ref: string,
  flipY: boolean,
): Promise<THREE.Texture | null> {
  const url = await resolveEchoPath(ref);
  if (!url) return null;
  const tex = await loader.loadAsync(url);
  tex.flipY = flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Apply textures to a loaded model graph and return the created THREE.Textures
// so the caller can dispose them. Two sources, in priority order:
//   1. `override`: an explicit echo path supplied by the author (?texture= on
//      the path, or the preview's texture field). Applied to every mesh
//      material, with the base color neutralised to white so the texture shows
//      faithfully. This is what lets a user texture a plain GLB/OBJ, or
//      retexture a model that resolved without one.
//   2. Otherwise, each material's own `userData.echoTex` reference: the pointer
//      Unity-extracted meshes carry to their separately-stored base-color
//      texture (geometry renders immediately; the texture pops in when ready).
async function applyEchoTextures(
  root: THREE.Object3D,
  override: string | undefined,
  flipY: boolean,
): Promise<THREE.Texture[]> {
  const loader = new THREE.TextureLoader();
  const byRef = new Map<string, Promise<THREE.Texture | null>>();

  const loadRef = (ref: string): Promise<THREE.Texture | null> => {
    let p = byRef.get(ref);
    if (!p) {
      p = loadEchoTexture(loader, ref, flipY);
      byRef.set(ref, p);
    }
    return p;
  };

  const tasks: Promise<void>[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const ref = override ?? (mat.userData?.["echoTex"] as string | undefined);
      if (!ref) continue;
      tasks.push(
        loadRef(ref).then((tex) => {
          if (!tex) return;
          const std = mat as THREE.MeshStandardMaterial;
          std.map = tex;
          // An explicit override replaces whatever the loader's default
          // material tinted the surface with, so clear the base color.
          if (override && std.color) std.color.set(0xffffff);
          std.needsUpdate = true;
        }),
      );
    }
  });

  await Promise.all(tasks);
  const out: THREE.Texture[] = [];
  for (const p of byRef.values()) {
    const tex = await p;
    if (tex) out.push(tex);
  }
  return out;
}

// Display options parsed from the echo path query string, e.g.
//   echo://3d/king.glb?autorotate&height=400px&bg=111&texture=img/king_diffuse.png
// Unknown keys are ignored by parseEditions (path resolution), so they are
// safe to carry on the same path and read here for presentation only.
type ModelOptions = {
  autorotate: boolean;
  width: string | undefined;
  height: string | undefined;
  bg: string | undefined;
  texture: string | undefined;
};

function parseModelOptions(path: string): ModelOptions {
  const opts: ModelOptions = {
    autorotate: false,
    width: undefined,
    height: undefined,
    bg: undefined,
    texture: undefined,
  };
  const qIdx = path.indexOf("?");
  if (qIdx === -1) return opts;
  for (const seg of path.slice(qIdx + 1).split("&")) {
    const eqIdx = seg.indexOf("=");
    const key = (eqIdx === -1 ? seg : seg.slice(0, eqIdx)).toLowerCase();
    // Markdown URL normalization percent-escapes a literal `%` in the link
    // destination (`width=50%` arrives as `width=50%25`), so decode the value
    // back before reading it: otherwise a `%` size is invalid CSS and the
    // viewer silently falls back to its full-width default.
    const rawVal = eqIdx === -1 ? "" : seg.slice(eqIdx + 1);
    let val = rawVal;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      // Malformed escape: keep the raw value rather than throwing.
    }
    if (key === "autorotate" || key === "spin") {
      opts.autorotate = !(
        val === "false" ||
        val === "0" ||
        val === "no" ||
        val === "off"
      );
    } else if (key === "width" || key === "w") {
      opts.width = val || undefined;
    } else if (key === "height" || key === "h") {
      opts.height = val || undefined;
    } else if (key === "bg") {
      opts.bg = val
        ? /^[0-9a-f]{3,8}$/i.test(val)
          ? `#${val}`
          : val
        : undefined;
    } else if (key === "texture" || key === "tex") {
      // The value is an echo asset path. Accept it with or without the
      // `echo://` scheme; resolveEchoPath works on the bare, scheme-less path.
      const t = val.startsWith("echo://") ? val.slice("echo://".length) : val;
      opts.texture = t || undefined;
    }
  }
  return opts;
}

// Lazily import only the loader needed for a given extension, returning the
// loaded scene/object graph. Geometry-only formats (STL, PLY) are wrapped in a
// mesh with a sensible default material.
async function loadModelObject(
  ext: string,
  url: string,
): Promise<THREE.Object3D> {
  const e = ext.replace(/^\./, "").toLowerCase();

  const standardMesh = (
    geometry: THREE.BufferGeometry,
    vertexColors: boolean,
  ): THREE.Object3D => {
    if (!geometry.attributes["normal"]) geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: vertexColors ? 0xffffff : 0xb0b4bd,
      vertexColors,
      metalness: 0.1,
      roughness: 0.75,
      flatShading: false,
    });
    return new THREE.Mesh(geometry, material);
  };

  switch (e) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );
      const gltf = await new GLTFLoader().loadAsync(url);
      return gltf.scene;
    }
    case "obj": {
      const { OBJLoader } = await import(
        "three/examples/jsm/loaders/OBJLoader.js"
      );
      return await new OBJLoader().loadAsync(url);
    }
    case "fbx": {
      const { FBXLoader } = await import(
        "three/examples/jsm/loaders/FBXLoader.js"
      );
      return await new FBXLoader().loadAsync(url);
    }
    case "dae": {
      const { ColladaLoader } = await import(
        "three/examples/jsm/loaders/ColladaLoader.js"
      );
      const collada = await new ColladaLoader().loadAsync(url);
      return collada.scene;
    }
    case "3mf": {
      const { ThreeMFLoader } = await import(
        "three/examples/jsm/loaders/3MFLoader.js"
      );
      return await new ThreeMFLoader().loadAsync(url);
    }
    case "stl": {
      const { STLLoader } = await import(
        "three/examples/jsm/loaders/STLLoader.js"
      );
      const geometry = await new STLLoader().loadAsync(url);
      return standardMesh(geometry, false);
    }
    case "ply": {
      const { PLYLoader } = await import(
        "three/examples/jsm/loaders/PLYLoader.js"
      );
      const geometry = await new PLYLoader().loadAsync(url);
      return standardMesh(geometry, Boolean(geometry.attributes["color"]));
    }
    default:
      throw new Error(`Unsupported 3D format: .${e}`);
  }
}

// Recursively free GPU resources held by an object graph.
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

function ModelCanvas({
  url,
  ext,
  autorotate,
  textureOverride,
}: {
  url: string;
  ext: string;
  autorotate: boolean;
  textureOverride: string | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [spin, setSpin] = useState(autorotate);
  const controlsRef = useRef<{ autoRotate: boolean } | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  // Mirrors `spin` so the (heavy) scene-building effect can read the latest
  // value for its initial setup without listing `spin` as a dependency, which
  // would otherwise tear down and rebuild the whole scene on every toggle.
  const spinRef = useRef(spin);
  spinRef.current = spin;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls:
      | import("three/examples/jsm/controls/OrbitControls.js").OrbitControls
      | null = null;
    let model: THREE.Object3D | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let textures: THREE.Texture[] = [];

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        // The extension comes from the echo path (passed in): a resolved blob
        // URL has no extension, so it can't be sniffed from `url`.
        const object = await loadModelObject(ext, url);
        if (cancelled) {
          disposeObject(object);
          return;
        }

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          50,
          width / height,
          0.01,
          100000,
        );

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(renderer.domElement);
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.touchAction = "none";
        renderer.domElement.style.cursor = "grab";

        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(3, 5, 4);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.8);
        fill.position.set(-4, 1, -3);
        scene.add(fill);

        // Center the model at the origin and frame the camera around it.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);
        scene.add(object);
        model = object;

        // Load referenced textures lazily; geometry is already on screen. The
        // running render loop picks up the material change once they resolve.
        // glTF/GLB carry top-left UVs (flipY=false); other formats use the
        // conventional bottom-left, so flip the override texture accordingly.
        const e = ext.replace(/^\./, "").toLowerCase();
        const texFlipY = !(e === "glb" || e === "gltf");
        void applyEchoTextures(object, textureOverride, texFlipY).then(
          (loaded) => {
            if (cancelled) {
              for (const t of loaded) t.dispose();
            } else {
              textures = loaded;
            }
          },
        );

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = (camera.fov * Math.PI) / 180;
        const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.7;
        camera.position.set(dist * 0.55, dist * 0.4, dist);
        camera.near = dist / 100;
        camera.far = dist * 100;
        camera.updateProjectionMatrix();

        const { OrbitControls } = await import(
          "three/examples/jsm/controls/OrbitControls.js"
        );
        if (cancelled) {
          disposeObject(object);
          renderer.dispose();
          renderer.domElement.remove();
          return;
        }
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.minDistance = dist * 0.25;
        controls.maxDistance = dist * 6;
        controls.autoRotate = spinRef.current;
        controls.autoRotateSpeed = 2.2;
        controls.target.set(0, 0, 0);
        controls.update();
        controlsRef.current = controls;

        resetRef.current = () => {
          camera.position.set(dist * 0.55, dist * 0.4, dist);
          controls?.target.set(0, 0, 0);
          controls?.update();
        };

        const render = () => {
          raf = requestAnimationFrame(render);
          controls?.update();
          renderer?.render(scene, camera);
        };
        render();
        setLoading(false);

        resizeObserver = new ResizeObserver(() => {
          const w = Math.max(1, container.clientWidth);
          const h = Math.max(1, container.clientHeight);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer?.setSize(w, h);
        });
        resizeObserver.observe(container);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load 3D model",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      controls?.dispose();
      controlsRef.current = null;
      resetRef.current = null;
      for (const t of textures) t.dispose();
      if (model) disposeObject(model);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [url, ext, textureOverride]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center pointer-events-none">
          <svg
            className="w-7 h-7 text-[var(--text-muted)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-[11px] text-[var(--text-muted)]">{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
          <button
            type="button"
            title={spin ? "Stop rotation" : "Auto-rotate"}
            onClick={() => {
              setSpin((s) => {
                const next = !s;
                if (controlsRef.current) controlsRef.current.autoRotate = next;
                return next;
              });
            }}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-black/45 text-white hover:bg-black/65 transition-colors cursor-pointer backdrop-blur-sm"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            type="button"
            title="Reset view"
            onClick={() => resetRef.current?.()}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-black/45 text-white hover:bg-black/65 transition-colors cursor-pointer backdrop-blur-sm"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ModelViewer({
  path,
  alt,
  style,
  className,
  variant = "inline",
}: {
  path: string;
  alt?: string | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
  variant?: "inline" | "preview";
}) {
  const opts = parseModelOptions(path);
  const { url, loading } = useEchoUrl(path);
  const basePath = path.split("?")[0] ?? path;
  const name = alt ?? getFileName(basePath);
  const ext = getExt(basePath);

  // A percentage height can't resolve against the inline-block's auto-height
  // parent, so it would collapse. Instead, read it as a share of the viewer's
  // rendered width and express it as an aspect-ratio: the box then keeps a
  // stable shape that scales with the container (100% is square, 50% is 2:1
  // landscape, 200% is 1:2 portrait). Pixel heights stay literal.
  const heightRaw = opts.height;
  const hPct = heightRaw?.trim().endsWith("%") ? parseFloat(heightRaw) : NaN;
  const usePercentHeight = Number.isFinite(hPct) && hPct > 0;

  const boxStyle: CSSProperties = {
    width: opts.width ?? (variant === "preview" ? "70vw" : "100%"),
    maxWidth: variant === "preview" ? "70vw" : "100%",
    background: opts.bg ?? "var(--thumb-bg)",
    ...(usePercentHeight
      ? { aspectRatio: `100 / ${hPct}` }
      : { height: heightRaw ?? (variant === "preview" ? "70vh" : "340px") }),
    ...style,
  };

  return (
    <span
      className={`echo-model relative my-2 inline-block overflow-hidden rounded-lg border border-gray-200 align-middle${
        className ? ` ${className}` : ""
      }`}
      style={boxStyle}
    >
      {url ? (
        <ModelCanvas
          url={url}
          ext={ext}
          autorotate={opts.autorotate}
          textureOverride={opts.texture}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          {loading ? (
            <span className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              3D model not found
            </span>
          )}
        </span>
      )}

      <span className="pointer-events-none absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white backdrop-blur-sm">
        <svg
          className="w-2.5 h-2.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 2l9 5v10l-9 5-9-5V7l9-5zM3.5 7L12 12m0 0l8.5-5M12 12v10"
          />
        </svg>
        3D
      </span>

      <span className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[70%] truncate rounded bg-black/40 px-1.5 py-0.5 text-[9px] text-white backdrop-blur-sm">
        {name}
      </span>
    </span>
  );
}
