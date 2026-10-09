# メモリ測定

## 2026-10-09の測定値

測定時の現行コードを、Release版の測定用アプリ`Nagori QA Mem`で計測した。単位はMiB。

| 場面 | アプリ全体 |
|---|---:|
| 空の画面 | 85.5〜92.9 |
| 10KiBの記事 | 149.3 |
| 100KiBの記事 | 161.0 |
| 画像を表示 | 199.7 |
| 画像の後に100KiBの記事へ戻る | 206.7 |

## 測り方

macOSの`footprint`で、測定用アプリと専用WebContentを含むアプリ全体を測った。WebContentの`WebKit Malloc`と使用中メモリも確認した。`Nagori QA Mem`は識別子`app.nagori.editor.qa20261004`でReleaseビルドした。

測定用ワークスペースはMarkdown 991個と画像10個の計1,000ファイル。記事を開く場面では本文を10KiBまたは100KiBにした。各場面で30秒待ち、5秒間隔で6回測って中央値を使った。空の画面は同じコードでも約7MiB揺れたため、複数回測って幅で記録する。

アプリ全体の値は実行ごとに揺れる。記事を開いた場面ではWebContentの`WebKit Malloc`を比較の目安にした。

## 分かったこと

#35では、約1,000項目の索引とゴミ箱一覧を`$state.raw`で持つようにし、`$state`の要素ごとのProxy生成による増加を抑えた。100KiBの記事を開いた時の合計は、修正前の176.9MiBから161.0MiBになった。

空の画面から10KiBの記事を開くと、WebKit Mallocは約27MiB増える。Markdown拡張全体で約12MiB、そのうち`livePreview`が約6MiBを占める。`livePreview`は100KiBの記事で約9.5MiBを使う。残り約15MiBはCodeMirror本体と画面部品と見ているが、内訳は未確認。

装飾を表示範囲に絞る案、構文木走査の配列を減らす案、MathJaxのスタイルを解放する案では、安定した改善を確認できなかった。画像の測定値が大きく揺れた案もあり、採用していない。`tree`を`$state.raw`にする案も、空の画面の揺れと区別できる差がなく、記事を開いた場面にも効果がなかった。

## 2026-10-09のNode上のヒープ内訳

Node 24.12で、`src/lib`の拡張とCodeMirrorの`EditorState`だけを構築して測った。画面、DOM、WebKitは含まない。記事は日本語を含む100KiBのMarkdownで、UTF-8で102,603バイト、UTF-16で64,289単位ある。見出し、リスト、表、画像、数式、コードを含む。解析は全文を終えた状態で測った。

構成ごとに別のプロセスで測り、構築の前後でGCを数回行って`used_heap_size`の差を取った。初回の関数コンパイル分は外すため、先に全拡張で一度構築して捨てた。値は3回以上の中央値で、外れ値は約40KiB揺れた。

| 構成 | GC後の保持量 KiB | 増分 KiB |
|---|---:|---:|
| 履歴と文書のみ | 138.6 | - |
| + markdown | 2893.7 | +2755.1 |
| + codeHighlighting | 2894.3 | +0.6 |
| + livePreview | 3060.1 | +165.8 |
| + typingFormat(全部) | 3061.6 | +1.5 |

全部から1つずつ外すと、次のとおり。

| 外した拡張 | 保持量 KiB | 全部との差 KiB |
|---|---:|---:|
| markdown | 322.8 | -2738.8 |
| codeHighlighting | 3061.5 | -0.1 |
| livePreview | 2880.5 | -181.1 |
| typingFormat | 3059.6 | -2.0 |

コンストラクタ名ごとの自己サイズ(self size)の増分は次のとおり。保持サイズ(retained size)ではない。

| 段階 | 対象 | 増分 KiB | 個数の増分 |
|---|---|---:|---:|
| markdown | 内部配列`(array)` | 1960.2 | +12302 |
| markdown | `Tree`(Lezer木のノード) | 240.1 | +3842 |
| markdown | `Array` | 198.6 | +6354 |
| markdown | `Uint16Array` / `ArrayBuffer` | 81.9 / 75.6 | 各+806 |
| livePreview | `(string)` | 125.9 | +12 |
| livePreview | `Object` | 25.9 | +510 |
| livePreview | `sliced string` | 14.4 | +461 |
| livePreview | `PointDecoration` | 12.0 | +153 |

参照元を数えると、`Tree`の`children`と`positions`がそれぞれ`Array`を3843個ずつ持っていた。よって`markdown`の増分の大半は、Lezerの構文木とその配列と見ている。`livePreview`の`(string)`は約125.6KiBで、文書全文の`state.doc.toString()`と大きさが一致する。`PreviewContext.text`の複製とみられるが、参照の確認までは行っていない。

EditSessionは`text`と`baseline`の2つの文字列を含め、約237KiBだった。EditSession自身のオブジェクトは小さい。`codeHighlighting`の増分はほぼ0で、ハイライトの範囲は表示時に決まるため、この測定では見えない。

## 次に減らせそうな候補

| 候補 | Node上の見込み | 状態 |
|---|---|---|
| `PreviewContext.text`で文書全文の複製を持たない | 約126KiB | 未実装。効果は未確認 |
| EditSessionで`text`と`baseline`が同じ内容の時に文字列を1つにする | 最大約126KiB | アプリ内で別の文字列になるかは未確認 |
| Lezer構文木の配列と`Tree`の保持方法 | 約2.7MiBの大半 | 直接の手段は確認していない |

## Nodeの測定で言えること

Nodeの保持量で見える範囲では、100KiBの記事で増えるのはほぼMarkdownの構文木で、約2.7MiBある。`livePreview`の増分は約0.17MiB、EditSessionの文字列は約0.24MiBだった。

WebKitで見た`livePreview`の約9.5MiBとの差は、DOMや画像、MathJaxの描画を作る部分と見ている。ただし内訳は未確認で、WebKitの削減量はここからは言えない。Nodeの測定では実装変更の効果を確認していないので、src/とtests/は変えていない。

測定用のスクリプトは作業用の場所に置き、リポジトリには入れていない。
