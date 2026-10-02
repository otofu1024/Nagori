# ブラウザでの参考性能

2026-10-01の記録。実機メモリは[メモリ調査](memory.md)を参照。


Apple M4／RAM32GiB／macOS26.6.2、IAB Chrome154、1280×720px、DPR2、可視状態。Vite production build／Safari16 target、実App・Editor・CodeMirrorを使用し、TauriのI/Oだけ一時的なメモリ内fixtureへ置換した。

記事は102,400 UTF-8 bytes／55,974 JavaScript文字。日本語・英語、見出し、リスト、表、コード、画像記法を含む。990 Markdown＋10画像で1,000ファイル、フォルダ21件は別。画像は共有1×1 PNGであり、実画像のデコード負荷を代表しない。3回のウォームアップ後、各20回測定し、本文の文字数増加と検索候補全パスの一致も確認した。

| 測定 | 中央値 | p95 |
|---|---:|---:|
| 確定済み日本語1文字のDOM入力→2回のrequestAnimationFrame | 33.30ms | 33.50ms |
| 実Quick Open入力→候補DOM確認→2回のrequestAnimationFrame | 32.85ms | 33.10ms |
| 候補計算だけの参考値 | 0.45ms | 1.10ms |

2回のrequestAnimationFrameは描画機会の代理値で、約2フレームの待ち時間を含む。物理画面への描画完了、OSキー入力、IME、WKWebView、実ファイルI/O・IPC、コールド起動を測った値ではない。Mac実機の目標合否には使用しない。全生データ・データhash・ソースhash・ビルド条件は[browser-baseline.json](browser-baseline.json)。起動中アプリの175MiB前後の観測も条件未固定のため目標合否には使わない。[メモリ調査](memory.md)

一時fixtureの再実行手順は `/private/tmp/nagori-ui-preview/PERFORMANCE.md`。`performance-metadata.py` → Vite production build → preview → CUAで測定ボタン、の順で行う。外部更新とIMEの再現は同フォルダの `external-ime.html`、画面記録は `external-ime-guard.jpg`。これらは一時検証用で製品に同梱しない。
