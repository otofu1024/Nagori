# アーキテクチャ

## 全体構成

NagoriはTauriのWebViewでSvelteの画面を動かす。画面は`src/App.svelte`が管理し、ファイル操作やアプリ設定はTauriのコマンドを通じてRustへ渡す。

```text
Svelte UI (src/App.svelte, src/lib/)
       │ Tauri invoke / app events
       ▼
Rust backend (src-tauri/src/lib.rs)
       ├── files.rs   ワークスペース、文書、画像、設定
       ├── search.rs  ワークスペース本文検索
       ├── trash.rs   アプリ内ゴミ箱と保存期限
       └── cli.rs     nagoriコマンドの登録と起動引数
```

## 主なファイル

| ファイル | 担当 |
|---|---|
| [App.svelte](../src/App.svelte) | 起動、ワークスペースと選択中のファイル、保存状態、アプリイベント、ダイアログを管理 |
| [Editor.svelte](../src/lib/Editor.svelte) | CodeMirrorの生成と破棄、編集拡張、IME、ツールバー、目次との連携 |
| [markdown.ts](../src/lib/markdown.ts) | Markdown構文木の解析と範囲の走査 |
| [livePreview.ts](../src/lib/livePreview.ts) | Markdownの装飾、表・画像・数式のWidget、Preview専用表示 |
| [markdownMath.ts](../src/lib/markdownMath.ts)、[mathjax.ts](../src/lib/mathjax.ts) | 数式の抽出、表示処理、MathJaxの読み込み |
| [findPanel.ts](../src/lib/findPanel.ts) | 記事内検索・置換のCodeMirror拡張 |
| [typingFormat.ts](../src/lib/typingFormat.ts) | 太字・斜体の入力時処理と空記法の整理 |
| [focusMode.ts](../src/lib/focusMode.ts) | 集中モードとタイプライター表示 |
| [QuickOpen.svelte](../src/lib/QuickOpen.svelte)、[navigation.ts](../src/lib/navigation.ts) | ファイル名・パス検索とQuick Openの候補 |
| [WorkspaceSearch.svelte](../src/lib/WorkspaceSearch.svelte)、[workspaceSearch.ts](../src/lib/workspaceSearch.ts) | ワークスペース本文検索の画面と検索処理 |
| [SidebarNav.svelte](../src/lib/SidebarNav.svelte)、[NoteList.svelte](../src/lib/NoteList.svelte)、[TrashList.svelte](../src/lib/TrashList.svelte) | サイドバーのナビ、ノート一覧、ゴミ箱一覧 |
| [noteLists.ts](../src/lib/noteLists.ts) | ノート一覧の並び、スター、閲覧記録 |
| [FileTree.svelte](../src/lib/FileTree.svelte)、[fileDrag.ts](../src/lib/fileDrag.ts) | ファイルツリー、名前変更、ワークスペース内移動 |
| [SettingsDialog.svelte](../src/lib/SettingsDialog.svelte)、[settings.ts](../src/lib/settings.ts) | 設定画面、値の初期値と読み込み時の検証 |
| [Outline.svelte](../src/lib/Outline.svelte)、[outline.ts](../src/lib/outline.ts) | 見出し一覧、現在位置、本文内の移動 |
| [appFlow.ts](../src/lib/appFlow.ts)、[session.ts](../src/lib/session.ts) | 切り替え・終了前の保存確認、文書の保存世代と競合状態 |
| [image.ts](../src/lib/image.ts)、[imageDrop.ts](../src/lib/imageDrop.ts) | 画像の検証、挿入、貼り付け・ドロップ |
| [lib.rs](../src-tauri/src/lib.rs) | Tauriコマンドの登録、ネイティブメニュー、アプリの起動とイベント |
| [files.rs](../src-tauri/src/files.rs) | ファイル入出力、一覧、設定、画像の検証と取り込み |
| [search.rs](../src-tauri/src/search.rs) | ワークスペース全体の本文検索 |
| [trash.rs](../src-tauri/src/trash.rs) | アプリ内ゴミ箱、復元、完全削除、期限切れ項目の処理 |
| [cli.rs](../src-tauri/src/cli.rs) | 起動引数の解釈とnagoriコマンドの登録処理 |

## 主なデータの流れ

### 編集と保存

`App.svelte`が文書を読み込み、本文と文書キーを`Editor.svelte`へ渡す。CodeMirrorの変更はAppへ通知され、自動保存の待ち時間が過ぎるとRustの保存コマンドを呼ぶ。`session.ts`は編集中・保存中の世代とディスク上の基準内容を持ち、古い保存結果や外部変更との競合を判定する。アプリの終了や切り替えは`appFlow.ts`を通し、IME確定と保存を待つ。

### Previewと編集拡張

`Editor.svelte`がCodeMirrorの拡張を組み合わせる。`markdown.ts`の構文木を`livePreview.ts`が装飾へ変換する。Previewは同じEditorViewを使い、読み取り専用として編集を止める。記事内検索は`findPanel.ts`、入力中の太字・斜体処理は`typingFormat.ts`、集中表示は`focusMode.ts`が担当する。

### ワークスペース機能

AppはRustからファイル一覧を読み込み、`SidebarNav.svelte`の選択に応じてFile Tree、ノート一覧、ゴミ箱を表示する。本文検索は`WorkspaceSearch.svelte`から`workspace_search`コマンドを呼び、Rustの`search.rs`が対象ファイルを走査する。削除、復元、完全削除はRustの`trash.rs`が処理する。

## テストの配置

`tests/*.test.ts`はNode標準のテストランナーで動き、`npm test`が実行する。WKWebView上のIME、入力装飾、インラインコード確認は[`tests/wkwebview`](../tests/wkwebview/README.md)で手動実行する。WKWebView用の`.js`と`.html`は`npm test`の対象に含まれない。Rustの単体テストは各Rustモジュールに置き、`cd src-tauri && cargo test`で実行する。
