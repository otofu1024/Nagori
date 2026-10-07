<script>
  import Editor from '../../src/lib/Editor.svelte';
  let { config } = $props();
  let saving = $state(false);
  export function save(value) { saving = value; }
</script>
<Editor {...config} {saving}/>
