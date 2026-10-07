import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { search, SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search';

export const findReplaceBlocked = StateEffect.define<boolean>();
const replacementBlocked = StateField.define({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((blocked, effect) => effect.is(findReplaceBlocked) ? effect.value : blocked, value),
});

export function searchSummary(state: EditorState) {
  const query = getSearchQuery(state), selection = state.selection.main;
  let total = 0, current = 0, replaceable = 0;
  if (query.valid) {
    const cursor = query.getCursor(state);
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      total++;
      if (!('precise' in match.value) || match.value.precise) replaceable++;
      if (match.value.from === selection.from && match.value.to === selection.to) current = total;
    }
  }
  return { total, current, replaceable, invalid: !!query.search && query.regexp && !query.valid };
}

export function navigateMatch(editor: EditorView, backward = false) {
  const query = getSearchQuery(editor.state), selection = editor.state.selection.main;
  if (!query.valid) return false;
  // 空の一致からは同じ位置を選び直さず、次の位置へ進む。
  if (query.regexp && selection.empty) {
    const matches: { from: number; to: number }[] = [], cursor = query.getCursor(editor.state);
    for (let match = cursor.next(); !match.done; match = cursor.next()) matches.push(match.value);
    if (!matches.some(match => match.from === selection.from && match.to === selection.to)) return (backward ? findPrevious : findNext)(editor);
    const match = backward
      ? matches.reverse().find(match => match.from < selection.from) ?? matches[0]
      : matches.find(match => match.from > selection.to) ?? matches[0];
    if (!match) return false;
    editor.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from), userEvent: 'select.search' });
    return true;
  }
  return (backward ? findPrevious : findNext)(editor);
}

export function replaceMatches(editor: EditorView, all = false, composing = false) {
  if (composing || editor.composing || editor.state.readOnly || editor.state.field(replacementBlocked, false)) return 0;
  const query = getSearchQuery(editor.state);
  if (!query.valid) return 0;
  const before = editor.state.doc, selection = editor.state.selection.main;
  if (all) {
    const count = searchSummary(editor.state).replaceable;
    return replaceAll(editor) ? count : 0;
  }
  replaceNext(editor);
  if (selection.empty && editor.state.doc !== before) navigateMatch(editor);
  return editor.state.doc === before ? 0 : 1;
}

export function findExtension(isComposing: () => boolean, blocked = false) {
  return [
    replacementBlocked.init(() => blocked),
    EditorState.transactionExtender.of(tr => tr.isUserEvent('input.replace') ? { annotations: isolateHistory.of('full') } : null),
    search({ literal: true, regexp: false, caseSensitive: true, createPanel: editor => createFindPanel(editor, isComposing) }),
  ];
}

function createFindPanel(editor: EditorView, isComposing: () => boolean): Panel {
  const dom = document.createElement('div'); dom.className = 'nagori-find';
  const row = document.createElement('div'); row.className = 'nagori-find-row';
  const replacementRow = document.createElement('div'); replacementRow.className = 'nagori-find-row'; replacementRow.hidden = true;
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'このファイルを検索'; input.setAttribute('aria-label', '検索する文字列'); input.setAttribute('main-field', 'true');
  const replacement = document.createElement('input'); replacement.type = 'text'; replacement.placeholder = '置換する文字列'; replacement.setAttribute('aria-label', '置換する文字列');
  const count = document.createElement('span'); count.className = 'nagori-find-count'; count.setAttribute('aria-live', 'polite');
  let panelComposing = false, message = '';
  const composing = () => panelComposing || isComposing() || editor.composing;
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', label);
    b.onclick = () => { if (!composing()) action(); }; return b;
  };
  const caseButton = button('大文字と小文字を区別', () => setQuery(!getSearchQuery(editor.state).caseSensitive));
  const regexpButton = button('正規表現', () => setQuery(undefined, !getSearchQuery(editor.state).regexp));
  const replaceToggle = button('置換欄', () => {
    replacementRow.hidden = !replacementRow.hidden;
    replaceToggle.setAttribute('aria-pressed', String(!replacementRow.hidden));
    if (!replacementRow.hidden) replacement.focus();
  });
  replaceToggle.setAttribute('aria-pressed', 'false');
  const replace = (all = false) => {
    if (composing() || !getSearchQuery(editor.state).valid || replaceButton.disabled) return;
    message = '';
    const replaced = replaceMatches(editor, all);
    if (all) message = `${replaced}件を置換しました`;
    update();
  };
  const replaceButton = button('置換', () => replace());
  const replaceAllButton = button('すべて置換', () => replace(true));
  const previous = button('前へ', () => { message = ''; navigateMatch(editor, true); update(); });
  const next = button('次へ', () => { message = ''; navigateMatch(editor); update(); });
  const close = () => { closeSearchPanel(editor); editor.focus(); };

  function update(change?: ViewUpdate) {
    if (change?.docChanged || change?.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)))) message = '';
    const query = getSearchQuery(editor.state), summary = searchSummary(editor.state);
    if (!panelComposing) { input.value = query.search; replacement.value = query.replace; }
    caseButton.setAttribute('aria-pressed', String(query.caseSensitive)); regexpButton.setAttribute('aria-pressed', String(query.regexp));
    input.setAttribute('aria-invalid', String(summary.invalid));
    count.textContent = summary.invalid ? '正規表現が正しくありません' : message || `${summary.current} / ${summary.total}`;
    replaceButton.disabled = replaceAllButton.disabled = editor.state.readOnly || !!editor.state.field(replacementBlocked, false) || !query.valid || composing();
    previous.disabled = next.disabled = !query.valid;
  }
  function setQuery(caseSensitive?: boolean, regexp?: boolean) {
    if (composing()) return;
    const previous = getSearchQuery(editor.state);
    message = '';
    const query = new SearchQuery({ search: input.value, replace: replacement.value, literal: true, caseSensitive: caseSensitive ?? previous.caseSensitive, regexp: regexp ?? previous.regexp });
    if (query.eq(previous)) return;
    editor.dispatch({ effects: setSearchQuery.of(query) });
    if (input.value && getSearchQuery(editor.state).valid) findNext(editor);
    update();
  }
  input.oninput = () => setQuery();
  const setReplacement = () => {
    if (composing()) return;
    const query = getSearchQuery(editor.state);
    editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, replace: replacement.value })) });
  };
  replacement.oninput = setReplacement;
  dom.addEventListener('compositionstart', () => { panelComposing = true; });
  dom.addEventListener('compositionend', event => { panelComposing = false; if (event.target === input) setQuery(); else setReplacement(); });
  dom.onkeydown = event => {
    if (event.isComposing || event.keyCode === 229 || composing()) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Enter' && event.target === replacement) { event.preventDefault(); replace(event.metaKey || event.ctrlKey); }
    else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); message = ''; navigateMatch(editor, event.shiftKey); update(); }
  };
  row.append(input, count, caseButton, regexpButton, replaceToggle, previous, next, button('閉じる', close));
  replacementRow.append(replacement, replaceButton, replaceAllButton); dom.append(row, replacementRow);
  return { dom, top: true, mount: () => { input.focus(); input.select(); update(); }, update };
}
