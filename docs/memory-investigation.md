# メモリ調査（2026-10-02）

## 最新の測定結果

Releaseソース9528951を専用識別子app.nagori.editor.qa20261002のアプリで測定した。数式なしの記事は約142MiB、数式の記事は約247MiBだった。通常記事へ戻した後は約206〜301MiBの間で変動し、初期値まで戻るかは確認できていない。100MiBの目標は今回も未達。メモリリークと断定できる証拠は得ていない。

Apple M4、RAM32GiB、macOS26.6.2、WebKit21624.5.1.11.3。新PID19030でLight・本文19px・窓1120×800を固定し、通常記事、数式、同じ通常記事の順に1回測り直した。各段階は30秒待機後、5秒間隔で13サンプル。設定と窓を毎回の前後に確認し、本文SHAも確認した。描画完了、窓の遮蔽、Editorのフォーカスは未確認。

| 状態 | 中央値MiB | 最小〜最大MiB | 最終MiB |
|---|---:|---:|---:|
| 起動後の通常記事 | 142.38 | 142.32〜142.50 | 142.33 |
| 数式の記事 | 246.96 | 246.91〜246.97 | 246.97 |
| 同じ通常記事へ戻した後 | 264.41 | 205.83〜300.55 | 205.83 |

戻した後の区間は安定していない。最終205.83MiBを定常Idle値やMathJaxの常駐コストとは扱わない。最後のサンプルではIOSurface Dirtyが約31.16MiB、WebKit malloc Dirtyが約97.67MiB。初期の約31.20MiB・53.72MiBと比べるとWebKit malloc側の増加が残る。ただし、この区分だけでJavaScriptの生存オブジェクト、フォント、割当済み領域を区別できない。

同じ責任PIDのnative、WebContent、GPU、Networking、AudioToolbox SandboxHelperを対象に、macOSのfootprintを1回の呼び出しで採取する。戻し段階で加わったSafariPlatformSupport Helperも含めた。共有領域を重複加算しないSummary Footprintを使い、Reclaimableは占有量へ足していない。WebContentの累積CPU時間は各約60秒で0.01秒、2.62秒、1.26秒増加した。CPUが飽和する継続負荷は観測しなかったが、低頻度の再描画や短い負荷は否定できない。

Workspaceは990Markdown・10画像の1,000ファイル。通常記事は102,401 UTF-8 bytesで、元の100KiBから前の操作で1byte増えた状態。再測定の前後では同じSHAを保持した。数式記事は主な式50個と補助のインライン式2個、計4,240bytes。実際の描画式数は未確認。画像記事は1280×720の画像10枚を参照するが、全画像のスクロール・デコード確認はしていない。

最初の測定にはユーザーの切り替え操作が入り、テーマや履歴、本文が変わった。最大661.96MiBという観測は保存するが、初期値を含め目標の合否や数式だけの増分には使わない。再測定ではこの変動を再現していない。過去の調査やObsidianとの比較とも条件が異なるため、削減量は算出しない。

コード上ではMathJaxと読み込み済みフォントデータ、生成CSSが残る。一方、記事のMathDocument・式・表への参照とCodeMirrorのmountは解放する。全数式widgetが一度撤去されると結果を破棄するため、本文不変でも再表示時に全式を処理する経路がある。実測中に繰り返しているかは不明。次はrenderMathの開始回数とmountが0になる回数を記録し、この経路とWebKitの保持を分けて確認する。今回、原因未確定のまま描画処理を変更していない。

全117サンプル、条件、CPU、PID、カテゴリ、ソース・本文・実行ファイルのSHAは[performance-macos.json](performance-macos.json)に保存した。ソースhashは各段階で一致。開始時のGit HEADが6168f15と記録された段階も、実装スナップショットは9528951と同じ。QAの実行ファイルSHAは7566ed8a55bfcd96c8aaff748599d59055eb27fc7dc75d7ae37060386e7a0fff。製品と違う識別子とタイトルで設定を分けている。

QAだけへ終了シグナルを送り、責任PIDのプロセスも終了した。これは通常の終了保存の検証ではない。通常Nagoriの設定SHAは開始前後で一致。通常PID12909は最後には存在しなかったが、終了時点と理由は未確認。調査で通常アプリへ終了操作はしていない。

詳細な一時ログは/private/tmp/nagori-qa-20261002。以下は以前の調査記録。

## 2026-10-01までの結論

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


## UI変更後の追加観測：URL保持の対照ケース

`80f90cf`のEditor・CSSを固定した専用診断アプリで、39枚を読み込み、約116秒でソース表示へ切り替えた。終了までBlob URL39件を保持し、revokeは行っていない。本体UI全体を再現する診断ではなく、Quick Openも使わないので`ce13132`の参照解放修正の効果測定ではない。

| 採取できた範囲 | Summary Footprint |
|---|---:|
| スクロール中の最大サンプル | 483.9MiB |
| 約180秒 | 約202.6MiB |
| 終了直前の最終サンプル | 約182.3MiB |

