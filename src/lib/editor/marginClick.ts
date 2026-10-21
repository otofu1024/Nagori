import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

// 文字の行の外(左右の余白や本文の左のpadding)を押した時の選択を、WebKitに任せない拡張。
// WebKitは押した位置の文字を正しく選べず、CodeMirrorがその選択を取り込んで画面が飛ぶため、既定の選択を止めて位置を自分で決める。
// 余白は.cm-contentの外にあるため、CodeMirrorのdomEventHandlersでは届かない。そこで.cm-editorで捕捉フェーズに受ける。
// 文字の行とwidgetの上の押下は今の動きのまま残す。右クリックと Control を押したクリックも変えない。
export function marginClick(): Extension {
  return ViewPlugin.define(view => {
    const down = (event: MouseEvent) => {
      if (pressMargin(event, view)) {
        // 処理を済ませた押下は、CodeMirrorの本文側の処理に渡さない
        event.stopPropagation();
        event.preventDefault();
      }
    };
    view.dom.addEventListener('mousedown', down, true);
    return { destroy: () => view.dom.removeEventListener('mousedown', down, true) };
  });
}

function pressMargin(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0 || event.ctrlKey) return false;
  // 押した所が本文の器そのもの(外側の欄、本文欄、Live Previewの空白)の時だけ扱う
  const target = event.target;
  if (!(target instanceof HTMLElement) || ![view.dom, view.scrollDOM, view.contentDOM].includes(target)) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  if (pos === null) return false;
  // 画面は動かさない。focusはpreventScrollで行う
  view.focus();
  const anchor = event.shiftKey ? view.state.selection.main.anchor : pos;
  view.dispatch({ selection: EditorSelection.single(anchor, pos), userEvent: 'select.pointer' });
  // 押したまま動かした時は、押した位置から先を選ぶ
  const move = (moved: MouseEvent) => {
    const head = view.posAtCoords({ x: moved.clientX, y: moved.clientY }, false);
    if (head !== null) view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent: 'select.pointer' });
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  return true;
}
