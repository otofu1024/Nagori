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
```

出力先には`results.json`、WebViewの`view.png`、ウィンドウの`window.png`が作られます。`results.json`の`pass`が`true`で、各`checks`もすべて成功なら通過です。失敗時は`checks`と`error.txt`を確認してください。

この確認は`npm test`の対象外です。`npm test`は`tests/*.test.ts`だけを実行します。