WebContentのuntagged VM_ALLOCATE(graphics)は約105.1MiBから約56.4MiBへ減少し、最終サンプルのIOSurface Dirty列は約7.7MiB、Reclaimable列は約264.2MiBだった。DirtyとReclaimableを足してfootprintとは呼ばない。URLをrevokeしなくても、ソース表示へ切り替えた後に描画メモリが減るケースを観測した。URL解放だけに原因を求める根拠は弱まるが、DOMから画像を除いた効果・時間経過・WebKitの回収をこの一回で区別できない。

native PID92653、WebContent92656、GPU92654、Networking92655に限定して計測。起動時viewport1120×768、DPR2、Editorの高さ608pxだったが、ソース切り替え後の約136秒にはviewport1024×768へ変わっていた。約24.1〜26.1秒と26.6〜26.9秒に非表示になり、その後は終了まで可視だった。採取は約35.7〜214.8秒の36サンプルに限られ、起動idleや全期間の最大値は主張しない。

計画したURL解放ケースとの比較は未実施。CUAのMac起動・AX取得が、30秒指定に反して長時間応答せずtimeoutになった。起動自体は遅れて成功したため片側の記録を回収できたが、可視履歴・viewport固定の条件を満たさず、厳密な対照比較は成立していない。GUI操作の再試行を止め、診断アプリの約219秒後の自動終了まで記録した。

- 実験条件：`/private/tmp/nagori-memory-matched/README.md`
- 可視状態・39枚読み込み・URL保持の記録：`/private/tmp/nagori-memory-matched/runs/retain-92653.jsonl`
- footprint生データ：`/private/tmp/nagori-memory-investigation/matched-retain-1/`
- 詳細な追加報告：`/private/tmp/nagori-memory-investigation/2026-10-01-ui-followup.md`

新しい本体UIの通常使用量、Quick Open修正による削減量、以前の約222MiBの共有IOSurface残存の真因は、引き続き未確認。


## 最新の起動中アプリ：操作せず採取した値

2026-10-01 22:48:00〜22:49:02 JSTに、ユーザーが試用していたNagoriから13サンプルを約5秒間隔で読み取った。native PID97510、responsible WebContent97513／GPU97511／Networking97512を限定し、共有領域を重複加算しないSummary Footprintは174.61〜174.71MiB、中央値174.63MiBだった。採取開始時は起動から約8分37秒。アプリや記事を操作せず、設定も変更していない。

最終サンプルの個別footprintはWebContent96.52MiB、native53.45MiB、GPU19.64MiB、Networking5.30MiB。WebContentのDirty列はIOSurface約34.94MiB、untagged VM_ALLOCATE(graphics)約0.70MiB、WebKit malloc約42.66MiBだった。IOSurface Reclaimable約291.28MiBはDirty・Summaryへ加えて占有RAMとは扱わない。

この約1分の時間帯には以前のWebContent graphics約332MiBの残存値は再現していない。ただし、表示記事・画像数・操作履歴・window実寸・可視状態・idle条件を確認していないため、通常baselineや100MB目標の判定、以前との差の改善量には使わない。Quick Open参照解放の効果や、並行して修正中のIME問題の効果も未測定。

確認時のソースHEADは`b100283f7eed6039b2886faaed9d3ccd4e0c2d0c`でgit clean。App／Editor／Live Preview／CSSのSHAとディスク上のbundle実行ファイルSHAを生データへ保存した。計測対象はIME修正反映前の起動プロセスとして扱う。macOS26.6.2、WebKit21624.5.1.11.3。

固定条件の最新専用コピーは、ネイティブGUI起動のAX取得が以前長時間ブロックしたため今回は起動せず未測定。ブラウザRAMや旧診断binaryの値を最新本体の値として代用していない。collectorとvmmapは終了済みで、調査用常駐プロセスは残していない。

- 13サンプルと生footprint：`/private/tmp/nagori-memory-investigation/live-b100283-1/`
- 条件・PID・ソースhash・binary hash：同フォルダの`inventory.json`
- 集計・短い報告：同フォルダの`summary.json`、`report.md`
- 読み取りの補足分類：同フォルダの`webcontent-vmmap-summary.txt`、`native-vmmap-summary.txt`


## MathJax追加後（2026-10-02）

MathJaxは数式を表示する時だけ読み込み、記事ごとのMathDocument・出力器が持つ文書／式／表への参照とマクロマップを解放する。古い記事の非同期結果は表示しない。エンジンと読み込み済みフォントモジュールは実行環境のキャッシュに残る。この変更は既存のWebKit描画メモリ問題の解決を示すものではない。

Releaseの初期JSは638,049 bytes、遅延MathJaxは555,594 bytes、フォントデータ544,073 bytes、WOFF2は1,623,040 bytes。配布サイズをRAM増分へ換算しない。数式なし／数式あり／記事切り替え後の固定条件での実機メモリは未測定。上記の174.63MiB等はMathJax追加前の別ビルドの観測値。
