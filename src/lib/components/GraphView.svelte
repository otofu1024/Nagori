<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { graphCanvas } from '../workspace/graphCanvas.ts';
  import type { GraphData } from '../workspace/graph.ts';
  let {
    data,
    active,
    current = '',
    loading = false,
    onOpen,
    onBack,
  }: {
    data: GraphData;
    active: boolean;
    current?: string;
    loading?: boolean;
    onOpen: (path: string) => void;
    onBack: () => void;
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
  <button class="graph-back" type="button" aria-label="記事に戻る" title="記事に戻る" onclick={onBack}><Icon name="back" size={16} /></button>
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
  .graph-back {
    position: absolute;
    top: 16px;
    right: 16px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--muted);
  }
  .graph-back:hover {
    color: var(--text);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  canvas:focus,
  canvas:focus-visible {
    outline: none;
  }
</style>
