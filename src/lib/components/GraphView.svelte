<script lang="ts">
  import { onMount } from 'svelte';
  import { graphCanvas } from '../workspace/graphCanvas.ts';
  import type { GraphData } from '../workspace/graph.ts';
  let {
    data,
    active,
    current = '',
    loading = false,
    onOpen,
  }: {
    data: GraphData;
    active: boolean;
    current?: string;
    loading?: boolean;
    onOpen: (path: string) => void;
  } = $props();
  let canvas: HTMLCanvasElement;
  let graph = $state.raw<ReturnType<typeof graphCanvas>>();
  onMount(() => {
    graph = graphCanvas(canvas, onOpen);
    return () => graph?.destroy();
  });
  $effect(() => {
    graph?.update(data);
  });
  $effect(() => {
    graph?.show(active);
  });
  $effect(() => {
    graph?.current(current);
  });
</script>

<div class="graph-view" hidden={!active} aria-busy={loading}>
  <canvas bind:this={canvas} tabindex="0" aria-label="ノートとタグのグラフ"></canvas>
</div>

<style>
  .graph-view {
    position: absolute;
    inset: 0;
    background: var(--surface);
    overflow: hidden;
  }
  .graph-view[hidden] {
    display: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  canvas:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
</style>
