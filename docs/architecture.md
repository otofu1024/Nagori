# アーキテクチャ

## 全体構成

NagoriはTauriのWebViewでSvelteの画面を動かす。画面は`src/App.svelte`が管理し、ファイル操作やアプリ設定はTauriのコマンドを通じてRustへ渡す。

```text
Svelte UI (src/App.svelte, src/lib/)
       │ Tauri invoke / app events
       ▼
Rust backend (src-tauri/src/lib.rs)
       ├── commands.rs   Tauriコマンドとワークスペースの状態
       ├── menu.rs       ネイティブメニューの組み立て
       ├── apple_quit.rs macOSの終了要求と保存待ち
       ├── files.rs      ワークスペース、文書、ファイル操作
       ├── image.rs      画像の検証、取り込み、表示用の縮小とキャッシュ
       │   └── image/imageio.rs macOSのImageIO
       ├── settings.rs   設定の型、検証、読み書き
       ├── search.rs     ワークスペース本文検索
       ├── trash.rs      アプリ内ゴミ箱と保存期限
       └── cli.rs        nagoriコマンドの登録と起動引数
```

## 主なファイル

`src/lib/editor/`にCodeMirrorとMarkdownの処理、`src/lib/workspace/`にファイル・保存・検索・設定の処理を置く。画面部品は`src/lib/components/`、採用したブランド画像は`src/lib/assets/`に置く。

