# Nagori MVP 検証状況

更新：2026-10-02。仕様§16のmacOSでの合格判定は保留。コード・実Macの一時ファイル・ブラウザ検証で確認できた範囲と、ネイティブ画面で残る確認を分けて記録する。

## 今回の修正とチェック

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
