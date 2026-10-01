# Nagori デザイン参考

2026-10-01にユーザーが提供したブランド・UIイメージ。実装時の参考資料として原画像をそのまま保存する。

- `brand-reference.png`: アプリアイコン・ロゴ・Light / Dark / Glyphのイメージボード。
- `ui-reference.png`: アプリ全体のUIイメージ。

## 取り入れる視覚要素

白〜淡い青を基調とし、本文・見出しは濃紺、アクセントはミント〜シアン。細い境界線、柔らかな角丸、控えめな影を使う。本文は落ち着いた見た目を維持する。

## 採用範囲（ユーザー確認済み）

ユーザーは「既存の2ペイン構成のまま、色・余白・アイコン・ツールバーのデザインを取り入れる」を選択した。File TreeとEditorの構成を維持し、右ペイン、Starred、Trash一覧、タグ管理、全文検索は追加しない。上部検索は現行Quick Openのファイル名・パス検索に対応させ、ファイル内Findも維持する。

2026-10-01の追加依頼により、ブランド画像からimagegenで透過素材を作成して組み込んだ。ヘッダーはLightアイコンと画像内のNagoriワードマークを使用し、ダークテーマでは文字色を明るくした同形状の素材へ切り替える。macOSのアプリアイコンは画像内のDark App Iconを使用する。元画像と生成元PNG、使用プロンプトはこのdesignフォルダに保存する。

デザイン実装では参考画像全体を画面背景として読み込まず、色・余白・角丸をCSSで表現する。右ペインの本文・画像を常時二重描画する構成は、採用範囲とメモリへの影響を確認してから決める。

## ブランド素材

生成には内蔵imagegenを使用。生成PNGのalphaを維持し、ヘッダー用は108×108pxのアイコンと324×108pxのワードマーク2種へ縮小した。UIで読み込むのはこの3ファイルだけで、合計の非圧縮RGBA画素量は約0.31MiB。大きな生成元や参考ボードはUIから読み込まない。

- `src/lib/assets/nagori-icon.png`: ヘッダー用Lightアイコン。
- `src/lib/assets/nagori-wordmark.png`: 濃紺のワードマーク。
- `src/lib/assets/nagori-wordmark-dark.png`: 淡色のワードマーク。
- `src-tauri/icons/icon.icns` / `icon.png`: macOS用Darkアプリアイコン。Tauri CLIで生成。
- `design/brand-assets/`: 透過生成元PNG。
- `design/brand-prompts.json`: 採用素材の最終プロンプト。

生成による透過素材化のため、原画像の画素をそのまま切り出したものではない。ブラウザ用fixtureでライト・ダークと720×480pxの最小ウィンドウ幅を確認済み。表示中のワードマークだけを読み上げ対象とし、隠れたテーマ画像は読み上げ対象にならない。システムテーマは確認環境のOS Lightに連動することも確認した。OS Darkでのシステム連動はCSS分岐の確認のみ。

検証: `npm run check`は0 errors / 0 warnings。`npm run tauri -- build`成功。`Nagori.app`のInfo.plistが`icon.icns`を指定し、ResourcesのICNSが生成元とSHA-256一致することを確認。Dock/Finderでの実表示はこの変更では未確認。
