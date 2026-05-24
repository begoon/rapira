<script lang="ts">
  import { onMount } from 'svelte';
  import { renderEvents } from './renderer.ts';
  import type { GfxEvent } from '../../src/graphics.ts';

  interface Props {
    text: string;
    gfx: GfxEvent[];
  }
  let { text, gfx }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => { if (canvas) renderEvents(canvas, gfx); });

  // Hide canvas if there are no graphics events
  const hasGfx = $derived(gfx.length > 0);
</script>

<div class="output-pane">
  <div class="text-output">{text || ' '}</div>
  {#if hasGfx}
    <div class="canvas-host">
      <canvas bind:this={canvas} width="256" height="256"></canvas>
    </div>
  {/if}
</div>

<style>
  .text-output {
    white-space: pre;
    padding: 10px 12px;
    overflow: auto;
    font-size: 13px;
    flex: 1;
  }
</style>
