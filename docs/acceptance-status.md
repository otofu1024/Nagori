# Nagori MVP 検証状況

更新：2026-10-02。仕様§16のmacOSでの合格判定は保留。コード・実Macの一時ファイル・ブラウザ検証で確認できた範囲と、ネイティブ画面で残る確認を分けて記録する。

## 閲覧専用Preview・nagoriコマンド（2026-10-02）

- 表示切り替えはLive Preview / Preview。Live Previewの編集動作を維持し、Previewでは選択・検索位置に関係なく装飾・表・画像・数式を表示する。本文入力、貼り付け、Formatting、Undoによる本文変更、タスクの変更、画像挿入を無効にする。検索・選択・コピーは使える。
- 同じEditorStateを使って切り替え、本文・保存状態・Undo履歴を変更しない。切り替え時に選択を保持し、スクロールを復元する処理を追加した。ネイティブ画面でのスクロール位置・クリック・コピーは未検証。ファイルの読み取り専用状態と処理中のUIロックを分け、Live Previewの画像挿入APIは処理中も使えるようにした。
- macOSの`nagori`コマンドを`~/.local/bin/nagori`に登録。`nagori .`は現在のフォルダ、`nagori test.md`は現在のフォルダと対象ファイルを開く。`open`で渡された要求をRustに保持し、起動時に前回Workspaceの復元より優先する。起動後の切り替えは既存のIME待機・保存処理を通す。別名保存後と通知の重なりで要求を取り残さないようにした。
- 型チェック0エラー・0警告、Node26件・Rust7件、シェル構文チェック成功。Previewの選択による記法露出防止、編集禁止、戻った後のUndoと既存readonly設定の保持を確認した。CLIは模擬`open`で日本語・空白・特殊文字・ネスト・シンボリックリンクの引数を確認し、RustでURL・範囲外・除外パスと要求キューを検証した。インストール済みコマンドの`--help`も成功。
- Releaseビルドと`codesign --verify --deep --strict`成功。Nagori.appは15.35MiB（16,090,893 bytes）。新しい依存や常駐サーバーは追加していない。PreviewとCLIを合わせた実際のmacOS起動・記事選択・保存失敗時の切り替え、およびRAMの再計測は未実施。起動中のユーザーアプリや記事・設定を検証操作で変更していない。

以下は各変更時点の記録であり、直前のビルドの性能値ではない。

## MathJax対応・タイトルバー統合（2026-10-02）

既存Markdownの数式を読む用途にMathJax 4.1.3を追加。インライン・表示式、表、引用・リスト内の複数行式、AMS／mathtools／newcommand、式番号・ラベル・前方参照に対応する。数式は本文全体から順に収集し、まだ画面へ出していない末尾のラベルも解決する。同一本文のCodeMirror部分解析更新では数式の解析・描画結果を再利用する。記事単位で番号・マクロを初期化する。同一式がマクロ定義の前後に現れても、定義前のエラーを定義後の式へ流用しない。

- 型チェック0エラー・0警告、Node24件・Rust6件成功。MathJaxの前方参照・記事間分離、不正式・外部取得命令・数式トークンの任意CSS／URL／フォント属性・再帰マクロ・寸法上限（割合やinfinity指定も含む）、元の本文とUndo、IME中のプレビュー維持を確認した。
- 数式が必要になるまでエンジンを読み込まない。全フォント・追加フォントデータをローカルへ同梱。前のブラウザ検証で、数式なしの記事では数式資産を取得せず、製品と同じCSP下で数式・ローカルフォントを表示でき、error／warnがないことを確認した。非Tauriの一時fixtureでありWKWebViewの合格判定にはしない。最終ソースへの更新後に予定した記事切り替えの追加操作はブラウザURLのポリシー拒否で完了していない。Nodeで記事間の分離を確認したことと区別する。
- MathDocument・共有出力器・マクロマップの前の記事への参照を解放し、切り替え後に古い非同期結果をDOMへ反映しない。一度読み込んだエンジンやフォントモジュール自体のアンロードはしない。実機のRAM増分・長時間使用は未測定。
- macOSタイトルを非表示にしてOverlayを使い、交通信号ボタンとロゴを同じ68pxヘッダーに置く。上部の空き領域をTauri標準のドラッグ領域に指定した。前の最小幅720pxブラウザ確認では保存状態／読み取り専用／問題対応ボタンが収まった。非表示AppKit検証窓でfull-size contentとボタン中心34pxを確認したが、実Nagoriのドラッグ・最大化・フルスクリーン復帰は未確認。
- macOS Releaseビルド成功。Nagori.appは15.35MiB（16,091,933 bytes）、`codesign --verify --deep --strict`成功。JavaScript初期チャンク638,049 bytes、遅延MathJax555,594 bytes、フォントデータ41チャンク544,073 bytes、WOFF2フォント105件1,623,040 bytes。これらは配布サイズでありRAM使用量ではない。500kB超チャンクのVite警告は残る。

