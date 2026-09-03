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
    renderer.domElement.setAttribute('data-visual-version', '0');
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
    let visualVersion = 0;

    function clear() {
      for (const m of meshes) { group.remove(m); m.material.dispose(); }
      meshes = [];
    }

    /** The tiles currently placed, so a resize can re-frame them. */
    let placed = [];

    /**
     * Point the camera at what is actually there.
     *
     * The frustum used to be sized from the DECLARED grid — `max(cols, rows)`
     * — and the camera always looked at the origin. A scene that declares an
     * 8×8 grid and places six tiles therefore framed mostly empty floor, and
     * the content rendered as a small blob adrift in a large box. Seen on the
     * IBCA build's final chapter, which passed the gate because the gate can
     * only ask whether a canvas has geometry, not whether you can see it.
     *
     * The projection is isometric, so the on-screen extent is not the grid
     * span: width comes from both horizontal axes together, and height picks
     * up the tallest tile as well.
     */
    function frameContent() {
      if (placed.length === 0) return;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity, maxH = 0;
      for (const t of placed) {
        const c = Number(t.col) || 0;
        const r = Number(t.row) || 0;
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        maxH = Math.max(maxH, Math.max(0.05, t.height ?? 0.2));
      }
      const spanX = maxC - minC + 1;
      const spanZ = maxR - minR + 1;
      // Centre of the occupied region, in the same coordinates the meshes use.
      const cx = (minC + maxC) / 2 - cols / 2;
      const cz = (minR + maxR) / 2 - rows / 2;
      const cy = maxH / 2;

      // Isometric projection of the bounding box, to two decimal places of
      // trigonometry that does not need to be exact — it only sets padding.
      const projW = (spanX + spanZ) * 0.71;
      const projH = (spanX + spanZ) * 0.41 + maxH * 0.82;
      const aspectNow = (mount.clientWidth || width) / height;
      const half = Math.max(projH / 2, projW / (2 * aspectNow), 0.8) * 1.12;

      camera.left = -half * aspectNow;
      camera.right = half * aspectNow;
      camera.top = half;
      camera.bottom = -half;
      // Orthographic: distance does not change the size, only the clipping, so
      // a fixed offset along a constant isometric direction keeps the angle
      // identical whatever the content is.
      const d = 60;
      camera.position.set(cx + d, cy + d * 1.15, cz + d);
      camera.lookAt(cx, cy, cz);
      camera.updateProjectionMatrix();
    }

    function setTiles(tiles) {
      // Re-read background colour at top of setTiles so late stylesheets are picked up.
      scene.background = tokenColour('--ex-bg');
      clear();
      placed = (tiles || []).filter((t) => t && Number.isFinite(Number(t.col)) && Number.isFinite(Number(t.row)));
      if (placed.length !== (tiles || []).length) {
        // A tile with no col/row lands at NaN, renders nothing, and drags the
        // bounding box to NaN with it — taking the whole scene down with a
        // blank canvas and no error.
        console.error('[explainer-kit] createScene: dropped tile(s) missing a numeric col/row.');
      }
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
      frameContent();
      renderer.render(scene, camera);
      visualVersion += 1;
      renderer.domElement.setAttribute('data-visual-version', String(visualVersion));
      renderer.domElement.setAttribute('data-visual-state', JSON.stringify(placed));
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
      renderer.setSize(newWidth, height);
      // Re-frame rather than just re-stretching: the aspect has changed, so
      // the half-height that fits the content has changed with it.
      frameContent();
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
