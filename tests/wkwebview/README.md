# WKWebView確認

Macで実行します。リポジトリのルートでターミナルを2つ開いてください。

一方のターミナルで確認ページを配信します。

```sh
node tests/wkwebview/server.mjs
```

別のターミナルからSwiftの確認アプリを実行します。実行中は確認アプリを前面に置いてください。

```sh
swift tests/wkwebview/probe.swift /private/tmp/nagori-ime-check
```

IME以外の確認はURLを指定します。

```sh
swift tests/wkwebview/probe.swift /private/tmp/nagori-typing-check http://127.0.0.1:1438/tests/wkwebview/typing.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-inline-code-check http://127.0.0.1:1438/tests/wkwebview/inline-code.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-preview-focus-check http://127.0.0.1:1438/tests/wkwebview/preview-focus.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-properties-check http://127.0.0.1:1438/tests/wkwebview/properties.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-math-check http://127.0.0.1:1438/tests/wkwebview/math.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-graph-check http://127.0.0.1:1438/tests/wkwebview/graph.html
```

出力先には`results.json`、WebViewの`view.png`、ウィンドウの`window.png`が作られます。`results.json`の`pass`が`true`で、各`checks`もすべて成功なら通過です。失敗時は`checks`と`error.txt`を確認してください。

この確認は`npm test`の対象外です。`npm test`は`tests/editor/*.test.ts`と`tests/workspace/*.test.ts`だけを実行します。

Gitの欄は`git.html`で確認します。右の欄が表示されるように、確認用ウィンドウの幅を1440px以上にしてください。`git.html?theme=dark`では最後の画面をダークで残します。Gitの応答はメモリ上の作り物を使い、一覧、ステージ、コミット前の保存、取り消しの確認、pushが断られた時のpullの選択、pull後の本文の読み直し、エラー、実行中の表示を確かめます。実際のGit操作はRustの単体テストで、`/private/tmp`の一時リポジトリとbareリモートを使って確かめます。

グラフの確認ページは、配信開始時に`/private/tmp`へ作る小さなワークスペースを使います。既存のノートやブログのコピーは不要です。本文の抽出には本番と同じRustのコードを使います。

メモリの確認には`graph-memory.html?phase=before`、`graph-memory.html?phase=open`、`graph-memory.html?phase=closed`を使います。300個の長い文書から抽出したデータで確認し、`sourceBytes`と`payloadBytes`、Canvasの描画領域を記録します。`hold=30`を付けると計測用に30秒待ちます。確認用ウィンドウは閉じるボタン、Esc、Command+Qで止められます。

ブログのモードの確認には、テンプレートのコピーを使います。コピーがなければ、配信を始める前に用意します。

```sh
test -d /private/tmp/nagori-stage2-blog || cp -R ~/nagori_template /private/tmp/nagori-stage2-blog
swift tests/wkwebview/probe.swift /private/tmp/nagori-blog-check http://127.0.0.1:1438/tests/wkwebview/blog.html
```

`blog.html`はコピーをRustのファイル処理で読み、ブログの判定、記事だけの一覧と検索、テンプレートの候補、グラフのブログ内リンク、設定のオンとオフを確認します。画面内の記事の編集はメモリ上で行います。本文だけへのテーマ適用、ダークモードでの配色、コピーの`theme.css`と`template.css`を保存した後の反映も確認します。記事の見出しの表示、各項目の編集とUndo、たたんだ一覧の開閉、見出しと本文の間の矢印キー移動、日本語変換中の書き戻しの抑止も確認します。キャッシュのURLがカードになること、カーソルを入れるとURLへ戻ること、キャラクターの画像と吹き出しの構造、複数行の吹き出しとカードを通る矢印キーの移動も確認します。カードの画像とキャラクターの画像は、本番の画像読み込みでpublicから読んでblobで表示します。ローカルのHTMLと画像をRustで取得し、コピーのキャッシュへ保存する確認も行います。CSS、キャッシュ、確認用の画像はコピーだけを書き換え、確認が終わったら元に戻します。

キャラクターの管理も`blog.html`で確認します。設定内の管理ページ、キャラクターと表情の追加と保存、本文への反映、不正な入力での保存の抑止、画像の選択とドロップ、上書きの確認、使用数付きの削除の確認、Nagoriのゴミ箱への画像の移動を扱います。設定と画像の保存には本番と同じRustの処理を使います。確認用の記事、`config.ts`、画像、ゴミ箱はコピーだけを使い、確認後に元へ戻します。

同梱テーマの選択も`blog.html`で確認します。4つの一覧、適用前の確認とキャンセル、本文への即時反映、夕闇のカーソル・選択範囲・検索の強調、日時付きの履歴、履歴からの復元、外の変更との競合を扱います。カスタムの自動保存、内容の重複の防止、名前の表示、一覧からの適用、削除の確認とキャンセル、使用中のカスタムの削除、削除後の連番、設定を開き直した時の保存も確認します。適用、履歴、カスタムは本番と同じRustの処理を使い、アプリのデータの場所の代わりに`/private/tmp`の別フォルダへ保存します。確認後にコピーの`theme.css`を戻し、確認用の保存先を削除します。
