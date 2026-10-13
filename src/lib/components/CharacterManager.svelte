<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { confirm } from '@tauri-apps/plugin-dialog';
  import {
    createCharacterManager,
    normalizeExpression,
    readCharacterConfig,
    validateCharacters,
    characterImagePath,
    type CharacterDraft,
    type ExpressionDraft,
    type CharacterIssue,
    type CharacterSnapshot,
    type PendingCharacterImage,
  } from '../workspace/blogCharacterManager.ts';
  import { characterStorage } from '../workspace/blogCharacterStorage.ts';
  import { validateDroppedImages } from '../workspace/imageDrop.ts';
  import { imageMime } from '../workspace/image.ts';
  import { failure } from '../workspace/session.ts';

  let { onSaved }: { onSaved: () => void | Promise<void> } = $props();
  const manager = createCharacterManager(characterStorage);
  let characters = $state<CharacterDraft[]>([]);
  let snapshot = $state<CharacterSnapshot | null>(null);
  let selected = $state(0);
  let busy = $state(true);
  let dirty = $state(false);
  let error = $state('');
  let status = $state('');
  let issues = $state<CharacterIssue[]>([]);
  // 下書きのオブジェクトを参照して画像を対応させ、名前変更後の保存先を保存時に決める。
  const expressionOrigins = new Map<ExpressionDraft, ExpressionDraft>();
  const origins = new Map<CharacterDraft, CharacterDraft>();
  function rememberOrigins() {
    origins.clear();
    expressionOrigins.clear();
    readCharacterConfig(snapshot!.text).characters.forEach((item, index) => {
      origins.set(characters[index], item);
      item.expressions.forEach((expression, e) => expressionOrigins.set(characters[index].expressions[e], expression));
    });
  }
  let pending: PendingCharacterImage[] = [];
  let disposed = false;
  const urls = new Set<string>();
  const previews = new Map<ExpressionDraft, string>();
  const images = new Map<string, Promise<string>>();
  let previewVersion = $state(0);
  const character = $derived(characters[selected]);
  const disabled = $derived(busy || !snapshot || snapshot.readonly);
  function changed() {
    dirty = true;
    status = '';
    issues = validateCharacters(characters);
  }
  function problem(c: number, field: string, e?: number) {
    return issues.find((issue) => issue.character === c && issue.expression === e && issue.field === field)?.message;
  }
  function image(item: ExpressionDraft) {
    previewVersion;
    const staged = previews.get(item);
    if (staged) return Promise.resolve(staged);
    if (!item.src) return Promise.resolve('');
    if (!images.has(item.src))
      images.set(
        item.src,
        invoke<ArrayBuffer>('image_read', { path: item.src })
          .then((data) => {
            const bytes = new Uint8Array(data),
              url = URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) }));
            if (disposed) {
              URL.revokeObjectURL(url);
              return '';
            }
            urls.add(url);
            return url;
          })
          .catch(() => ''),
      );
    return images.get(item.src)!;
  }
  async function load() {
    busy = true;
    error = '';
    status = '';
    try {
      const loaded = await manager.load();
      snapshot = loaded.snapshot;
      characters = loaded.characters;
      rememberOrigins();
      pending = [];
      selected = 0;
      dirty = false;
      issues = validateCharacters(characters);
      previews.clear();
      images.clear();
      previewVersion++;
    } catch (reason) {
      snapshot = null;
      error = failure(reason).message;
    } finally {
      busy = false;
    }
  }
  export async function canLeave() {
    if (busy) return false;
    return (
      !dirty ||
      (await confirm('保存していない変更を破棄しますか？', {
        title: 'キャラクターの管理',
        kind: 'warning',
        okLabel: '破棄する',
        cancelLabel: 'キャンセル',
      }))
    );
  }
  async function reload() {
    if (await canLeave()) await load();
  }
  function addCharacter() {
    characters.push({
      key: '',
      name: '',
      defaultExpression: 'normal',
      expressions: [{ expression: 'normal', label: '通常', src: '', aliases: [] }],
    });
    selected = characters.length - 1;
    changed();
  }
  function addExpression() {
    if (!character) return;
    character.expressions.push({ expression: '', label: '', src: '', aliases: [] });
    changed();
  }
  async function remove(expression?: ExpressionDraft) {
    if (disabled || !character) return;
    busy = true;
    error = '';
    try {
      // 使用数は保存前のキーと表情で数える。下書きで名前を変えても、元の記事の使用を見落とさない。
      const prior = origins.get(character);
      const priorExpression = expression && expressionOrigins.get(expression);
      let count = await manager.usage(prior ?? character, expression ? (priorExpression ?? expression) : undefined);
      if (prior && prior.key.toUpperCase() !== character.key.toUpperCase()) count += await manager.usage(character, expression);
      const target = expression ? `表情「${expression.expression}」` : `キャラクター「${character.key}」`;
      if (
        !(await confirm(`${target}を削除しますか？${count ? `記事で${count}件使われています。` : ''}`, {
          title: '削除の確認',
          kind: 'warning',
          okLabel: '削除する',
          cancelLabel: 'キャンセル',
        }))
      )
        return;
      if (expression) {
        character.expressions = character.expressions.filter((item) => item !== expression);
        if (character.defaultExpression === normalizeExpression(expression.expression))
          character.defaultExpression = normalizeExpression(character.expressions[0]?.expression ?? '');
      } else {
        characters.splice(selected, 1);
        selected = Math.max(0, Math.min(selected, characters.length - 1));
      }
      changed();
    } catch (reason) {
      error = failure(reason).message;
    } finally {
      busy = false;
    }
  }
  async function selectImage(item: ExpressionDraft, files: File[]) {
    if (disabled || !files.length || !character) return;
    busy = true;
    error = '';
    try {
      if (files.length !== 1) throw Error('画像は1つ選んでください。');
      validateDroppedImages(files);
      const file = files[0];
      characterImagePath(character.key, item.expression, file.name);
      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      pending = pending.filter((image) => image.expression !== item);
      pending.push({ character, expression: item, filename: file.name, data });
      const url = URL.createObjectURL(file);
      urls.add(url);
      previews.set(item, url);
      previewVersion++;
      changed();
    } catch (reason) {
      issues = [
        ...issues.filter(
          (issue) => !(issue.character === selected && issue.expression === character.expressions.indexOf(item) && issue.field === 'src'),
        ),
        { character: selected, expression: character.expressions.indexOf(item), field: 'src', message: failure(reason).message },
      ];
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (disabled || !snapshot) return;
    busy = true;
    error = '';
    status = '';
    try {
      const result = await manager.save(snapshot, characters, pending, (path) =>
        confirm(`「${path}」を上書きしますか？`, {
          title: '画像の上書き',
          kind: 'warning',
          okLabel: '上書きする',
          cancelLabel: 'キャンセル',
        }),
      );
      if ('issues' in result) {
        issues = result.issues ?? [];
        selected = issues[0]?.character ?? selected;
        return;
      }
      if ('cancelled' in result) return;
      snapshot = result.snapshot;
      characters = result.characters;
      rememberOrigins();
      pending = [];
      dirty = false;
      issues = [];
      previews.clear();
      images.clear();
      previewVersion++;
      status = '保存しました。';
      if (result.cleanupErrors.length) error = '設定は保存しました。画像をゴミ箱へ移せませんでした。' + result.cleanupErrors.join('、');
      await onSaved();
    } catch (reason) {
      const issue = failure(reason);
      error = issue.code === 'CONFLICT' ? 'ディスクの内容が変更されています。再読み込みして確認してください。' : issue.message;
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(() => {
    disposed = true;
    for (const url of urls) URL.revokeObjectURL(url);
  });
</script>

<div class="character-manager" aria-busy={busy}>
  <div class="manager-toolbar">
    <button type="button" onclick={addCharacter} {disabled}>キャラクターを追加</button>
    <button type="button" onclick={() => void reload()} disabled={busy}>再読み込み</button>
    <button type="button" onclick={() => void save()} disabled={disabled || !dirty} class="character-save">保存</button>
  </div>
  {#if error}<p class="manager-error" role="alert">{error}</p>{/if}
  {#if status}<p role="status">{status}</p>{/if}
  {#if snapshot?.readonly}<p class="manager-error">config.tsは読み取り専用です。</p>{/if}
  <div class="manager-content">
    <nav class="character-list" aria-label="キャラクター">
      {#each characters as item, index}
        {@const standard = item.expressions.find((expression) => normalizeExpression(expression.expression) === item.defaultExpression)}
        <button type="button" aria-current={selected === index ? 'true' : undefined} onclick={() => (selected = index)} disabled={busy}>
          {#if standard}{#await image(standard) then url}{#if url}<img src={url} alt="" />{/if}{/await}{/if}
          <span>{item.key || '新しいキャラクター'}<small>{item.name}</small></span>
        </button>
      {/each}
    </nav>
    <div class="character-fields">
      {#if character}
        <label
          >キー<input
            data-field="key"
            value={character.key}
            oninput={(event) => {
              character.key = event.currentTarget.value;
              changed();
            }}
            {disabled}
            aria-invalid={!!problem(selected, 'key')}
          />{#if problem(selected, 'key')}<span class="field-error">{problem(selected, 'key')}</span>{/if}</label
        >
        <label>名前<input data-field="name" bind:value={character.name} oninput={changed} {disabled} /></label>
        <label
          >標準の表情<select
            data-field="defaultExpression"
            bind:value={character.defaultExpression}
            onchange={changed}
            {disabled}
            aria-invalid={!!problem(selected, 'defaultExpression')}
          >
            <option value="">選択</option>{#each character.expressions as item}<option value={normalizeExpression(item.expression)}
                >{item.expression}</option
              >{/each}
          </select>{#if problem(selected, 'defaultExpression')}<span class="field-error">{problem(selected, 'defaultExpression')}</span
            >{/if}</label
        >
        <button type="button" class="delete-character" onclick={() => void remove()} {disabled}>キャラクターを削除</button>
        <h3>表情</h3>
        {#each character.expressions as item, index (item)}
          <fieldset class="expression-fields" data-expression-index={index} {disabled}>
            <legend>{item.expression || '新しい表情'}</legend>
            <label
              >表情名<input
                data-field="expression"
                value={item.expression}
                oninput={(event) => {
                  if (character.defaultExpression === normalizeExpression(item.expression))
                    character.defaultExpression = normalizeExpression(event.currentTarget.value);
                  item.expression = event.currentTarget.value;
                  changed();
                }}
                aria-invalid={!!problem(selected, 'expression', index)}
              />{#if problem(selected, 'expression', index)}<span class="field-error">{problem(selected, 'expression', index)}</span
                >{/if}</label
            >
            <label>表示名<input data-field="label" bind:value={item.label} oninput={changed} /></label>
            <label
              >別名<textarea
                data-field="aliases"
                value={item.aliases.join('\n')}
                oninput={(event) => {
                  item.aliases = event.currentTarget.value ? event.currentTarget.value.split('\n') : [];
                  changed();
                }}
                aria-invalid={!!problem(selected, 'aliases', index)}></textarea>{#if problem(selected, 'aliases', index)}<span
                  class="field-error">{problem(selected, 'aliases', index)}</span
                >{/if}</label
            >
            <label
              class="image-picker"
              ondragover={(event) => event.preventDefault()}
              ondrop={(event) => {
                event.preventDefault();
                void selectImage(item, Array.from(event.dataTransfer?.files ?? []));
              }}
            >
              画像
              {#await image(item) then url}{#if url}<img src={url} alt={item.label} />{/if}{/await}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onchange={(event) => {
                  void selectImage(item, Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = '';
                }}
              />
              {#if problem(selected, 'src', index)}<span class="field-error">{problem(selected, 'src', index)}</span>{/if}
            </label>
            <button type="button" class="delete-expression" onclick={() => void remove(item)}>表情を削除</button>
          </fieldset>
        {/each}
        <button type="button" class="add-expression" onclick={addExpression} {disabled}>表情を追加</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .character-manager {
    display: grid;
    gap: 14px;
    min-height: 0;
    height: 100%;
  }
  .manager-toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .character-save {
    margin-left: auto;
  }
  .manager-content {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 20px;
    min-height: 0;
    overflow: auto;
  }
  .character-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .character-list button {
    display: flex;
    gap: 8px;
    text-align: left;
    align-items: center;
  }
  .character-list button[aria-current='true'] {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .character-list img {
    width: 36px;
    height: 36px;
    object-fit: contain;
  }
  .character-list span {
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
  }
  .character-fields {
    display: grid;
    gap: 12px;
    align-content: start;
    min-width: 0;
  }
  label {
    display: grid;
    gap: 5px;
  }
  input,
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
  }
  textarea {
    min-height: 60px;
    resize: vertical;
  }
  .expression-fields {
    display: grid;
    gap: 12px;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    min-width: 0;
  }
  h3 {
    font-size: 15px;
    margin: 8px 0 0;
  }
  .image-picker {
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 10px;
  }
  .image-picker img {
    width: 72px;
    height: 72px;
    object-fit: contain;
  }
  .field-error,
  .manager-error {
    color: var(--danger, #b83838);
    font-size: 13px;
    margin: 0;
  }
  [aria-invalid='true'] {
    border-color: var(--danger, #b83838);
  }
  @media (max-width: 560px) {
    .manager-content {
      grid-template-columns: 1fr;
    }
    .character-list {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }
</style>
