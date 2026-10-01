# メモリ調査（2026-10-01）

## 現時点の結論

以前の高い使用量の中心はWebContentのgraphics／IOSurfaceだった。長時間利用後の約394〜454MiBを、同じ条件で再現できていない。Tauri・Svelte・画像のいずれかを主因と断定しない。

今回、アプリ側で閉じたEditorを1件残し得る参照を確認し、修正した。大きな描画メモリの保持を説明できるか、修正で何MiB減るかは未測定。

## 確認・修正した参照

`src/App.svelte`のQuick Openは、復帰先の`document.activeElement`を`quickFocus`へ保持していた。本文からCmd＋Pで別の記事を開いても、この参照を消していなかった。使用中のCodeMirrorでは本文DOMの`cmTile`から`DocTile.view`へ参照があり、破棄済みEditorView・本文・DOMを保持し得る。次のQuick Openが参照を置き換えるまで旧Editorが1件残る経路であり、無限件の蓄積は確認していない。

修正では、ダイアログを開いている間だけ復帰先を保持し、閉じる・記事を閉じる操作で参照を解放する。検索準備の非同期処理中はローカル変数だけで保持し、失敗や中断で永続参照を残さない。Escapeで接続中の本文へフォーカスが戻り、Cmd＋Pから別の記事へ切り替えられることをブラウザfixtureで確認した。型チェック0エラー・0警告、既存テスト10件成功。

画像URLは記事ごとに保持し、記事切り替えでrevokeする。Rust側に恒久的な画像キャッシュはない。TableWidgetが以前の本文スナップショットを保持する経路、検索PerformanceEntryの累積、revoke済みURL文字列・競合表示用本文が残る箇所もあるが、大きなIOSurface保持の原因とする根拠は得られていない。

## 以前の測定

単位はMiB。macOS `footprint`のSummary Footprintを、責任PIDが同じnative・WebContent・GPU・Networkingに限定して使う。共有領域の単純加算はしない。

| 診断ケース | アプリ合計 | 制約 |
|---|---:|---|
| 最小WKWebView | 約69.7 | Editor・Svelteを読み込まない |
| ソース表示 | 約126.2 | 同じ記事、画像なし |
| 画像なしLive Preview全スクロール | 最大329.9 → idle130.8 | 描画の増加は停止後に戻った |
| 画像あり全スクロール | 最大482.0 → idle251.4 →208.9 | 37/39枚、非表示前の値 |
| 39枚＋ソース表示＋URL解放 | 最大488.7 →267.4 →211.2 | 未解放の同時点対照がなかった |
| 以前の本体UIコピーの起動idle | 約147〜151 | 短い非表示履歴あり、今回のUIではない |
| 長時間使った以前の元アプリ | 約454.3、その後394.4 | 履歴を揃えて再現できていない |

これらは今回の新UIの通常使用量や性能目標の合否ではない。今回の調査開始時点ではNagori本体プロセスは起動していなかった。

## 実験環境と解釈

macOS 26.6.2、WebKit.frameworkのCFBundleVersionは21624.5.1.11.3。診断は専用ID・一時フォルダのコピーで行い、本物の記事や設定を変更しない。ブラウザfixtureのRAMをネイティブアプリの測定値にしない。

WebKitにはIOSurfaceの再利用プールと未使用surfaceをvolatileにする処理がある。ただし、公開mainのコードがこのMacのWebKitと同じとは確認できていない。回収可能になることと即座に物理メモリが消えることも区別する。[WebKitのIOSurfacePool実装](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/cg/IOSurfacePool.cpp)

## 生データ

- 前回の報告・サマリ：`/private/tmp/nagori-memory-investigation/diagnostic-report.md`、`diagnostic-summary.json`
- 以前の実験条件・専用bundle：`/private/tmp/nagori-memory-diag/README.md`
- 計測スクリプト：`/private/tmp/nagori-memory-investigation/measure.py`

一時フォルダの生データと記事コピーはGitへ登録しない。この報告には測定条件・要点を残す。
