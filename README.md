# Nagori

Nagoriは、macOS向けのMarkdownエディタ兼プレビューアです。ローカルのノートをLive Previewで編集し、Markdownのまま保存できます。

## ビルドして起動する

開発とビルドにはNode.js 24、Rust 1.90以上、Xcode Command Line Toolsが必要です。対象はApple SiliconのmacOSで、最低対象をmacOS 13に設定しています。

```sh
git clone https://github.com/otofu1024/Nagori.git
cd Nagori
npm ci
npm run tauri dev
```

アプリをビルドする場合は、次を実行します。

```sh
npm run tauri build
open src-tauri/target/release/bundle/macos/Nagori.app
```

## 主な機能

| 領域 | 機能 |
|---|---|
| 編集 | Live Preview、Preview、太字、斜体、取り消し線、リンク、インラインコード |
| リスト・表 | リストの字下げ、TabとEnterによる表のセル移動 |
| 検索 | 記事内の検索と置換、ワークスペース全体の本文検索 |
| 画像 | 画像の貼り付け、Finderからのドロップ、`assets`への保存 |
| Markdown | コードの色分け、LaTeX数式、見出しから作る目次 |
| ノート管理 | すべてのノート、スター付き、最近見たノート、ゴミ箱、ドラッグ移動 |
| 表示・設定 | 集中モード、タイプライター表示、テーマ、本文の文字サイズ（拡大縮小で変更可）・幅・行間・字体、自動保存、起動時の表示、目次、最近見たノートの件数、ゴミ箱の保存期限 |

## キー操作

| 操作 | キー |
|---|---|
| フォルダを開く | Command+O |
| 記事を作成 | Command+N |
| ファイル名・パスで検索 | Command+P |
| 記事内を検索・置換 | Command+F |
| ワークスペース全体を検索 | Command+Shift+F |
| 保存 | Command+S |
| 太字・斜体 | Command+B / Command+I |
| 選択した文字にリンクを付ける | Command+K |
| Live PreviewとPreviewを切り替える | Command+Shift+L |
| 集中モード | Command+Shift+J |
| タイプライター表示 | Command+Shift+T |
| 本文の文字サイズを大きく・小さく・標準に戻す（拡大縮小の設定がオンの時） | Command+= / Command+- / Command+0 |
| 設定を開く | Command+, |
| リストの字下げ・解除 | Tab / Shift+Tab |
| Undo・Redo | Command+Z / Shift+Command+Z |

同じ操作はメニューバーや本文の右クリックメニューからも選択可能です。

## ターミナルから開く

Nagori.appを`/Applications`または`~/Applications`へ移動して一度起動し、アプリメニューから「nagoriコマンドを登録…」を選びます。

```sh
nagori .
nagori article.md
nagori "drafts/article.md"
nagori --help
```

引数なしは現在のフォルダを開きます。記事のパスを指定すると、その記事を選択します。

## 開発者向け

```sh
npm run check
npm test
(cd src-tauri && cargo test)
npm run build
```

仕様と開発資料は[docs](docs/README.md)、Macアプリの確認手順は[リリースチェックリスト](docs/release-checklist.md)を参照してください。
