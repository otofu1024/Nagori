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
