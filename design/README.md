# Nagori デザイン参考

2026-10-01にユーザーが提供したブランド・UIイメージ。実装時の参考資料として原画像をそのまま保存する。

- `brand-reference.png`: アプリアイコン・ロゴ・Light / Dark / Glyphのイメージボード。
- `ui-reference.png`: アプリ全体のUIイメージ。

## 取り入れる視覚要素

白〜淡い青を基調とし、本文・見出しは濃紺、アクセントはミント〜シアン。細い境界線、柔らかな角丸、控えめな影を使う。本文は落ち着いた見た目を維持する。

## 採用範囲（ユーザー確認済み）

ユーザーは「既存の2ペイン構成のまま、色・余白・アイコン・ツールバーのデザインを取り入れる」を選択した。File TreeとEditorの構成を維持し、右ペイン、Starred、Trash一覧、タグ管理、全文検索は追加しない。上部検索は現行Quick Openのファイル名・パス検索に対応させ、ファイル内Findも維持する。

2026-10-01の追加依頼により、ブランド画像からimagegenで透過素材を作成して組み込んだ。ヘッダーはLightアイコンと画像内のNagoriワードマークを使用し、ダークテーマでは文字色を明るくした同形状の素材へ切り替える。macOSのアプリアイコンはDark App Iconから外側の紺色の角丸台座を外し、紙とNの前景を白い全面背景に配置した素材を使用する。macOS 26が外周をマスクするため、内側に別の角丸台座は含めない。元画像と生成元PNG、使用プロンプトはこのdesignフォルダに保存する。

デザイン実装では参考画像全体を画面背景として読み込まず、色・余白・角丸をCSSで表現する。右ペインの本文・画像を常時二重描画する構成は、採用範囲とメモリへの影響を確認してから決める。

## ブランド素材

生成には内蔵imagegenを使用。生成PNGのalphaを維持し、ヘッダー用は108×108pxのアイコンと324×108pxのワードマーク2種へ縮小した。UIで読み込むのはこの3ファイルと、後述のサイドバーカード2ファイル。ヘッダー用3ファイルの非圧縮RGBA画素量は約0.31MiB。大きな生成元や参考ボードはUIから読み込まない。

- `src/lib/assets/nagori-icon.png`: ヘッダー用Lightアイコン。
- `src/lib/assets/nagori-wordmark.png`: 濃紺のワードマーク。
- `src/lib/assets/nagori-wordmark-dark.png`: 淡色のワードマーク。
- `src-tauri/icons/icon.icns` / `icon.png`: macOS用の紙とNのアプリアイコン。背景は全面白で、内側の角丸台座は含めない。Tauri CLIで生成。
- `design/brand-assets/`: 透過生成元PNG。
- `design/brand-prompts.json`: 採用素材の最終プロンプト。

生成による透過素材化のため、原画像の画素をそのまま切り出したものではない。ブラウザ用fixtureでライト・ダークと720×480pxの最小ウィンドウ幅を確認済み。表示中のワードマークだけを読み上げ対象とし、隠れたテーマ画像は読み上げ対象にならない。テーマは初回だけOSから決めて保存し、以降はLight / Darkを直接切り替える。継続的なシステム連動CSSは削除した。

検証: `npm run check`は0 errors / 0 warnings。`npm run tauri -- build`成功。`Nagori.app`のInfo.plistが`icon.icns`を指定し、ResourcesのICNSが生成元とSHA-256一致することを確認。Dock/Finderでの実表示はこの変更では未確認。

2026-10-01 アイコン枠の修正: ユーザーのmacOS 26でOS側の枠の内側に旧Dark台座が小さく収まる二重構造を確認。内蔵imagegenで紙とNのみを透過した`design/brand-assets/app-icon-foreground-source.png`を作成し、PNG/ICNSを差し替えた。ヘッダーとワードマークは変更していない。旧`app-icon-source.png`は元のDark台座付き案として資料のみ保持する。

修正後の検証: `npm run tauri -- build`成功。バンドル内ICNSが更新素材とSHA-256一致。macOSの`NSWorkspace.icon(forFile:)`で再ビルドしたNagori.appのファイルアイコンを取得し、OS側の明るい角丸枠の内側に紙とNだけが表示され、紺色の角丸台座がないことを確認した。Finder/Dockの画面そのものの確認ではない。

2026-10-01 背景調整: 透過素材にOSが付ける灰色背景が濃いため、内蔵imagegenで紙とNを維持し全面を白にした`design/brand-assets/app-icon-white-source.png`を作成。現在のPNG/ICNSはこの白背景版を使用する。前景透過版は過去案として保持する。

白背景版の検証: Releaseビルド成功。`NSWorkspace.icon(forFile:)`で更新したNagori.appの表示用アイコンを取得し、白背景と二重台座がないことを確認。生成元は`design/brand-assets/app-icon-white-source.png`、最終プロンプトは`design/brand-prompts.json`の`appIconWhite`。

## サイドバーのカード（2026-10-04）

2026-10-08にカードの表示、CSS、アプリ用の画像2枚を削除した。以下は制作時の記録として残す。

サイドバー下部に、アプリアイコンを感じさせるカードを置いた。ミントから水色の波のリボンと、ブランド資料のGlyphに寄せたNを描いた絵の上に、「A calmer space for your ideas.」をHTMLで重ねる。

絵はOrcaのオーケストレーションでcodex(GPT-6-Sol、推論量high)のワーカーに任せ、内蔵の画像生成で作った。ui-reference.pngの左下カードとbrand-reference.pngのGlyphを参考に渡し、各テーマ1回の生成で採用した。使ったプロンプトと参考画像との差は`design/brand-assets/sidebar-card-report.md`に保存した。

- `src/lib/assets/sidebar-card-light.png`: ライト用。528×672px、約321KB、透過なし。
- `src/lib/assets/sidebar-card-dark.png`: ダーク用。528×672px、約341KB、透過なし。

カードは高さ196pxで絵の下側を見せ、角丸と影はCSSで付ける。ウィンドウの高さが760px以下の時はファイル一覧を優先してカードを隠す。非圧縮RGBA画素量は2枚で約2.7MiBだが、表示するのは現在のテーマの1枚だけ。