| ファイル | 担当 |
|---|---|
| [App.svelte](../src/App.svelte) | 起動、画面の組み立て、各処理と状態の接続 |
| [Editor.svelte](../src/lib/editor/Editor.svelte) | CodeMirrorの生成と破棄、編集拡張、IME、目次とツールバーの接続 |
| [keymap.ts](../src/lib/editor/keymap.ts)、[toolbar.svelte.ts](../src/lib/editor/toolbar.svelte.ts)、[editor.css](../src/lib/editor/editor.css) | キー操作、装飾とリンク編集の状態、Editorのスタイル |
| [markdown.ts](../src/lib/editor/markdown.ts) | Markdown構文木の解析、差分解析、範囲の走査 |
| [markdownInline.ts](../src/lib/editor/markdownInline.ts)、[markdownFormat.ts](../src/lib/editor/markdownFormat.ts) | インライン記法と参照リンク、装飾の変更計画 |
| [livePreview.ts](../src/lib/editor/livePreview.ts)、[previewState.ts](../src/lib/editor/previewState.ts)、[previewContext.ts](../src/lib/editor/previewContext.ts) | Previewの拡張、表示とIMEの状態、解析結果の再利用 |
| [previewDecorations.ts](../src/lib/editor/previewDecorations.ts)、[previewBlocks.ts](../src/lib/editor/previewBlocks.ts)、[previewLists.ts](../src/lib/editor/previewLists.ts) | 装飾の組み立て、見出し・コード・引用・リストの表示 |
| [previewText.ts](../src/lib/editor/previewText.ts)、[previewTable.ts](../src/lib/editor/previewTable.ts)、[previewImage.ts](../src/lib/editor/previewImage.ts)、[previewMath.ts](../src/lib/editor/previewMath.ts) | 文字・区切り線・表・画像・数式のWidget |
| [markdownMath.ts](../src/lib/editor/markdownMath.ts)、[katex.ts](../src/lib/editor/katex.ts) | 数式の抽出、表示処理、KaTeXの遅延読み込み |
| [findPanel.ts](../src/lib/editor/findPanel.ts) | 記事内検索・置換のCodeMirror拡張 |
| [typingFormat.ts](../src/lib/editor/typingFormat.ts) | 太字・斜体の入力時処理と空記法の整理 |
| [focusMode.ts](../src/lib/editor/focusMode.ts) | 集中モードとタイプライター表示 |
| [QuickOpen.svelte](../src/lib/components/QuickOpen.svelte)、[navigation.ts](../src/lib/workspace/navigation.ts) | ファイル名・パス検索とQuick Openの候補 |
| [WorkspaceSearch.svelte](../src/lib/components/WorkspaceSearch.svelte)、[workspaceSearch.ts](../src/lib/workspace/workspaceSearch.ts) | ワークスペース本文検索の画面と検索処理 |
| [SidebarNav.svelte](../src/lib/components/SidebarNav.svelte)、[NoteList.svelte](../src/lib/components/NoteList.svelte)、[TrashList.svelte](../src/lib/components/TrashList.svelte) | サイドバーのナビ、ノート一覧、ゴミ箱一覧 |
| [noteLists.ts](../src/lib/workspace/noteLists.ts) | ノート一覧の並び、スター、閲覧記録 |
| [FileTree.svelte](../src/lib/components/FileTree.svelte)、[fileDrag.ts](../src/lib/workspace/fileDrag.ts) | ファイルツリー、名前変更、ワークスペース内移動 |
| [SettingsDialog.svelte](../src/lib/components/SettingsDialog.svelte)、[settings.ts](../src/lib/workspace/settings.ts) | 設定画面、値の初期値と読み込み時の検証 |
| [Outline.svelte](../src/lib/components/Outline.svelte)、[outline.ts](../src/lib/workspace/outline.ts) | 見出し一覧、現在位置、本文内の移動 |
| [appFlow.ts](../src/lib/workspace/appFlow.ts)、[session.ts](../src/lib/workspace/session.ts) | 切り替え・終了前の保存確認、文書の保存世代と競合状態 |
| [fileActions.ts](../src/lib/workspace/fileActions.ts)、[documentDialogs.ts](../src/lib/workspace/documentDialogs.ts) | 作成・名前変更・移動・ゴミ箱、保存問題と別名保存のダイアログ |
| [menus.ts](../src/lib/workspace/menus.ts) | メニューバーと右クリックメニューの処理 |
| [fontZoom.ts](../src/lib/workspace/fontZoom.ts)、[settingsDialog.ts](../src/lib/workspace/settingsDialog.ts) | 文字サイズの変更と保存の待ち時間、設定ダイアログの開閉とフォーカス復帰 |
| [image.ts](../src/lib/workspace/image.ts)、[imageDrop.ts](../src/lib/workspace/imageDrop.ts)、[imageLoader.ts](../src/lib/workspace/imageLoader.ts) | 画像の検証、挿入、貼り付け・ドロップ、URLと読み込み待ちの管理 |
| [lib.rs](../src-tauri/src/lib.rs) | モジュールとTauriコマンドの登録、アプリの起動とイベント |
| [commands.rs](../src-tauri/src/commands.rs) | Tauriコマンド、ワークスペースの状態、ファイル監視、起動要求 |
| [menu.rs](../src-tauri/src/menu.rs) | ネイティブメニューの組み立て |
| [apple_quit.rs](../src-tauri/src/apple_quit.rs) | macOSの終了要求を受け、保存が済むまで終了を待つ処理 |
| [files.rs](../src-tauri/src/files.rs) | 文書の読み書き、一覧、ファイル操作、パスとサイズの検証 |
| [image.rs](../src-tauri/src/image.rs)、[imageio.rs](../src-tauri/src/image/imageio.rs) | 画像の検証、取り込み、貼り付け、表示用の縮小とキャッシュ |
| [settings.rs](../src-tauri/src/settings.rs) | 設定の型、値の検証、設定ファイルの読み書き |
| [search.rs](../src-tauri/src/search.rs) | ワークスペース全体の本文検索 |
| [trash.rs](../src-tauri/src/trash.rs) | アプリ内ゴミ箱、復元、完全削除、期限切れ項目の処理 |
| [cli.rs](../src-tauri/src/cli.rs) | 起動引数の解釈とnagoriコマンドの登録処理 |

## 主なデータの流れ

### 編集と保存

