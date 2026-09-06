/** Move a floating panel from its handle with pointer capture or arrow keys. */
export function dragPanel(node: HTMLElement, options: {
  handle: string;
  move: (position: { left: number; top: number }) => void;
  reset: () => void;
}) {
  let drag: { id: number; x: number; y: number; left: number; top: number; handle: HTMLElement } | null = null;

  const handleFrom = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(options.handle) : null;

  function down(event: PointerEvent) {
    const handle = handleFrom(event.target);
    if (!handle || event.button !== 0 || !event.isPrimary) return;
    const rect = node.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, handle };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    node.dataset.dragging = 'true';
    event.preventDefault();
    event.stopPropagation();
  }

  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    options.move({ left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y });
    event.stopPropagation();
  }

  function end(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const { handle, id } = drag;
    drag = null;
    delete node.dataset.dragging;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }

  function key(event: KeyboardEvent) {
    if (!handleFrom(event.target)) return;
    const step = event.shiftKey ? 40 : 10;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (event.key === 'Home') options.reset();
    else if (directions[event.key]) {
      const rect = node.getBoundingClientRect();
      const [x, y] = directions[event.key];
      options.move({ left: rect.left + x, top: rect.top + y });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);
  node.addEventListener('keydown', key);
  return {
    update(next: typeof options) { options = next; },
    destroy() {
      if (drag?.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('lostpointercapture', end);
      node.removeEventListener('keydown', key);
    },
  };
}