以下の以前のチェック・性能値はMathJaxとタイトルバー統合前の記録であり、今回のビルドの性能値として使わない。

## 以前の修正とチェック（54fabdd）

外部本文の読み取りを待っている間にIME変換が始まると、画面へ反映できない本文をセッションだけにReloadしてしまう競合を修正した。読み取り後にも変換状態を確認し、外部更新・読み取りエラー・画像更新は変換終了後に再確認する。検索ごとに蓄積していたPerformanceEntryも削除した。この削除のRAM削減量は未計測。

- Node 16件、Rust 6件成功。型チェック0エラー・0警告。macOS Releaseビルドと再bundle成功、最終Nagori.appは13.52MiB。
- Macの一時フォルダで親フォルダ・大小文字だけのRename後の保存、BOM／CRLF／mode0640保持、同名ファイル／フォルダの非上書き、Workspace消失・復帰後の比較基準チェックを確認。ユーザーの記事・設定・ゴミ箱には触れていない。
- 実Appを使う一時ブラウザfixtureで、外部読み取り保留 → 本文変更前に変換開始 → 読み取り再開 → 日本語確定を実行。変換中のReloadを保留し、確定後は入力を保持して競合表示となり、外部内容は上書きされなかった。ブラウザerror/warnなし。遅延IPC・OSのIMEは模擬で、実ファイルへの保存を含まない。

## ローカル用アプリの署名整合

最初のbundleに対する `codesign --verify --deep --strict` は「code has no resources but signature indicates they must be present」で失敗した。Mach-Oのlinker署名だけが残り、アプリ全体のCodeResourcesが生成されていなかった。

Tauriの `bundle.macOS.signingIdentity` を `-` に指定し、以後のローカルビルドでもアプリ全体にad-hoc署名を付ける。[Tauri公式の設定](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)。再bundle後のstrict検証は成功し、Identifierは `app.nagori.editor`、Info.plistと `Resources/icon.icns` を含むCodeResourcesも確認した。証明書・公証情報・GUI操作は使用していない。これは外部配布用のDeveloper ID署名・公証とは別のローカル試用用設定。

## 受け入れ条件ごとの現在地