`App.svelte`が文書を読み込み、本文と文書キーを`Editor.svelte`へ渡す。CodeMirrorの変更はAppへ通知され、自動保存の待ち時間が過ぎるとRustの保存コマンドを呼ぶ。`session.ts`は編集中・保存中の世代とディスク上の基準内容を持ち、古い保存結果や外部変更との競合を判定する。アプリの終了や切り替えは`appFlow.ts`を通し、IME確定と保存を待つ。

### Previewと編集拡張

`Editor.svelte`がCodeMirrorの拡張を組み合わせる。`markdown.ts`の構文木を`previewDecorations.ts`が装飾へ変換し、種類ごとのモジュールが表示を組み立てる。`livePreview.ts`は本文・選択・IMEの変化に合わせて装飾を更新する。Previewは同じEditorViewを使い、読み取り専用として編集を止める。記事内検索は`findPanel.ts`、入力中の太字・斜体処理は`typingFormat.ts`、集中表示は`focusMode.ts`が担当する。

### ワークスペース機能

AppはRustからファイル一覧を読み込み、`SidebarNav.svelte`の選択に応じてFile Tree、ノート一覧、ゴミ箱を表示する。本文検索は`WorkspaceSearch.svelte`から`workspace_search`コマンドを呼び、Rustの`search.rs`が対象ファイルを走査する。削除、復元、完全削除はRustの`trash.rs`が処理する。

### 数式の試験実装

数式はKaTeX 0.19.0で描画する。数式Widgetを初めて表示する時にエンジンとCSSを読み込み、フォントもVite経由で同梱する。数式のためのCDNや外部通信は使わない。読み込み済みのモジュールとCSSはアプリ終了まで残る。

文書の本文が変わるたびにマクロを作り直す。`globalGroup`を有効にし、`\newcommand`を文書内の後続の数式で使えるようにする。式番号は全文の順序で固定し、表示範囲によって番号が変わることを防ぐ。設定は[KaTeXのOptions](https://katex.org/docs/options)を参照できる。

`trust: false`、`maxSize: 20`、`maxExpand: 1000`を指定する。数式ごとの例外を受け止め、ソースと「（数式エラー）」を表示する。HTML属性やリンク、外部画像を扱うコマンドはKaTeXが拒否し、赤いコマンド名として表示する。指定寸法が20emを超えた場合はKaTeXの上限で表示する。文書の数式は先頭から数えて4096個、合計262,144文字までを描画し、超えた分の数式だけを「この文書の数式表示上限を超えました」の数式エラーにする。

`aligned`、`cases`、`matrix`、`\underbracket`、`\tag`、自動式番号はテストで確認した。`multlined`、`\label`、`\ref`、`\eqref`は未対応で、前方参照も解決しない。環境内の手動タグはHTMLに表示されるが、KaTeXのMathMLには出ない。自動番号と手動タグが混じる環境では、誤った番号を避けるためMathMLの番号も省く。

出力は読み上げ用のMathMLを含む。HTMLのみとの差をmacOSの実メモリで測ってから出力方式を決めるため、現在はMathMLを残している。試験の進捗と未計測の項目は[メモリ測定](performance/memory.md)に記録する。KaTeXの採用はユーザーが比較結果を見て判断する。

## テストの配置

`tests/editor/`はMarkdownの解析・装飾・キー操作・IME・表示拡張を、`tests/workspace/`は保存・ファイル操作・一覧・検索・設定を確かめる。ファイル名はソースと同じcamelCaseにそろえる。リストの字下げ・継続・記号は`listEdit.test.ts`、保存世代と失敗時の処理は`session.test.ts`へまとめる。Previewの共通設定は`previewFixture.ts`に置く。

`tests/editor/*.test.ts`と`tests/workspace/*.test.ts`はNode標準のテストランナーで動き、`npm test`が全件実行する。WKWebView上のIME、入力装飾、インラインコード確認は[`tests/wkwebview`](../tests/wkwebview/README.md)で手動実行する。WKWebView用の`.js`と`.html`は`npm test`の対象に含まれない。Rustの単体テストは各Rustモジュールに置き、`cd src-tauri && cargo test`で実行する。
