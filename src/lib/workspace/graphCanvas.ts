import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GraphData, GraphNode } from './graph.ts';

type Node = GraphNode & SimulationNodeDatum & { opacity: number };
type Edge = SimulationLinkDatum<Node> & { source: Node; target: Node; kind: 'link' | 'tag'; opacity: number };
const radius = (node: GraphNode) => 4.5 + Math.min(5, Math.sqrt(node.degree) * 1.2);

export function graphCanvas(canvas: HTMLCanvasElement, open: (path: string) => void) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('グラフを描画できません。');
  const ctx = context;
  const accessibleLabel = canvas.getAttribute('aria-label') ?? '記事とタグのグラフ';
  const simulation = forceSimulation<Node>()
    .stop()
    .alphaDecay(0.025)
    .velocityDecay(0.32)
    .force('charge', forceManyBody<Node>().strength(-110).theta(0.9))
    .force(
      'collide',
      forceCollide<Node>().radius((node) => radius(node) + 8),
    )
    .force('x', forceX<Node>(0).strength(0.06))
    .force('y', forceY<Node>(0).strength(0.06));
  let nodes: Node[] = [],
    edges: Edge[] = [],
    neighbors = new Map<string, Set<string>>();
  let active = false,
    current = '',
    hovered: Node | undefined,
    focused = -1;
  let width = 0,
    height = 0,
    ratio = 1,
    frame = 0,
    lastFrame = 0,
    draws = 0;
  let x = 0,
    y = 0,
    scale = 1,
    targetScale = 1,
    anchorX = 0,
    anchorY = 0,
    pointerX = 0,
    pointerY = 0;
  let velocityX = 0,
    velocityY = 0,
    labelAlpha = 0;
  let drag:
    | { pointer: number; node?: Node; startX: number; startY: number; lastX: number; lastY: number; time: number; moved: boolean }
    | undefined;
  let colors = { text: '', muted: '', line: '', tag: '', accent: '' };
  function readColors() {
    const style = getComputedStyle(canvas);
    colors = {
      text: style.getPropertyValue('--text').trim(),
      muted: style.getPropertyValue('--muted').trim(),
      line: style.getPropertyValue('--border').trim(),
      tag: style.getPropertyValue('--syntax-keyword').trim(),
      accent: style.getPropertyValue('--accent').trim(),
    };
    wake();
  }
  function wake() {
    if (active && !frame && width && height) frame = requestAnimationFrame(render);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    ratio = window.devicePixelRatio || 1;
    const pixelWidth = active ? Math.round(width * ratio) : 0;
    const pixelHeight = active ? Math.round(height * ratio) : 0;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    wake();
  }
  function point(event: { clientX: number; clientY: number }) {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const bounds = canvas.getBoundingClientRect();
      pointerX = event.clientX - bounds.left - width / 2;
      pointerY = event.clientY - bounds.top - height / 2;
    }
    return { x: pointerX, y: pointerY };
  }
  function hit(px: number, py: number) {
    const worldX = (px - x) / scale,
      worldY = (py - y) / scale;
    let result: Node | undefined,
      distance = Infinity;
    for (const node of nodes) {
      const d = Math.hypot(node.x! - worldX, node.y! - worldY);
      if (d < Math.max(radius(node), 10 / scale) && d < distance) {
        distance = d;
        result = node;
      }
    }
    return result;
  }
  function hover(node?: Node) {
    if (node === hovered) return;
    hovered = node;
    canvas.style.cursor = node ? 'pointer' : 'grab';
    canvas.title = node?.label ?? '';
    canvas.setAttribute('aria-label', node ? `${node.label}。${accessibleLabel}` : accessibleLabel);
    wake();
  }
  function render(time: number) {
    frame = 0;
    const delta = Math.min(3, (time - (lastFrame || time - 16.67)) / 16.67);
    lastFrame = time;
    let moving = false;
    if (simulation.alpha() >= simulation.alphaMin()) {
      simulation.tick();
      moving = true;
    }
    if (Math.abs(targetScale - scale) > 0.0001) {
      const next = scale + (targetScale - scale) * (1 - Math.exp(-0.24 * delta));
      x = anchorX - ((anchorX - x) * next) / scale;
      y = anchorY - ((anchorY - y) * next) / scale;
      scale = next;
      moving = true;
    } else if (scale !== targetScale) {
      x = anchorX - ((anchorX - x) * targetScale) / scale;
      y = anchorY - ((anchorY - y) * targetScale) / scale;
      scale = targetScale;
    }
    if (!drag && Math.hypot(velocityX, velocityY) > 0.05) {
      x += velocityX * delta;
      y += velocityY * delta;
      const decay = Math.exp(-0.14 * delta);
      velocityX *= decay;
      velocityY *= decay;
      moving = true;
    } else if (!drag) {
      velocityX = 0;
      velocityY = 0;
    }
    const fade = 1 - Math.exp(-0.2 * delta);
    const labelTarget = Math.max(0, Math.min(1, (scale - 1) / 0.6));
    if (Math.abs(labelTarget - labelAlpha) > 0.002) {
      labelAlpha += (labelTarget - labelAlpha) * fade;
      moving = true;
    } else labelAlpha = labelTarget;
    const adjacent = hovered ? neighbors.get(hovered.id) : undefined;
    const approach = (item: { opacity: number }, target: number) => {
      if (Math.abs(item.opacity - target) > 0.002) {
        item.opacity += (target - item.opacity) * fade;
        moving = true;
      } else item.opacity = target;
    };
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(width / 2 + x, height / 2 + y);
    ctx.scale(scale, scale);
    ctx.lineWidth = 1 / scale;
    for (const edge of edges) {
      const highlighted = !hovered || edge.source === hovered || edge.target === hovered;
      approach(edge, highlighted ? 1 : 0.1);
      ctx.globalAlpha = edge.opacity;
      ctx.strokeStyle = hovered && highlighted ? colors.muted : colors.line;
      ctx.beginPath();
      ctx.moveTo(edge.source.x!, edge.source.y!);
      ctx.lineTo(edge.target.x!, edge.target.y!);
      ctx.stroke();
    }
    const labels: { node: Node; alpha: number }[] = [];
    for (const node of nodes) {
      const highlighted = !hovered || node === hovered || adjacent?.has(node.id);
      approach(node, highlighted ? 1 : 0.16);
      ctx.globalAlpha = node.opacity;
      ctx.fillStyle = node.path === current ? colors.accent : node.kind === 'tag' ? colors.tag : colors.muted;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius(node), 0, Math.PI * 2);
      ctx.fill();
      if (node === hovered) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, radius(node) + 3 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (labelAlpha > 0.001) labels.push({ node, alpha: node.opacity * labelAlpha });
    }
    // 名前は画面の座標で、決まった大きさの字体で描く。拡大率ごとに字体を作ると、WebKitが字形をその数だけ抱える
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.text;
    for (const { node, alpha } of labels) {
      ctx.globalAlpha = alpha;
      ctx.fillText(node.label, width / 2 + x + node.x! * scale + radius(node) * scale + 5, height / 2 + y + node.y! * scale);
    }
    ctx.globalAlpha = 1;
    draws++;
    if (moving) wake();
    else lastFrame = 0;
  }
  function update(data: GraphData) {
    const previous = new Map(nodes.map((node) => [node.id, node]));
    nodes = data.nodes.map((node) => Object.assign(previous.get(node.id) ?? { opacity: 1 }, node));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    edges = data.edges.map((edge) => {
      neighbors.get(edge.source)!.add(edge.target);
      neighbors.get(edge.target)!.add(edge.source);
      return { source: byId.get(edge.source)!, target: byId.get(edge.target)!, kind: edge.kind, opacity: 1 };
    });
    hover(hovered && byId.get(hovered.id));
    focused = -1;
    simulation.nodes(nodes).force(
      'link',
      forceLink<Node, Edge>(edges)
        .id((node) => node.id)
        .distance((edge) => (edge.kind === 'tag' ? 65 : 100))
        .strength(0.25),
    );
    simulation.alpha(!nodes.length ? 0 : previous.size ? 0.35 : 1);
    if (!previous.size) {
      scale = targetScale = Math.min(1, Math.max(0.25, Math.min(width, height) / (Math.sqrt(nodes.length || 1) * 70)));
      x = y = 0;
    }
    wake();
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || drag) return;
    const p = point(event),
      node = hit(p.x, p.y);
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, node, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, time: event.timeStamp, moved: false };
    velocityX = velocityY = 0;
    targetScale = scale;
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    }
  }
  function move(event: PointerEvent) {
    const p = point(event);
    if (!drag) {
      hover(hit(p.x, p.y));
      return;
    }
    if (drag.pointer !== event.pointerId) return;
    drag.moved ||= Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4;
    if (drag.node && drag.moved) {
      drag.node.fx = (p.x - x) / scale;
      drag.node.fy = (p.y - y) / scale;
      simulation.alpha(0.3);
      hover(drag.node);
    } else if (!drag.node) {
      const dx = p.x - drag.lastX,
        dy = p.y - drag.lastY;
      x += dx;
      y += dy;
      const elapsed = Math.max(1, event.timeStamp - drag.time);
      velocityX = (dx * 16.67) / elapsed;
      velocityY = (dy * 16.67) / elapsed;
    }
    drag.lastX = p.x;
    drag.lastY = p.y;
    drag.time = event.timeStamp;
    wake();
  }
  function up(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const state = drag;
    drag = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (state.node) {
      state.node.fx = state.node.fy = null;
      if (state.moved) simulation.alpha(0.3);
      else if (event.type === 'pointerup' && state.node.path) open(state.node.path);
    }
    if (event.type !== 'pointerup' || event.timeStamp - state.time > 80) velocityX = velocityY = 0;
    wake();
  }
  function zoom(next: number, px: number, py: number) {
    targetScale = Math.max(0.15, Math.min(5, next));
    anchorX = px;
    anchorY = py;
    velocityX = velocityY = 0;
    wake();
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    event.stopPropagation();
    const p = point(event),
      delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(targetScale * Math.exp(-Math.max(-100, Math.min(100, delta)) * (event.ctrlKey ? 0.012 : 0.003)), p.x, p.y);
  }
  let pinchBase = 1;
  function gesture(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'gesturestart') pinchBase = targetScale;
    else {
      const e = event as Event & { scale: number; clientX: number; clientY: number };
      const p = point(e);
      zoom(pinchBase * e.scale, p.x, p.y);
    }
  }
  function key(event: KeyboardEvent) {
    if (!nodes.length) return;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      focused = focused < 0 ? (direction > 0 ? 0 : nodes.length - 1) : (focused + direction + nodes.length) % nodes.length;
      hover(nodes[focused]);
      if (hovered) {
        x = -hovered.x! * scale;
        y = -hovered.y! * scale;
        wake();
      }
    } else if (event.key === 'Enter' && hovered?.path) {
      event.preventDefault();
      open(hovered.path);
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      zoom(targetScale * (event.key === '-' ? 0.8 : 1.25), 0, 0);
    }
  }
  const leave = () => {
    if (!drag) hover();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const themeObserver = new MutationObserver(readColors);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('gesturestart', gesture, { passive: false });
  canvas.addEventListener('gesturechange', gesture, { passive: false });
  canvas.addEventListener('gestureend', gesture, { passive: false });
  window.addEventListener('resize', resize);
  resize();
  readColors();
  return {
    update,
    show(value: boolean) {
      active = value;
      if (value) {
        resize();
        wake();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = 0;
        if (drag?.node) drag.node.fx = drag.node.fy = null;
        drag = undefined;
        velocityX = velocityY = 0;
        canvas.width = canvas.height = 0;
      }
    },
    current(path: string) {
      current = path;
      wake();
    },
    // Deterministic interaction and idle checks without starting a WebView.
    inspect() {
      return {
        draws,
        running: !!frame,
        scale,
        x,
        y,
        nodes: nodes.map((node) => ({
          id: node.id,
          path: node.path,
          x: node.x,
          y: node.y,
          screenX: width / 2 + x + node.x! * scale,
          screenY: height / 2 + y + node.y! * scale,
        })),
        edges: edges.length,
      };
    },
    destroy() {
      active = false;
      cancelAnimationFrame(frame);
      frame = 0;
      simulation.stop().force('link', null).nodes([]);
      nodes = [];
      edges = [];
      neighbors.clear();
      drag = undefined;
      hover();
      canvas.width = canvas.height = 0;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', key);
      canvas.removeEventListener('gesturestart', gesture);
      canvas.removeEventListener('gesturechange', gesture);
      canvas.removeEventListener('gestureend', gesture);
      window.removeEventListener('resize', resize);
    },
  };
}
