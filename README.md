# Nagori

ローカルのブログ記事を書くための、macOS向けMarkdownエディタ。Tauri 2 / Svelte 5 / TypeScript / CodeMirror 6 / Rustで実装しています。

## 起動

Node.js 24、Rust 1.90以上、Xcode Command Line Toolsが必要です。

```sh
cd ~/Nagori
npm ci
npm run tauri dev
```

ローカル試用用のアプリは次のコマンドで生成します。

```sh
npm run tauri build
open src-tauri/target/release/bundle/macos/Nagori.app
```

ビルド対象はこのMacのApple Silicon（arm64）。バンドルの最低OS設定はmacOS 13、フロントエンドのビルド対象はSafari 16です。開発・確認環境はmacOS 26.6.2 / arm64であり、過去のmacOSやIntelで動作確認済みという意味ではありません。署名・公証・DMG・自動更新は外部配布時に追加します。

ユーザー提供の[デザイン参考](design/README.md)に合わせてUIを調整しています。File TreeとEditorの2ペインを維持し、白・濃紺・ミント／シアンの色、余白、アイコン、浮動ツールバーを取り入れます。

## 使い方

フォルダを開き、左のファイル一覧から記事を選択します。記事とフォルダの作成は一覧上部の＋・フォルダボタン、名前変更とゴミ箱への移動は右クリック（キーボードではShift＋F10）から。Inline RenameはEnterで確定、Escapeでキャンセルします。ファイル移動はFinderで行います。名前変更時のMarkdown参照の自動更新は行いません。

本文はLive Previewで表示し、カーソルや選択を含む要素のMarkdown記号を表示します。右上でソース表示に切り替えられます。選択時のツールバーで装飾し、記事メニューから画像を挿入できます。画像は記事の隣の`assets`へコピーされ、元画像と同名画像を上書きしません。

| 操作 | キー |
|---|---|
| ファイルを探す | Cmd＋P |
| 記事内を検索 | Cmd＋F |
| 保存 | Cmd＋S |
| 太字 / 斜体 / リンク | Cmd＋B / I / K |
| Undo / Redo | Cmd＋Z / Shift＋Cmd＋Z |

編集後500msで自動保存します。変換中のIME確定を待ち、切り替え・終了の前にも保存を完了します。保存失敗・競合・外部削除では本文を保持し、自動保存を停止します。状態表示の「対応する」から再試行、最新ディスク内容の採用、明示上書き、プロジェクト内への別名保存、破棄確認後の閉じる操作を選べます。

`.md`・`.markdown`のみ編集可能です。UTF-8・BOM・LF/CRLFを保持し、不正UTF-8・混在改行・2MiB超の文書は編集しません。画像はPNG/JPEG/GIF/WebP、20MiB以下・1,600万画素以下。外部URL画像・SVG・HTMLの実行・プロジェクト外やシンボリックリンク経由の参照は許可しません。`.git`・`node_modules`はツリー・検索から除外します。

## 検証

```sh
npm run check
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

2026-10-01時点：型チェック0エラー・0警告、Nodeテスト10件、Rustテスト3件、Releaseアプリのビルドが成功しています。Mac画面操作ツールがタイムアウトするため、実機操作の合格判定は保留です。

自動チェックは保存世代・直列化・消失時の停止・検索・パス・Markdown/Formatting、Rustの読み書き・競合・非上書き・画像安全性を確認します。日本語IME、全終了経路、実際のFinder・ゴミ箱、長文の操作感はネイティブアプリでの確認が必要です。自動テスト成功だけをもってそれらを検証済みとしません。

本文のクラッシュ復元、バックアップ、履歴、同期はありません。最初の試用は複製した記事で行ってください。受け入れ条件・実機確認の結果は仕様書と実装計画の検証記録を参照してください。

性能確認用に`performance`へ`nagori-ready`（起動時の初期処理完了）と`nagori-quick-search`（候補評価時間）を記録します。起動やWebViewを含むメモリ使用量はReleaseアプリで別途測定し、未測定項目を達成済みとは扱いません。
