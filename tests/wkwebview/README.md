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
swift tests/wkwebview/probe.swift /private/tmp/nagori-properties-check http://127.0.0.1:1438/tests/wkwebview/properties.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-math-check http://127.0.0.1:1438/tests/wkwebview/math.html
swift tests/wkwebview/probe.swift /private/tmp/nagori-graph-check http://127.0.0.1:1438/tests/wkwebview/graph.html
```

出力先には`results.json`、WebViewの`view.png`、ウィンドウの`window.png`が作られます。`results.json`の`pass`が`true`で、各`checks`もすべて成功なら通過です。失敗時は`checks`と`error.txt`を確認してください。

この確認は`npm test`の対象外です。`npm test`は`tests/editor/*.test.ts`と`tests/workspace/*.test.ts`だけを実行します。

グラフの確認ページは、配信開始時に`/private/tmp`へ作る小さなワークスペースを使います。既存のノートやブログのコピーは不要です。本文の抽出には本番と同じRustのコードを使います。

メモリの確認には`graph-memory.html?phase=before`、`graph-memory.html?phase=open`、`graph-memory.html?phase=closed`を使います。300個の長い文書から抽出したデータで確認し、`sourceBytes`と`payloadBytes`、Canvasの描画領域を記録します。`hold=30`を付けると計測用に30秒待ちます。確認用ウィンドウは閉じるボタン、Esc、Command+Qで止められます。
