<script lang="ts">
  import { activityScrollbar } from './activityScrollbar.ts';
  import type { OutlineHeading } from './outline.ts';
  let {
    headings,
    active,
    onNavigate,
  }: {
    headings: OutlineHeading[];
    active: number;
    onNavigate: (index: number) => void;
  } = $props();
</script>

<nav use:activityScrollbar class="outline" aria-label="目次">
  <div class="outline-title">目次</div>
  <ol>
    {#each headings as heading, index}
      <li>
        <button
          type="button"
          style={`--outline-depth:${heading.level - 1}`}
          aria-current={active === index ? 'location' : undefined}
          onclick={() => onNavigate(index)}>{heading.text || '無題の見出し'}</button
        >
      </li>
    {/each}
  </ol>
</nav>
