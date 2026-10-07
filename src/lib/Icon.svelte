<script lang="ts">
  const paths = {
    search: 'm20 20-4.4-4.4 M10.8 17.3a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M9 12h6 M9 16h4',
    folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
    'folder-open': 'M3 10V5a1 1 0 0 1 1-1h5l2 3h9v3 M3 10h18l-3 10H5z',
    'folder-plus': 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z M12 11v6 M9 14h6',
    image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M3 17l5-5 4 4 3-3 6 6 M16 7h.01',
    external: 'M14 3h7v7 M21 3l-10 10 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
    plus: 'M12 5v14 M5 12h14',
    right: 'm9 5 7 7-7 7',
    down: 'm5 9 7 7 7-7',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M19.1 4.9l-1.4 1.4 M6.3 17.7l-1.4 1.4',
    moon: 'M20.4 14.7A9 9 0 0 1 9.3 3.6 9 9 0 1 0 20.4 14.7z',
    monitor: 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M12 17v4 M8 21h8',
    sidebar: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M9 3v18',
    outline: 'M4 6h2 M10 6h10 M6 12h2 M12 12h8 M6 18h2 M12 18h8',
    close: 'm6 6 12 12 M6 18 18 6',
    code: 'm8 6-6 6 6 6 M16 6l6 6-6 6',
    link: 'm10 13 4-4 M8 15l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0 M16 9l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0',
    check: 'm5 12 4 4L19 6',
    settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6'
  };
  let { name, size = 18 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>