| §16 | 確認できた範囲 | 残るネイティブ確認 |
|---|---|---|
| 1 作成・検索・保存・復帰 | ファイルAPI、ブラウザの作成／Quick Open、設定roundtrip | 終了→再起動で前回のプロジェクト・記事へ復帰 |
| 2 原文保持 | RustでBOM／CRLF／空白と無編集保存、表示変更とUndoのNodeチェック | アプリから無編集保存したバイト列の確認 |
| 3 Markdown・未対応記法 | 構文・Front Matter・Raw HTMLの原文保持、実Editorのブラウザ表示 | 実記事での未完成記法・長文編集 |
| 4 IME・基本編集・Undo | 変換中の装飾維持／本文同期、Formatting、保存世代とUndo | Mac IME候補・キャンセル・再変換、コピー／貼付／Redo |
| 5 選択・表・画像 | 選択境界のNodeチェック、変換中の画像／表DOM維持 | WKWebViewでクリック・複数行選択・スクロール位置 |
| 6 画像挿入 | Rustで形式・上限・同名非上書き、相対参照生成 | 実画像の選択・挿入・プレビュー・Undo |
| 7 保存世代 | 連続編集・並行flush・変換中開始・失敗時の最新本文保持 | 編集直後の切替・終了とディスク保存の一連操作 |
| 8 保存失敗・救済 | Rustのstaging失敗／readonly、Nodeの共有flush失敗、別名救済API | 保存失敗UIの再試行・別名保存・終了停止 |
| 9 外部更新 | Rustの比較基準チェック、遅延読み取りとIME競合のブラウザ再現 | OS監視通知、自分の保存通知、実ファイルReload／競合UI |
| 10 外部削除 | ファイル／Workspace消失時に再作成せず、復帰後も再比較 | 外部Rename／削除とUI・監視の復帰 |
| 11 Rename・ゴミ箱 | Mac実ファイルで親／case-only Rename・同名拒否後の保存 | アプリのパス更新、Finder表示、OSゴミ箱と失敗時保持 |
| 12 安全性 | UTF-8／上限／画像／symlink／範囲外参照をRust、HTML非実行をNodeで確認 | アプリの各エラー表示を確認 |
| 13 キーボード・状態表示 | ブラウザでQuick Open／Formatting／状態表示、終了経路の共通flushをコード確認 | Cmd＋Q／Cmd＋W／閉じるボタン／Dock終了、キーボード一連操作 |
| 14 性能 | 下記の固定ブラウザデータ計測、起動中アプリのメモリ観測 | WKWebViewで固定条件の起動・入力・検索・Idle／長時間メモリ |

## 固定データでの参考性能

Apple M4／RAM32GiB／macOS26.6.2、IAB Chrome154、1280×720px、DPR2、可視状態。Vite production build／Safari16 target、実App・Editor・CodeMirrorを使用し、TauriのI/Oだけ一時的なメモリ内fixtureへ置換した。

記事は102,400 UTF-8 bytes／55,974 JavaScript文字。日本語・英語、見出し、リスト、表、コード、画像記法を含む。990 Markdown＋10画像で1,000ファイル、フォルダ21件は別。画像は共有1×1 PNGであり、実画像のデコード負荷を代表しない。3回のウォームアップ後、各20回測定し、本文の文字数増加と検索候補全パスの一致も確認した。

| 測定 | 中央値 | p95 |
|---|---:|---:|
| 確定済み日本語1文字のDOM入力→2回のrequestAnimationFrame | 33.30ms | 33.50ms |
| 実Quick Open入力→候補DOM確認→2回のrequestAnimationFrame | 32.85ms | 33.10ms |
| 候補計算だけの参考値 | 0.45ms | 1.10ms |

2回のrequestAnimationFrameは描画機会の代理値で、約2フレームの待ち時間を含む。物理画面への描画完了、OSキー入力、IME、WKWebView、実ファイルI/O・IPC、コールド起動を測った値ではない。Mac実機の目標合否には使用しない。全生データ・データhash・ソースhash・ビルド条件は[performance-baseline.json](performance-baseline.json)。起動中アプリの175MiB前後の観測も条件未固定のため目標合否には使わない。[メモリ調査](memory-investigation.md)

一時fixtureの再実行手順は `/private/tmp/nagori-ui-preview/PERFORMANCE.md`。`performance-metadata.py` → Vite production build → preview → CUAで測定ボタン、の順で行う。外部更新とIMEの再現は同フォルダの `external-ime.html`、画面記録は `external-ime-guard.jpg`。これらは一時検証用で製品に同梱しない。

## 残る実機確認の順序

複製した記事で、保存失敗・外部更新・削除と終了停止 → 各終了経路と再起動 → IME・表・画像・Undo → Rename・Finder・ゴミ箱 → 固定条件の性能・長時間メモリ、の順に確認する。Mac画面操作ツールのAX取得が過去に長時間応答しなかったため、今回はネイティブ画面操作を再試行していない。ブラウザやRustの成功を、その代わりの合格判定にはしない。Gitのremoteは未設定。
