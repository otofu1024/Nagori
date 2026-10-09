// 変換中に届く入力の種類。これ以外の入力は、変換が終わったあとに届く
const compositionInputTypes = new Set(['insertCompositionText', 'deleteCompositionText', 'insertFromComposition', 'deleteByComposition']);
// 変換の操作だけに使われ、文字を入力しないキー。押しても変換中かどうかは分からない
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'Dead']);

// beforeinput で、変換が終わったと分かるか。変換中の入力（isComposing かつ変換用の入力種別）では終わらない。
// WebKitの確定の時の最後の入力は isComposing が立つので、その入力では終わらないと判定する
export function inputEndsComposition(inputType: string, isComposing: boolean) {
  return !isComposing && !compositionInputTypes.has(inputType);
}

// keydown で、変換が終わったと分かるか。IMEが握っているキー（keyCode 229）と、修飾キーだけの操作では終わらない
export function keyEndsComposition(event: { key: string; keyCode: number; isComposing: boolean }) {
  return !event.isComposing && event.keyCode !== 229 && !modifierKeys.has(event.key);
}

// IMEの変換中の入力では処理を行わず、確定の時にだけ処理を行うための判定。
// WebKit（Safari・WKWebView）は確定の時の最後のinputにもisComposingを立て、そのあとにcompositionendを送るため、
// inputだけで判定すると確定後の文字を拾えない。compositionendでも処理を行う。
export function compositionGate(commit: () => void) {
  let composing = false;
  return {
    start() {
      composing = true;
    },
    // 変換中のinputは無視する。変換中でなければ、入力のたびに処理する
    input(isComposing = false) {
      if (!composing && !isComposing) commit();
    },
    // 確定（またはキャンセル）の時に処理する。Chromeなどで先にinputが届いても、二重に処理しても結果は同じ
    end() {
      composing = false;
      commit();
    },
    // 変換が途中で終わらず戻らなかった時のために、状態を戻す
    reset() {
      composing = false;
    },
  };
}
