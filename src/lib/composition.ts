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

// エディターの blur のあと、compositionend を待つ時間。WebKitは blur の時に未確定文字を確定し、compositionend を先に送るため、
// この時間の中で届く。届かなければ変換は終わっていたとみなす
export const COMPOSITION_BLUR_WAIT_MS = 50;

// 変換の終わりを待つ上限。compositionend が来ない時に、保存・記事の切り替え・終了が止まり続けないようにするため
export const COMPOSITION_SETTLE_LIMIT_MS = 1500;

// blur のあとに変換が残っていたら、少し待って終わりとみなす。compositionend（cancel）が先に届けば何もしない
export function createBlurFailsafe(end: () => void, delay = COMPOSITION_BLUR_WAIT_MS, timers = { setTimeout, clearTimeout }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  }
  return {
    // 変換中に blur した時だけ待つ。変換が終わっていれば待たない
    blur(composing: boolean) {
      cancel();
      if (!composing) return;
      timer = timers.setTimeout(() => {
        timer = undefined;
        end();
      }, delay);
    },
    // compositionstart / compositionend が届いた時に呼び、待ちを取り消す
    cancel,
  };
}
