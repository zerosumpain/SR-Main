/* Explainer kit — low-poly isometric scene.
 * A tile grid of extruded blocks. Height and colour carry two variables;
 * clicking a tile inspects it. Requires three.min.js loaded first.
 *
 * The canvas carries data-scene so studio-gate's visual check can find it.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});

  const RAMP = ['--ex-ramp-0', '--ex-ramp-1', '--ex-ramp-2', '--ex-ramp-3', '--ex-ramp-4'];
  let warnedTokens = {};

  function tokenColour(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v && !warnedTokens[name]) {
      console.warn(`CSS token not found: ${name}`);
      warnedTokens[name] = true;
    }
    return new window.THREE.Color(v || undefined);
  }

  ns.createScene = function createScene(spec) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('createScene: three.min.js must be loaded first');
    const mount = spec.mount;
    if (!mount) throw new Error('createScene: spec.mount is required');

    const cols = spec.cols || 8;
    const rows = spec.rows || 8;
    const width = mount.clientWidth || 720;
    const height = spec.height || 420;

    const scene = new THREE.Scene();

    const aspect = width / height;
    const frustum = Math.max(cols, rows) * 0.85;
    const camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 1000,
    );
    camera.position.set(cols, Math.max(cols, rows), rows);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.setAttribute('data-scene', spec.id || 'scene');
    mount.appendChild(renderer.domElement);

    // Lights are not brand colours — not tokenised.
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(6, 12, 8);
    scene.add(key);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BoxGeometry(0.9, 1, 0.9);
    let meshes = [];
    let clickHandler = null;

    function clear() {
      for (const m of meshes) { group.remove(m); m.material.dispose(); }
      meshes = [];
    }

    function setTiles(tiles) {
      // Re-read background colour at top of setTiles so late stylesheets are picked up.
      scene.background = tokenColour('--ex-bg');
      clear();
      for (const t of tiles || []) {
        const h = Math.max(0.05, t.height ?? 0.2);
        const colour = tokenColour(RAMP[Math.min(4, Math.max(0, t.ramp ?? 0))]);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: colour }));
        mesh.position.set(t.col - cols / 2, h / 2, t.row - rows / 2);
        mesh.scale.y = h;
        mesh.userData = t;
        group.add(mesh);
        meshes.push(mesh);
      }
      renderer.render(scene, camera);
    }

    if (spec.onTileClick) {
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      clickHandler = (ev) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(meshes)[0];
        if (hit) spec.onTileClick(hit.object.userData);
      };
      renderer.domElement.addEventListener('click', clickHandler);
    }

    // ResizeObserver to handle mount resizing.
    const resizeObserver = new ResizeObserver(() => {
      const newWidth = mount.clientWidth || 720;
      const newAspect = newWidth / height;
      camera.left = -frustum * newAspect;
      camera.right = frustum * newAspect;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
      renderer.render(scene, camera);
    });
    resizeObserver.observe(mount);

    setTiles(spec.tiles);

    return {
      setTiles,
      destroy() {
        resizeObserver.disconnect();
        if (clickHandler) renderer.domElement.removeEventListener('click', clickHandler);
        clear();
        geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
  };
})();
