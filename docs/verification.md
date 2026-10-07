# Nagori MVP 検証状況

更新：2026-10-08。仕様§16のmacOSでの合格判定は保留。コード・実Macの一時ファイル・ブラウザ検証で確認できた範囲と、ネイティブ画面で残る確認を分けて記録する。

Mac実機で未確認の項目を順に確認する手順と記入欄は[Mac実機QA手順書](mac-qa-checklist.md)にある。

## 見出しの線、最近見たページ、サイドバーのカード削除（2026-10-08、feature/sidebar-recent）

作業前のgit log --oneline -1で、指定の起点1bad871を確認した。ATXとSetextの見出し1〜3の下に、本文の幅いっぱいの1pxの灰色の線を付けた。既存の--borderを使い、行の背景として描く。線の下の余白は行のpaddingに含め、本文と選択の位置は変更しない。Setextの記号が見える間は記号の行へ線を移す。Live PreviewとPreviewは同じ行装飾とCSSを使う。Inline CodeのTextWidgetには触れていない。

サイドバーに「最近見たページ」を追加した。Quick Openと同じsettings.recentFilesを新しい順に最大5件表示し、同名のファイルには親フォルダの相対パスを添える。既存のファイル情報をアイコンに使い、未展開の履歴は拡張子で種類を補う。選択はFile Treeと同じselectEntryを通り、保存とIME変換の待ち合わせを共有する。折りたたみ状態は設定に保存しない。欄の高さはサイドバーの40%以下とし、File Treeとは別に既存のスクロールバー表示を使う。履歴が空の時とワークスペースがない時は欄を出さない。

サイドバー下部のカード、専用CSS、ライト用とダーク用の画像2枚を削除した。アプリ内のほかの使用箇所がないことを検索で確認し、design/README.mdには削除日を追記して制作時の記録を残した。「別のフォルダを開く」と「本文の表示設定」は残した。

npm run checkは0エラー・0警告、npm testは追加5件を含む165件、src-tauriでのcargo testは18件が成功し、npm run buildも成功した。既存のCodeMirror言語定義の動的importと500kB超チャンクの警告は残る。追加テストでは履歴の順序、件数、重複、同名の区別、空の履歴、種類、名前変更と削除への追従、見出しの線の対象と表示位置、本文とUndoの保持を確認した。

コーディネーターが用意したhttp://127.0.0.1:1512/の確認ページで、ライトとダーク、サイドバー200pxと420pxを確認した。1700×480の画面では履歴の一覧が114px、File Treeが69px残り、履歴をスクロールしてもFile Treeの位置は変わらなかった。クリックで開く処理、保存後の切り替え、名前変更と削除、Quick Openと同じ履歴、折りたたみ、現在のファイルの色、長い名前の省略を確認した。空の履歴も別の確認ページで欄が出ないことを確認した。

ATXの見出し1〜6と複数行のSetextを含む本文では、線の対象、本文幅、1pxの太さ、記号が見える時の位置を確認した。Previewでも同じ線になり、本文は変わらなかった。目次からの移動では見出しの文字を表示領域の上端から約32pxに合わせ、今読んでいる節の強調も一致した。CodeMirrorの既存の集中モードとタイプライター表示を確認ページへ適用し、線の濃さが見出しと一緒に変わることと、カーソルを中央へ寄せることを確認した。35項目の結果は/private/tmp/nagori-sidebar-recent-qa/checks.jsonにある。

画面画像は/private/tmp/nagori-sidebar-recent-qaのlight-narrow.png、light-wide.png、dark-narrow.png、dark-wide.pngに保存した。Setextの記号表示とPreviewはsetext-active-light.png、setext-active-dark.png、setext-preview-light.png、setext-preview-dark.png、低い画面はshort-window.png、集中モードとタイプライター表示はfocus-typewriter.png、空の履歴はempty-history.pngにある。

OrcaのTabキー操作ではフォーカスが移らず、TabとEnterで開く操作の合格判定は保留した。ネイティブのbuttonとtabIndex=0は確認した。フォルダ選択のモックはキャンセルを返すため、別のワークスペースへの切り替えとワークスペース未選択の画面は未確認。保存・名前変更・削除はメモリ上のモックで確認した。Nagori本体の日本語IME、保存失敗、VoiceOver、実ファイルとの併用は未確認で、QA項目6jに残した。

変更ファイルはsrc/App.svelte、src/app.css、src/lib/RecentFiles.svelte、src/lib/navigation.ts、src/lib/Editor.svelte、src/lib/livePreview.ts、tests/recent-files.test.ts、tests/editor.test.ts、README.md、design/README.md、docs/specification.md、docs/mac-qa-checklist.md、この文書と画像2枚。仕様書は改訂版1.16へ上げた。依存追加、ブランチ名の変更、コミット、push、PR作成は行わず、変更は未コミットで残す。日本語文書をyomiyasu_lint.pyで確認し、既存の表現と必要な手順の箇条書きは残した。

## 記事ヘッダーの操作メニュー削除、太字と斜体の入力（2026-10-08、feature/typing-format）

作業前のgit log --oneline -1で、指定の起点cf7533aを確認した。記事ヘッダーの「記事の操作」を項目ごと削除し、専用CSSとmoreアイコンも外した。画像挿入、検索、保存、装飾の既存の関数は、右クリック、メニューバー、キーから使うため残した。READMEと画像挿入のQA手順は、本文の右クリックメニューを使う説明へ直した。仕様書は§8、§9.1、§9.2、§13を更新し、改訂版1.15にした。

選択がない太字・斜体だけをtypingFormat.tsで扱う。Cmd＋Bは`****`、Cmd＋Iは`**`の間から入力する。閉じる直前は本文を変えずに後ろへ出て、開く直後は前へ出る。途中では前半を閉じ、後半を開き直して間へカーソルを置く。太字と斜体を入れ子にでき、外側を途中で閉じる場合も内側の記号を閉じて開き直す。アンダースコアの要素を途中で分ける場合は、単語の途中で閉じるためアスタリスクへそろえる。[CommonMarkの強調の規則](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis)に従い、解析した構文木をテストで確認した。選択がある時は従来のformatPlanを使う。取り消し線とInline Codeも従来の処理を使う。

コマンドで作った空の範囲だけをStateFieldで追跡する。何も打たずにカーソルを外へ移すか、選択を作るか、フォーカスを失うと自動で消す。自動削除はaddToHistory=falseとし、Undoの履歴に追加しない。履歴の位置を更新する際に空になったEffectも除き、直前の本文入力を1回のUndoで戻せることを確認した。削除後の本文はonChangeへ通知する。手書きの記号と、一度文字を入力した記号は自動で消さない。入れ子の空の記号もまとめて消す。

各コマンドはinput.formatとし、前後の入力からUndoを分ける。本文を変えずに外へ出る場合は履歴用Effectを使う。コマンドの後に選択位置だけを履歴へ記録し、Redoでも記号の間や外へ戻す。IME変換中と開始直後、plain、Preview、読み取り専用、処理中と、コード・Front Matter・数式・HTML・リンクの参照先では何もしない。Live Previewの処理は変更していない。空の記号の表示と入力後の装飾を既存の描画関数で確認した。

追加したNodeテスト15件は、開始、閉じる直前と開く直後、途中で閉じる操作、空の解除、移動とフォーカス喪失による削除、手書きの保持、編集による追跡位置の更新、UndoとRedo、入れ子、対象外の記法、Live Preview、Editorの共通入口を確認する。npm run checkは0エラー・0警告、npm testは160件、src-tauriでのcargo testは18件が成功し、npm run buildも成功した。既存のCodeMirror言語定義の動的importと500kB超チャンクの警告は残る。

画面確認にはtests/typing-wkwebview.htmlとtests/typing-wkwebview.jsを追加した。実際のEditor.svelteを使い、キー、EditorApi、NSTextInputClientによる入力、フォーカス喪失、Floating Toolbar、検索と保存のキーを確認する。既存のprobe.swiftは任意の確認ページURLを第2引数で受け取るようにし、引数を省いた時のIME確認ページは維持した。コーディネーターがmacOS 26.6.2のWKWebViewで実行し、既存IMEの223項目と今回の画面確認45項目がすべて成功した。JavaScriptのエラーはなかった。今回の確認ページの初回実行では、検索パネルのクラス名を取り違えた1項目だけが失敗した。確認ページを修正して再実行し、アプリのソースは変更していない。実行中はソースを固定した。結果と画像は/private/tmp/nagori-typing-format-imeと/private/tmp/nagori-typing-format-ui-finalにある。view.pngで入力した太字とカーソルのある要素の記号表示を確認した。

日本語文書4ファイルはyomiyasu_lint.pyで確認した。仕様とQA手順の箇条書き、必要な用語と否定対比、READMEの丁寧な文末への指摘は、意味と既存の文体を保つため残した。

変更したファイルはsrc/App.svelte、src/app.css、src/lib/Icon.svelte、src/lib/Editor.svelte、src/lib/typingFormat.ts、tests/typingFormat.test.ts、tests/typing-wkwebview.html、tests/typing-wkwebview.js、tests/ime-wkwebview/probe.swift、README.md、docs/specification.md、docs/mac-qa-checklist.md、この文書の13ファイル。依存追加、Rustのソース変更、ブランチ名の変更、コミット、push、PR作成は行っていない。変更は未コミットで残す。

Nagori本体のメニューバー、物理キーによる入力、日本語IMEの候補選択、実際の保存と画像操作との併用は未確認。[QA項目4c](mac-qa-checklist.md#項目4c-太字と斜体の入力記事ヘッダー)に確認手順を追加した。

## 日本語入力の位置ずれとカーソルの高さ（2026-10-08、feature/ime-caret）

段落の途中で変換すると別の位置へ入力される問題、未確定文字を全部消した後の位置ずれ、太字の内側で確定すると文字が重なる問題を直した。変換中のカーソルも文字の高さで描く。起点はcafb444で、変更は未コミットで残した。依存追加、Rustの変更、ブランチ名の変更、コミット、push、PR作成は行っていない。

保存状態と変換が重なる問題は、Editor.svelteから送るfindReplaceBlockedのdispatchが原因だった。保存状態を変換中に切り替える18場面では、cafb444の比較版が0/18、保存状態のdispatchだけを外した比較版が18/18だった。2026-10-07の変更前の13d19abも18/18で、この追加処理による不具合と確認した。13d19abの比較用Editorは、importのパスだけを置き換えたものと一致する。結果は/private/tmp/nagori-ime-qaのbase-race.json、no-save-race.json、old-race.jsonにある。修正後は最後の保存状態を保留し、変換が終わった時に反映する。

字下げと途中の太字がある段落で、未確定文字を空にした後に入力位置が戻る問題は、変換開始直後に送るcompositionModeのdispatchで再現した。これは13d19abにもある。変換状態を本文のトランザクションへまとめ、開始だけのdispatchを削った。修正後のコードへ開始のdispatchだけを戻すと5位置中4位置で再発した。終了を従来のmicrotaskへ戻した比較版は5位置すべて成功したため、終了の待機方法は変えていない。比較結果はstart-dispatch.jsonとend-microtask.jsonにある。

太字の重複では、WebKitがbeforeinputで位置45〜48の3文字を削除すると通知していた。CodeMirrorは、同じ語が直後に続き、最後の文節だけを選んでいる時に位置47〜48の1文字削除として取り込み、2文字を残した。保存状態を切り替えなくても再現し、13d19abの比較版でも重複した。deleteCompositionTextの削除範囲が食い違う時だけ、CodeMirrorのinputHandlerからWebKitの範囲を使う。通常入力と貼り付けは既存の処理へ渡す。修正前の詳細は/private/tmp/nagori-ime-check-resume1/results.jsonにあり、太字の確定・取り消し・unmarkに関わる5項目が失敗していた。修正後はすべて成功した。

カーソルが上の行まで伸びる原因は、変換中に自前の線を隠し、行高の標準カーソルを見せていたことだった。標準カーソルを常に透明にし、変換中もCodeMirrorのlayerで選択の末尾に線を描く。本文19px、行高36.1px、850×650のWKWebViewで、修正前の画像はx=555〜556、y=263〜332の70画素だった。倍率2では高さ35pxにあたる。修正後のDOM座標では線がleft=203.40625、top=75、bottom=97で、高さ22pxになった。文字のtop=75、bottom=97と一致する。修正前の画像は/private/tmp/nagori-ime-qa/base-focused-window.png、修正後は/private/tmp/nagori-ime-check-final/view.pngにある。最終のOSウィンドウ画像は全体が黒いため、正常に撮れたWKWebViewのview.pngで表示を確認した。未確定文字の下線を画像で確認し、点滅と移動直後の点灯も自動確認した。

確認の仕組みはtests/ime-wkwebviewに置いた。macOS 26.6.2の本物のWKWebViewへsetMarkedText、insertText、unmarkTextを送り、普通の段落、太字、リンク、見出し、plain、集中モードとタイプライター表示を試す。保存状態の切り替え、文節移動、確定、取り消し、全部削除した後の再入力、繰り返す文字と句読点、再変換、通常入力、貼り付け、UndoとRedoを含む223項目が成功し、JavaScriptのエラーはなかった。結果、座標、DOM、view.png、window.pngは/private/tmp/nagori-ime-check-finalにある。NSTextInputClientのdeleteBackwardだけでは、最初の呼び出しで文字を消さず変換を終えるため、IMEで短くした未確定文字をsetMarkedTextへ渡す形でBackspaceを再現する。

npm run checkは0エラー・0警告、npm testは145件、src-tauriでのcargo testは18件が成功し、npm run buildも成功した。既存のCodeMirror言語定義の動的importと500kB超チャンクの警告は残る。ログは/private/tmp/nagori-ime-check-finalのcheck.log、node-test.log、cargo-test.log、build.logにある。変更したファイルはsrc/lib/Editor.svelte、tests/ime-wkwebviewの4ファイル、docs/specification.md、docs/mac-qa-checklist.md、この文書の8ファイル。仕様書は§7.3の変換中のカーソルの決まりを更新し、改訂版を1.14にした。

日本語の変更文書3ファイルをyomiyasu_lint.pyで確認した。指摘は既存の箇条書き、用語、意味のある否定対比に限られ、今回の追加文にはなかった。必要な記述はそのまま残す。

実際の日本語IMEの候補ウィンドウ、物理キーによる候補選択と再変換、Nagori本体の保存との併用は未確認。一時WKWebViewの保存は確認用の500msタイマーで行う。Floating Toolbar、右クリックメニュー、目次、Preview、検索・置換、リスト・表、画像との併用は既存テストが通った範囲にとどまり、今回の実機操作では再確認していない。[QA項目3a](mac-qa-checklist.md#項目3a-段落途中の変換とカーソルの高さ)に実機での手順を追加した。

## ファイル内の検索と置換（2026-10-07、feature/search-replace）

最初のgit log --oneline -1で、指定された起点13d19abを確認した。変更ファイルはsrc/lib/findPanel.ts、src/lib/Editor.svelte、src/App.svelte、tests/findPanel.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書の7ファイル。仕様書は§10.2だけを書き直し、改訂版の番号と§15は変えていない。依存パッケージの追加、Rustの変更、ブランチ名の変更、コミット、push、PR作成は行わず、変更を未コミットで残す。

既存の検索パネルをfindPanel.tsへ移し、大文字小文字の区別、正規表現、置換欄の切り替えを追加した。初期値は文字どおりの検索、大文字小文字を区別、正規表現はオフ。件数、前後への移動、EnterとShift＋Enter、Escapeを保った。不正な正規表現は「正規表現が正しくありません」と入力欄のエラー表示で伝える。空の一致から前後へ移る時は、同じ位置を選び直さない。

置換はCodeMirrorのreplaceNextとreplaceAllを使い、グループ参照もSearchQueryの規則に従う。置換欄のEnterは選択中の一致を1件変更し、Cmd＋Enterは全置換する。全置換は1トランザクションで、直前と直後の入力からUndoを分ける。全置換後は「N件を置換しました」と表示する。読み取り専用、ファイル処理中、保存中、Previewは置換を無効にし、検索を残す。App.svelteには保存中の状態を渡す1行を追加した。Markdownとplainの両方で動き、IME変換中はキー操作と検索条件の更新を保留する。

判断した点は、置換欄の入口を「置換欄」の切り替えボタンにしたこと。Cmd＋Option＋Fの割り当ては追加していない。一致を選んでいない時の「置換」はCodeMirrorに合わせて次の一致を選び、次の操作でその一致を変更する。正規表現の検索エンジンとグループ参照を自作せず、既存の依存パッケージを使った。CodeMirrorの文字列カーソルで正規化により位置が厳密でない一致は、全置換の件数から除く。

追加したNodeテスト13件で、初期値、大文字小文字、文字どおりの記号とバックスラッシュ、件数と前後の移動、不正な式と空の検索、正規表現のグループ参照、単発と全件の置換、UndoとRedo、前後の入力とUndoの分離、読み取り専用と置換の無効状態、IME、本文を読み直した直後の無効状態、空の一致、未選択のカーソル位置からの検索、重なる一致、plainの状態を確認した。npm run checkは0エラー・0警告、npm testは104件、src-tauriでのcargo testは17件が成功し、npm run buildも成功した。既存の500kB超チャンク警告は残る。

OrcaのWeb確認ページに実際のEditor.svelteと共通CSSを読み込み、入力イベント、ボタン、合成したキーイベントによる23項目を確認した。検索の切り替え、不正な式、グループ参照、置換欄のEnterとCmd＋Enter、全置換後の件数、UndoとRedo、isComposingとkeyCode 229のEnter抑止、4種類の無効状態と解除、Escape、空の一致、plainでの全置換、Tab順の要素を確認した。ライトとダークの幅1120pxではパネルの高さは92pxで、置換欄を開いても本文を表示できた。入力欄とボタンの並び、枠、押された状態を画面画像で確認した。確認用のページ、結果JSON、画像は/private/tmp/nagori-search-replace-qaにある。

日本語の変更文書3ファイルをyomiyasu_lint.pyで確認した。指摘は見直し候補として扱い、既存の文体や必要な専門用語を残した。実際の日本語IME、Nagori本体でのTabとCmd＋Z、保存と再読み込み、目次や右クリックメニュー、画像の貼り付けとの併用は未確認。Orcaのkeypressは受理されたがページ側のフォーカス移動を確認できず、実機のキー操作で合格した記録にはしていない。[QA項目1a](mac-qa-checklist.md#項目1a-ファイル内の検索と置換)に手順を追加した。

## 集中モードとタイプライター表示（2026-10-07、feature/focus-mode）

作業前のgit log --oneline -1で指定された起点13d19abを確認した。変更したファイルはsrc/lib/focusMode.ts、src/lib/Editor.svelte、src/App.svelte、src/lib/settings.ts、src-tauri/src/files.rs、src-tauri/src/lib.rs、tests/focus-mode.test.ts、tests/settings.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書の11ファイル。仕様は§13の本文だけを書き足し、改訂版の番号と§15は変えていない。変更は未コミットで残す。

集中モードは、既存の構文木で選択の両端のブロックを調べる。段落、見出し、リスト項目、引用、コード、表、数式ブロックを扱い、選択が触れるブロックを通常の濃さで保つ。ほかの行とWidgetの不透明度は0.5にした。画像とInline Mathは親の行と一緒に薄くし、表と数式のブロックWidgetには画面内のDOMだけを調べて同じ濃さを付ける。行にはCodeMirrorの行装飾を使い、Active LineやLive Previewの装飾と両立させる。同じブロック内の移動では行装飾を作り直さない。本文全体の文字列化や独自の全文解析は追加していない。

タイプライター表示は、入力・削除・Undo・Redoとキーによる選択移動の後にカーソルを中央へ寄せる。CodeMirrorのscrollHandlerで通常の追従を受け取り、requestMeasureで座標を読んでから縦のスクロール位置を変える。クリック・ドロップ・検索の選択移動と、目次の上端への移動は中央へ寄せない。ホイールとスクロールバーを触った時は待機中の追従も取り消す。IME変換中は追従と装飾の作り直しを止め、入力による位置のずれだけを装飾に反映する。末尾の余白は既存の半画面分を使い、先頭付近はスクロール位置0で止める。

2つの切り替えは表示メニューに置き、focusModeとtypewriterModeを設定に保存する。旧設定で欠けた項目はTypeScriptとRustの両方でオフになり、Rustでは真偽値以外を受け付けない。IME変換中の切り替えはAppの共通処理で止める。plainモードでは集中モードを無効にし、タイプライター表示を使えるようにした。両方オフならCompartmentから拡張を外す。Editor.svelteへの変更はpropsとCompartmentへの登録・再設定に限った。

キーは集中モードをMod+Shift+J、タイプライター表示をMod+Shift+Tにした。NagoriのメニューとEditor、CodeMirrorのdefaultKeymap・historyKeymap・searchKeymapに同じ割り当てがないことを確認した。[AppleのMacキーボードショートカット](https://support.apple.com/en-us/102650)ではControl+Command+Fを全画面に割り当てているため避けた。Command+Shift+TはFinder内でタブバーの切り替えに使うが、Nagoriにはタブ機能がなく、OS全体の操作とは重複しない。利用者が変更したシステムの割り当てや、外部アプリが登録するキーは未確認。

追加したNodeテスト7件で、ブロックの境界、インデント付きコード、入れ子のリスト、複数ブロックの選択、追従する操作の判定、中央位置の計算、拡張の撤去、plainモード、キーの重複、100KiBを超える文書での行装飾の再利用、IMEと手動スクロール、設定の独立した保存・復元を確認した。座標をrequestMeasureのread内で読むことも検査する。Rustに1件追加し、旧設定の初期値、全4通りの保存・復元、不正な型の拒否を確認した。

macOSの一時WKWebViewにEditor.svelteと共通CSSを読み込み、ライトとダークで集中するブロックの濃さ、同じブロック内の移動、複数ブロックの選択、Live Previewの画像・表・数式、Preview、拡張を外した後の表示を確認した。タイプライター表示では中央への移動、入力後の復帰、Undo、クリック、先頭、末尾、変換状態、plainモード、両方オン、折り返し、ホイールを確認した。118598バイトの文書で20回カーソルを移した時は、画面のDOMは46ブロックにとどまった。確認ページの57項目はすべて成功し、JavaScriptのエラーはなかった。一時ページ、結果JSON、ライト・ダークの画像は/private/tmp/nagori-focus-qaにある。

npm run checkは0エラー・0警告、npm testは98件、src-tauriでのcargo testは18件が成功し、npm run buildも成功した。既存の500kB超チャンク警告は残る。日本語文書3ファイルをyomiyasuのリンターで確認した。依存追加、ブランチ名の変更、コミット、push、PR作成は行っていない。

判断した点は、plainの集中モードを無効にすること、引用全体を1ブロックとすること、入れ子のリストは内側の項目を優先すること。Nagori本体でのネイティブメニューと実際のキー入力、再起動による設定の復元、日本語IMEの候補選択、OSの右クリックメニュー、保存と画像貼り付けを併用した操作は未確認。[QA項目6h](mac-qa-checklist.md#項目6h-集中モードとタイプライター表示)に手順を追加した。

## 画像のドロップとコードの色分け（2026-10-07、feature/image-drop-highlight）

追加修正ではApp.svelteのwindow全体でファイルのdragoverとdropの標準動作を止め、エディタ外では取り込まず何もしないようにした。追加テストでFilesを含むイベントのdefaultPreventedと、文字列の標準動作・イベントの伝播を確認した。型チェックは0エラー・0警告、Nodeテスト99件とビルドは成功し、Finderから各領域への実機ドロップはQA項目6iの手順9に残した。

起点はgit log --oneline -1で13d19abを確認した。変更は未コミットで残す。仕様の改訂番号と§15は変更していない。

変更したファイルはsrc/lib/imageDrop.ts、src/lib/codeLanguages.ts、src/lib/Editor.svelte、src/App.svelte、src/app.css、src-tauri/tauri.conf.json、package.json、package-lock.json、tests/image-drop.test.ts、tests/code-languages.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書の13ファイル。Editor.svelteへの変更は拡張の登録とプロパティに限り、App.svelteには取り込みの入口を追加した。Rustのコマンドは追加していない。

画像はWebのDataTransfer.filesからバイト列を読み、既存のimage_pasteへ渡す方式とした。TauriのdragDropEnabledをfalseにしてWebのドロップへ渡す。ファイルパスを読むコマンドや権限は増やしていない。貼り付けと同じpasted-imageの命名、番号付きの重複回避、相対パスの記法、画像の検証、20MiB・1,600万画素の上限、プロジェクト内への書き込みを再利用する。[Tauriのドロップ設定](https://v2.tauri.app/reference/config/#dragdropenabled)も確認した。

複数画像は全件の形式とサイズを確認してから順にコピーする。画像以外が混じる場合は全体を拒否する方針を選んだ。記法を改行で区切ってドロップ位置へ1回で挿入し、直前の入力と履歴を分けるためCmd＋Zで全体が戻る。失敗、保存前、読み取り専用、Preview、保存中、ファイル処理中、IME変換中、plainモードでは取り込まず通知する。コピー途中の失敗では本文を変えず、複製済みの画像は残す。コピー後に記事や本文、変換状態が変わった時も挿入しない。文字列はCodeMirrorの通常のドロップを使う。

色分けは対象言語に絞ったLanguageDescriptionの一覧を使う。各定義を動的importで読み込み、未知の言語を曖昧な部分一致で選ばない。JavaScriptとTypeScript、Java・C・C++はそれぞれ同じパッケージを再利用する。CSSではコード行の内部だけにテーマの色を付ける。Inline Code、plainモード、背景、等幅フォント、余白は変更しない。[CodeMirrorの言語と色分けのAPI](https://codemirror.net/docs/ref/)に従う。

追加した直接依存はlang-javascript 6.2.5、lang-json 6.0.2、lang-css 6.3.1、lang-html 6.4.12、lang-python 6.2.1、lang-rust 6.0.2、lang-sql 6.10.0、lang-yaml 6.1.3、legacy-modes 6.5.4。いずれも@codemirror配下で、許可されたパッケージのみ。JavaScript・CSS・HTMLは起点でも間接依存として入っていた。lockfileで新しく増えたパッケージは次のとおり。

@codemirror/lang-json 6.0.2、@codemirror/lang-python 6.2.1、@codemirror/lang-rust 6.0.2、@codemirror/lang-sql 6.10.0、@codemirror/lang-yaml 6.1.3、@codemirror/legacy-modes 6.5.4、@lezer/json 1.0.3、@lezer/python 1.1.19、@lezer/rust 1.0.3、@lezer/yaml 1.0.4。

HTML・JavaScript・CSSは既存のlang-markdownの静的依存から分離されない。コーディネーターの了承を得て既存の初期チャンクを再利用した。ビルドには、この3言語の動的importが効かないという警告が出る。500kB超のMathJaxの警告も残る。追加した各言語の定義は別チャンクで、Java・C・C++はclikeを共有する。

同じ依存環境で起点をビルドし、生成したJavaScriptを比較した。表の単位はbyteで、gzipはNodeのgzipSyncの既定設定で生成ファイルを圧縮した実測値。indexだけでなく静的importで初期に読み込む共通チャンクも数えた。

| 対象 | 初期に読み込むチャンク | raw | gzip |
| --- | --- | ---: | ---: |
| 起点13d19ab | `index-BTJKOOgv.js` | 660,407 | 227,227 |
| 変更後 | `index-DICp_4zT.js` | 371,000 | 135,238 |
| 変更後 | `dist-C5buD2pf.js` | 300,050 | 96,060 |
| 変更後 | `dist-DW05D6Sb.js` | 8,442 | 3,560 |

起点の初期JavaScript合計は660,407byte、gzip 227,227byte。変更後は679,492byte、gzip 234,858byteで、rawは19,085byte、gzipは7,631byte増えた。新しい言語の定義は初期読込に入らないが、色分けとStreamLanguageの共通処理、ドロップ処理、一覧の登録コードが増えている。言語定義を別ファイルへ移しても共通処理は初期チャンクに残ったため、ファイルを増やす案は採用しなかった。

| 言語 | 遅延読み込みのチャンク | raw | gzip |
| --- | --- | ---: | ---: |
| Python | `dist-8gLk_9H8.js` | 44,545 | 19,040 |
| Rust | `dist-BFGYvV_g.js` | 83,646 | 30,315 |
| JSON | `dist-Zb2goFCx.js` | 1,959 | 1,245 |
| YAML | `dist-KqgzMatl.js` | 11,529 | 5,138 |
| SQL | `dist-C3eDOiHT.js` | 15,804 | 6,909 |
| Shell | `shell-DwuoZtxw.js` | 2,434 | 1,198 |
| TOML | `toml-BPTmHmyx.js` | 1,045 | 529 |
| Swift | `swift-DKB6_1j6.js` | 3,762 | 1,814 |
| Go | `go-zaFg-XIf.js` | 2,757 | 1,297 |
| Java・C・C++ | `clike-KOqmMNJE.js` | 21,967 | 7,687 |
| Diff | `diff-ChtP43wD.js` | 302 | 234 |

Nodeテストを7件追加した。取り込み禁止状態の理由、形式と上限、コピー前の全件検査、複数画像の順序と改行、1回のUndo、途中の失敗、言語名と別名の判定、初期未読込、17種類の定義の読込とフェンス解析、未知の言語を確認した。npm run checkは0エラー・0警告、npm testは98件、src-tauriのcargo testは17件が成功した。npm run buildも成功した。

日本語文書3ファイルをyomiyasuのリンターで確認した。既存の箇条書きの比率、文末コロン、意味のある否定表現の指摘は残し、担当外の節は変更していない。今回追加した文章には指摘がなかった。

OrcaのWeb版確認ページで20項目を確認した。合成したファイルドロップの位置と順序、1回のUndo・Redo、plain・読み取り専用・保存中・処理中・Preview・保存前・合成IMEでの拒否と理由、文字列の通常ドロップ、dropCursorの表示と撤去、ライトとダークのコード色、Inline Codeと未知の言語の無着色、Previewでの色分けが成功した。表示された画面でもコードの背景と余白を保ったまま色が付くことを確認した。確認ページの画像コピーはモックで、実ファイルへのコピーは既存のRustテストで確認した。

Nagori本体へのFinderドロップ、実際の日本語IME、ドロップ後の保存と再読み込み、右クリックメニューと目次の併用は未確認。QA項目6iに手順を残した。確認用ファイル、画面画像、結果JSON、起点のビルドとサイズ一覧は、このworktreeのnode_modules/.cache/nagori-image-qaにある。確認サーバーの停止後は、このディレクトリを削除してよい。

## リストの字下げ、表の編集、URLの貼り付け（2026-10-07、feature/list-table-edit）

作業前のgit log --oneline -1で、指定された起点13d19abを確認した。変更は未コミットで残す。変更した10ファイルはsrc/lib/listEdit.ts、src/lib/tableEdit.ts、src/lib/linkPaste.ts、src/lib/Editor.svelte、tests/listEdit.test.ts、tests/tableEdit.test.ts、tests/linkPaste.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書。Editorにはキーと貼り付け処理の登録だけを置き、従来の画像ハンドラーはlinkPaste.tsへ移した。AppとRustのソース、依存パッケージ、仕様の改訂番号と§15は変更していない。

リストは構文木の項目単位で字下げし、複数項目、子、継続行をまとめて扱う。番号とタスクのチェック状態を保つ。深くする幅は前の兄弟のリスト記号と直後の空白から決め、浅くする幅は親の記号位置から決める。最も浅い項目と、前に兄弟のない項目ではキーを消費して本文とフォーカスを保つ。引用記号と空行を残し、変更するタブの字下げは表示上の桁数に合わせて空白へ直す。標準のEnter継続は変えていない。

表はTabとShift＋Tabで本文を選び、Enterで同じ列の次行へ移る。区切り行を飛ばし、末尾では見出しと同じ列数の空行を足す。移動時に全体を整形し、全角2桁、結合文字0桁で幅を決める。区切り行の`:`、セル内の`\|`、引用とリストの前置き、セル本文の全角空白を保つ。省略されたセルは空セルとして扱い、見出しより多い本文セルも消さない。新しい列は足さず、通常の移動先は見出しの列数にそろえる。整形と追加を1回のトランザクションへまとめ、直前の入力とはUndoを分ける。

単一行の空でない選択へHTTP・HTTPS・mailtoを貼るとリンクになる。複数行、角括弧、既存リンク、コードでは通常の貼り付けに戻す。Front Matter、数式、HTML、画像、参照定義も書き換えず、貼った結果がリンクとして解析できる場合だけ適用する。URLは空白や括弧を含む時だけ山括弧で囲み、山括弧とバックスラッシュは参照先でエンコードする。統合の時にコーディネーターが、ふだんのURLを手で書く形のまま入れるよう変えた。リンク文字のバックスラッシュはエスケープし、カーソルを末尾へ置く。文字と画像が両方ある場合は、従来どおり文字を優先する。URLなら選択をリンクにし、それ以外なら通常の文字として貼る。画像だけの場合に限って画像取り込みへ回す。画像の検出は既存のclipboardImageを再利用し、URLと画像の変更をそれぞれ既存の編集処理へ渡す。

判断した点は、タスクのチェック記号を字下げ幅へ足さず、CommonMarkのリスト本文に含めること。表の先頭でShift＋Tabを押した時は先頭セルにとどめ、区切り行からは見出しか本文へ移る。既存のGFM解析に合わせてセル分割ではASCIIの空白とタブだけを除き、全角空白を本文として保った。plainとPreview、読み取り専用、ファイル処理中、IME変換中と開始直後には新しいMarkdown操作を行わない。plainでも従来の画像取り込みは保つ。

新しいNodeテスト26件で、3種類のリストと複数項目・子・継続行・引用・タブ、字下げできない時のキー消費、標準のEnter継続、表の移動と行追加・全角幅・寄せ方・エスケープ・空セル・余分なセル、URLの条件と文字優先、画像だけの取り込み、構文木の再利用を確認した。各編集の1回のUndoとRedo、選択の復元、直前の入力の保持も確かめた。npm run checkは0エラー・0警告、npm testは117件、src-tauriでのcargo testは17件が成功し、npm run buildも成功した。既存の500kB超チャンク警告は残る。

Orcaのブラウザ確認ページに実際のEditor.svelteと共通CSSを読み込み、17件を確認した。リストの字下げと子の保持、できない操作のキー消費、表のセル選択とEnter・行追加、URL貼り付け、文字優先と画像だけの取り込み、Undo、plainとPreview、合成IMEの開始と変換中の抑止が成功した。合成IMEではcompositionstartだけの場合と、DOMの文字入力を伴ってview.composingがtrueになる場合を分けた。Enterによる表の移動と追加を後者で抑止できた。見出し、入れ子リスト、編集中の表と標準の選択表示も画面で確認した。一時ページと結果JSONは/private/tmp/nagori-list-table-qaにある。

後続の修正で、画像検出へ加工していないclipboardDataを渡すよう戻した。NumbersやExcel、Wordなどから文字とPNGを一緒にコピーしても、文字を画像として取り込まない。表とリストのキー操作にはensureSyntaxTreeを使い、既存のエディタの解析結果を再利用する。パイプのない解析済みの本文では、その行の構文だけを調べてfalseを返す。GFMの省略セル行にはパイプがない場合もあるため、文字だけで表の外と決めずに表の構文を確かめる。表の後半とリストの子も含めて解析が完了した木を使い、解析が時間内に終わらない時と言語拡張のない呼び出しだけ従来の全文解析へ戻す。

性能はmacOSのarm64、Node v24.12.0で測った。102,554バイトの日本語記事に見出し・リスト・表を置き、末尾の通常本文でmoveTableのEnter処理がfalseを返すまでを計測した。構文木を用意し、最初の20回を除く200回の中央値と95パーセンタイルを比べた。同じ状態を使う時は、修正前1.982ms・2.127ms、修正後0.001ms・0.002msだった。毎回末尾に改行を足した時は、修正前1.951ms・2.109ms、修正後0.001ms・0.003msだった。状態更新、通常の改行処理、DOM描画の時間は含めていない。測定JSONは/private/tmp/nagori-list-table-qa/timing.jsonに保存した。

日本語文書3ファイルをyomiyasuのリンターで確認した。Nagori本体の保存と再読み込み、OSのクリップボード、実際の日本語IME、右クリックメニュー、目次、Floating Toolbarとの併用は未確認で、[QA項目4b](mac-qa-checklist.md#項目4b-リストの字下げ表の移動urlの貼り付け)に手順を足した。コミット、push、PR作成、ブランチ名の変更は行っていない。

## 複数段落の装飾（2026-10-06、feature/multi-paragraph-format）

作業前のgit log --oneline -1で、指定された起点454d745を確認した。変更したファイルはsrc/lib/markdown.ts、src/lib/Editor.svelte、tests/editor.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書の6ファイル。仕様を改訂版1.12へ上げた。変更は未コミットで残す。

太字・斜体・取り消し線は、構文木の段落・見出し・リスト内の段落・タスクの本文・引用内の段落ごとに区間を作る。見出し・タスク・引用の記号を除き、引用の継続行は記号の前後で分ける。普通の段落やリスト内の段落のソフト改行は1区間に保つ。Inline Codeだけはさらに行ごとに分ける。既存の1段落用の判定を再利用し、前後の空白、同じ装飾の付け直し、別の装飾の境界、CommonMarkの記号の衝突を確かめる。表示時は差分解析の木を使い、操作時は全文解析で判定する。

コードブロック・Front Matter・数式ブロック・HTML・表・参照定義は飛ばす。数式やHTMLタグを含む本文区間、別の装飾の境界をまたぐ区間、記号が衝突する区間も飛ばす。Inline Codeでは装飾を含む行を飛ばす。変更できる区間がない時だけ無効にし、既存の理由を表示する。見出しなどの構造の記号だけを選んだ場合も本文を変更しない。リンクは1段落内だけに対応する。

判断した点は、飛ばす区間を付け外しの判定から除くこと。変更できる区間がすべて装飾済みなら解除し、一部だけが装飾済みなら付ける操作へそろえる。引用記号が装飾の内側にある既存の記法も読み取り、同じ要素を複数区間から解除する場合は変更を重複させない。タスクの記号まで含めた選択は、本文を取り出して装飾できるようにした。このため旧テストの複数段落とタスク記号の無効判定2箇所は、今回の仕様に合わせて適用結果の確認へ変えた。

複数の変更を1回のinput.formatのトランザクションで適用する。変更後は、最初の本文先頭から最後の本文末尾まで選択する。対象外の記法・空白・改行は変更しない。追加した7件のNodeテストで、2段落、部分選択、ソフト改行、CRLF、箇条書きと番号付きリスト、タスク、引用、ATX・Setext見出し、非対象ブロック、全区間の解除と装飾の混在、Inline Codeの行ごとの適用、リンクの無効判定、表示用と操作時の判定一致、1回のUndoと選択の復元を確認した。

macOSの一時WKWebViewに実際のEditor.svelteと共通CSSを読み込み、2段落の太字、3項目の斜体、見出しと段落の取り消し線、コードブロックを挟む選択、Inline Codeの行ごとの適用、全区間の解除を確認した。各操作の本文・選択とUndo・Redo、本文へのフォーカス復帰も確認した。表示されたツールバーでは4種類の装飾が有効で、リンクに従来の無効理由が付くことを確認し、太字ボタンのクリックでも2段落を変更できた。Orcaの確認ページでは本文のフォーカスを保てなかったため、ツールバーの確認にはWKWebViewを使った。一時ページ、結果JSON、画像は/private/tmp/nagori-multi-paragraph-qaにある。

npm run checkは0エラー・0警告、npm testは91件、src-tauriでのcargo testは17件が成功し、npm run buildも成功した。既存の500kB超チャンク警告は残る。日本語文書3ファイルをyomiyasuのリンターで確認した。依存追加、Rustのソース変更、ブランチ名の変更、コミット、push、PR作成は行っていない。

Nagori本体での保存・再読み込み、実際の日本語IME、OSの右クリックメニュー、目次との併用は未確認で、[QA項目4a](mac-qa-checklist.md#項目4a-複数段落の装飾)に手順を追加した。

## 折り返し位置のカーソル（2026-10-05、otofu1024/feature-caret-fix）

作業前のgit log --oneline -1で、指定された起点ac223f6を確認した。変更はsrc/lib/Editor.svelte、docs/specification.md、docs/mac-qa-checklist.md、この記録の4ファイルに限る。仕様を改訂版1.11へ上げた。依存パッケージの追加、Rustの変更、コミット、push、PR作成は行っていない。

macOS 26.6.2の一時WKWebViewに修正前のEditor.svelteと共通CSSを読み込み、折り返した段落の2行目の先頭で長い標準キャレットを再現した。本文19px、行間1.9の条件で、CodeMirrorのcoordsAtPosはtop 75px、bottom 97pxの22pxを返した。標準キャレットは、この座標より上の行間へ伸びて表示された。本文の行高や空行の配置によるずれではなく、WebKitの標準キャレットの描画による問題と判断した。

カーソルだけをlayerとRectangleMarker.forRangeで描く。主選択が空で、本文にフォーカスがあり、編集可能な時だけ表示する。RectangleMarkerはカーソルのassocに従って座標を選ぶ。通常の標準キャレットは透明にし、選択範囲の標準表示と::selectionの色は保った。既存のcm-cursor用CSSを使い、色をアクセント色へ変える。点滅はCodeMirrorと同じ1.2秒周期とし、入力・移動・フォーカス変更・変換終了で点灯へ戻す。

drawSelectionを戻して選択の塗りだけを隠す案も、ライブラリの実装を読んで比較した。drawSelectionは選択用のlayerに加え、標準の選択表示を隠すCSSと内部設定も有効にする。標準表示を再び上書きする必要があるため採用しなかった。主カーソルだけで足りる要件に合わせ、追加モジュールを作らずEditor.svelte内に拡張を置いた。IME変換中は既存のcompositionフラグを使って自前のカーソルを隠し、標準キャレットを戻す方を選んだ。Previewで標準キャレットが戻らないよう、非表示のCSSを優先させた。

修正後のWKWebViewでは、ライトとダークの両方で、折り返し境界のassoc -1は上側のtop 39px、assoc 1は下側のtop 75pxへ表示された。どちらも高さ22pxで、描画したカーソルの上下はCodeMirrorの座標と一致した。幅700pxと1000px、強調文字でも高さ22pxに収まり、テキストファイルでは15px、見出しでは47pxとなった。左右・上下の移動でも1行の文字の高さに収まった。

入力・移動直後の点灯と、650ms後の消灯を確認した。複数行の選択では選択用のlayerがなく、左右の余白が塗られないことを画面で確認した。Previewでは標準キャレットが透明で自前のカーソルもなく、本文と選択を保った。Live Previewへ戻すとカーソルが復帰した。合成したcompositionstartとcompositionendでは、変換中の自前カーソルの非表示と標準キャレットの復帰、終了後の自前カーソルの復帰、本文の保持を確認した。改行直後と入力後はtop 75px、高さ22pxで一致し、後続の段落の位置も同じだった。Undo・Redoで本文が復元された。

一時の検証ページ、実行用Swiftスクリプト、測定JSON、画面画像は/private/tmp/nagori-caretに置いた。測定JSONを検査するverify.pyも同じ場所にある。修正前後の標準的な表示はbefore-light-normal-1000-window.png、current-light-normal-1000-window.png、current-dark-normal-1000-window.pngで比較できる。

npm run checkは0エラー・0警告、npm testは84件成功、src-tauriでのcargo testは17件成功、npm run buildは成功した。ビルドでは既存と同じ500kB超のチャンク警告が出た。日本語の変更文書はyomiyasu_lint.pyで確認した。既存の箇条書き・用語・コロンと、原因の判断に必要な否定対比の指摘は見直したうえで残した。

本体アプリでのマウス操作、フォーカスを外した時の表示、日本語IMEによる実際の変換・確定・キャンセル、保存、右クリックメニュー、目次、幅のドラッグ、スクロールバーは確認待ち。合成した変換イベントの結果を、実際のIMEで合格した記録として扱わない。追加したQA項目6gで確認する。

## 目次の表示切り替え（2026-10-05、feature/outline-toggle）

作業前のgit log --oneline -3で、起点が03e4808であることを確認した。Markdownの記事を開いている時だけ、本文ヘッダーのLive Previewボタンの横に目次のアイコンボタンを追加した。隣のボタンと同じ角丸・枠・押された時の色を使い、aria-pressedと、状態に応じたaria-label・title「目次を隠す」「目次を表示」を付けた。表示メニューにも「目次を表示 / 非表示」を追加し、ボタンと同じ処理で切り替える。

非表示を選ぶと目次と幅変更の境界線を外し、本文の列を広げる。表示を選んだ時は、既存の見出しと幅の判定を使う。画像、テキストファイル、見出しのない記事では目次を出さない。ボタンの押された状態は、幅不足で一時的に隠れていても保存した選択を示す。幅を広げた時に自動で戻る選択を伝えるため、この扱いにした。

設定にoutlineVisibleを追加し、初期値をtrueにした。切り替えごとに既存の設定保存キューを通じてsettings.jsonへ保存する。RustのSettingsはserdeの既定値で旧設定を読み、bool型で真偽値以外を拒否する。Node側でも旧設定に既定値を補い、保存したfalseをそのまま復元する。目次の幅は表示設定とは別に保ち、本文やEditorの設定を変更せずに切り替える。

判断した点は、ネイティブメニューをチェック付きにせず切り替え項目としたこと。既存のメニューイベントと設定保存処理を使えるため、この形を選んだ。メニューからはMarkdownを開いていない時も次に使う表示設定を選べる。設定の読み込みが終わるまでは切り替えない。Editor.svelteと記事の保存、IME、Undo、Live Preview、Preview、右クリック、目次の移動と強調、幅の判定、スクロールバーの処理には変更を加えていない。

npm run checkは0エラー・0警告、npm testは84件、src-tauriでのcargo testは17件が成功し、npm run buildも成功した。Nodeでは初期値、項目のない旧設定、表示・非表示の復元と他の設定の保持を確認した。Rustでは同じ既定値と復元に加え、null・数値・文字列・配列・オブジェクトを拒否することを確認した。依存パッケージがなかったため初回のNode検証は失敗し、npm ci後に再実行して成功した。ビルドの既存の500kB超チャンク警告は残る。

今回のGUI確認は実施していない。MacのWKWebViewでの見た目、ボタンとメニューの操作、再起動後の復元、幅変更との併用、VoiceOver、IMEなどはコーディネーターが確認する。[QA項目6c](mac-qa-checklist.md#項目6c-目次と本文末尾のスクロール)に手順9〜12を追加した。

変更ファイルはsrc/App.svelte、src/lib/Icon.svelte、src/app.css、src/lib/settings.ts、tests/settings.test.ts、src-tauri/src/files.rs、src-tauri/src/lib.rs、docs/specification.md、README.md、docs/mac-qa-checklist.md、この文書。仕様書は改訂版1.10へ上げた。日本語文書4ファイルはyomiyasuのリンターで確認した。既存の文体と手順・仕様の箇条書きに対する指摘は残した。依存パッケージは追加せず、ブランチ名も変えていない。コミット・push・PR作成は行わず、変更は未コミットで残す。

## 本文の選択表示と改行直後のカーソル（2026-10-05）

本文の選択をブラウザ標準の表示へ戻し、テーマの選択色を::selectionで付けた。CodeMirrorのdrawSelectionと、専用の選択背景・カーソルのCSSを外した。Live Previewのカーソルは既存のcaret-colorでアクセント色になり、Previewでは透明になる。追加依頼の改行直後のカーソルのずれには、空行の行高を詰めるCSSを外した。本文・行・Widgetのpadding、本文の最大幅、折り返し、スクロールバーの幅、末尾の余白の処理は変更していない。

起点はgit logで03e4808と確認した。原因は、使用中のCodeMirror 6.43.13のrectanglesForRangeが、複数行の選択をcm-contentの左右端まで描くこと。差し引く余白は最初のcm-lineのpaddingで、cm-contentのpaddingは対象外だった。一時WKWebViewで、本文の枠が46〜946px、文字の列が110〜882pxの時に、選択の中間部分が46〜946pxまで塗られることを再現した。

指定された2案を一時ページで試した。左右の余白を各行へ移す案では、通常の行の選択は110〜882pxに収まった。ただし、見出しの上下padding、コードの背景と12pxのpadding、引用の縁と15pxのpadding、表や区切り線の配置を合わせる必要がある。最初の行がコードや引用だと、その行のpaddingを全選択に使うため、コードでは58〜934px、引用では61〜946pxまで塗られる問題が残った。表示式はcm-lineの中に置かれるため行の余白を継承した。これらの例外を増やさずに配置を保てる標準選択を採用した。

macOSの一時WKWebViewに実際のEditor.svelteを読み込み、ライト・ダーク、Live Preview・Preview・等幅のテキスト表示、先頭が引用やコードの文書、700px幅の画面で確認した。選択表示だけを変えた段階では、修正前後の本文・各行・表・表示式・区切り線・画像の座標と幅、スクロール領域の幅と高さが一致した。通常の幅では本文900px、文字の列772px、スクロール領域992px、末尾の余白325pxを保った。700px幅では左右の余白28pxを保った。

ウィンドウを撮影し、複数行の選択が文字の範囲に収まり、本文の左右の余白を塗らないことを確認した。Previewの全選択では表・画像・数式も表示したまま選択でき、折り返した行とWidgetの塗りも本文の列の内側に収まった。WKWebViewのtakeSnapshotでは標準選択の色が画像に写らなかったため、ウィンドウの撮影を使った。比較ページ、測定結果、画像は一時フォルダ/private/tmp/nagori-selectionに置いた。

一時ページでは単一段落の装飾、Undoによる原文への復帰、Redo、検索一致15件の表示、Floating Toolbarの位置を確認した。Previewで表・数式・画像を含む全選択をコピーする合成イベントでは、表示用の文字ではなくMarkdownの原文を取り出せた。表示モードの往復で原文、選択、スクロール位置を保ち、Previewのcaret-colorが透明になることも確認した。実際の日本語IME変換、OSのクリップボード、保存、右クリックメニュー、目次の移動と強調、幅のマウスドラッグをNagori本体で併用する確認は未実施で、[QA項目6f](mac-qa-checklist.md#項目6f-本文の選択表示)に残した。

改行直後のずれは、空行のline-heightが0.9、入力後が1.9になるCSSが原因だった。本文19pxの一時ページで、空行の高さは17px、入力後は36pxとなり、カーソルの上端が65pxから75pxへ動くことを再現した。カーソルのある空行だけ36pxにする案では入力前後のずれはなくなるが、空行へ出入りするたびに後続の段落が19px上下した。複数カーソルや、空行を終点にした範囲選択でも、cm-activeLineが付く行の高さが変わる。

空行をすべて通常の行高へ戻す案も試し、こちらを採用した。最終修正では、改行直後も入力後も行高36px、カーソル上端75pxを保ち、空行を通る移動、範囲選択、Previewでも空行の高さを保った。NagoriではCodeMirrorの複数選択を有効にしていないため、一時ページだけで有効にし、2つの空行に選択位置を置いた場合の行高も測った。変換の開始と終了を送る合成イベントでは、カーソル位置と原文を保った。実際の日本語変換候補や確定文字の表示はMac実機QAで確認する。判断した点は、段落間の空行が従来より19px広がることを許容し、入力と移動で本文が上下に動く原因を取り除くこと。空行の後の縦位置と文書の高さは変わるが、左右の配置、折り返し位置、幅、末尾の余白の計算は保つ。

npm run checkは0エラー・0警告、npm testは83件、src-tauriでのcargo testは16件が成功し、npm run buildも成功した。既存の500kB超チャンク警告は残る。日本語文書3ファイルをyomiyasuのリンターで確認し、手順の箇条書きと原文コピーの区別、既存の表現への指摘は意味を保って残した。

変更ファイルはsrc/lib/Editor.svelte、docs/specification.md、docs/mac-qa-checklist.md、この文書。仕様書は改訂版1.10へ上げた。依存追加、App.svelte・settings.ts・src-tauriのソース変更、ブランチ名の変更、コミット、push、PR作成は行っていない。変更は未コミットで残す。

## サイドバーと目次の幅変更（2026-10-04、feature/pane-resize）

サイドバーと本文、本文と目次の境界線をドラッグして幅を変えられるようにした。サイドバーは200〜420pxで初期値272px、目次は180〜360pxで初期値220px。線の左右4pxを当たり判定にし、ホバー・フォーカス・ドラッグ中はアクセント色の3pxの線を表示する。ダブルクリックで初期値に戻し、Tabと左右の矢印キーでも線を10pxずつ動かせる。separatorの向き、現在値、最小値、最大値も設定した。

ドラッグ中の幅は保存済みの設定と分け、終了時に既存の設定保存キューへ1回だけ追加する。矢印キーとダブルクリックは操作ごとに保存する。本文のフォーカスを保ち、選択を防ぐCSSは終了・中断・部品の撤去時に解除する。記事の保存、IME、Undo、Preview、目次の移動の処理は変更していない。RustのSettingsは旧版に幅の項目がなくても既定値で読み、読み込みと保存時に範囲外の幅だけ初期値へ戻す。

目次の項目は12pxから14.5pxへ広げ、行高を1.65、上下の余白を8pxにした。見出し1の太さは600とし、階層の字下げを12pxから14pxへ変えた。「目次」のラベルは12pxから14pxへ広げ、太さ600にした。

判断した点は、本文720pxに左右余白128pxを加えた848pxを残すこと、ウィンドウに収まる幅と保存する幅を分けること、境界線の位置に合わせて目次の矢印キーの増減方向を反転すること。目次が入らない時は先に隠し、サイドバーを一時的に縮める。1048px未満では本文848pxとサイドバー200pxを同時に確保できないため、目次を隠してサイドバーの最小幅を保つ。Svelteはseparatorを非操作要素と判定するため、フォーカスとキー操作を実装した上で、該当する2種類の警告だけ理由付きで抑制した。

型チェックは0エラー・0警告、Nodeテスト82件、Rustテスト16件が成功し、Viteのビルドも成功した。Nodeでは幅の範囲、古い設定、目次の表示境界、サイドバー非表示、画面に収まる幅、小数の画面幅を確認した。Rustでは既定値、上下限の保存と復元、負数と大きな数の復帰、ほかの設定の保持を確認した。既存の500kB超チャンク警告は残る。

Tauriの呼び出しを差し替えたブラウザの確認用ページでは、初期幅272pxと220px、目次の14.5px表示、読み上げ属性を確認した。合成PointerEventでドラッグ中の設定保存が0回、終了後が1回となり、lostpointercaptureを続けて送っても保存が増えないことを確かめた。本文のフォーカスとEditorのDOMは保持され、記事の保存は呼ばれなかった。左右の矢印キー、初期値への復帰、各操作の設定保存も確認した。この確認ではPointer Captureを差し替えているため、実際のマウスドラッグの確認には使っていない。

Orcaの非表示ブラウザでは幅変更後のResizeObserverの更新を確認できず、GUIの表示境界は合格判定に使っていない。MacのWKWebViewでのドラッグ、ウィンドウのサイズ変更、VoiceOver、日本語IME、再起動後の復元は未確認で、[QA項目6d](mac-qa-checklist.md#項目6d-サイドバーと目次の幅)に残した。日本語文書5ファイルはyomiyasuのリンターで確認した。

変更ファイルはsrc/App.svelte、src/app.css、src/lib/Outline.svelte、src/lib/PaneResizer.svelte、src/lib/paneWidths.ts、src/lib/settings.ts、tests/paneWidths.test.ts、src-tauri/src/files.rs、package.json、README.md、docs/specification.md、docs/architecture.md、docs/mac-qa-checklist.md、この文書。仕様書は改訂版1.9へ上げた。依存パッケージの追加、スクロールバーのCSS変更、コミット、push、PR作成は行っていない。変更は未コミットで残す。

## 操作中だけ表示するスクロールバー（2026-10-04、feature/scrollbar）

本文・ファイル一覧・目次に共通のactivityScrollbar関数を付けた。その領域でマウスを動かすか、実際にスクロールするとつまみを表示する。最後の動きから1秒後に表示用クラスを外し、240msかけて消す。ホバーだけでは表示を続けず、キーボードやトラックパッドによるスクロールも同じscrollイベントで扱う。ドラッグ中はつまみの色を保つ。イベントは受動的に監視し、本文の編集やイベントの標準処理には介入しない。部品を外す時はタイマーとイベントの監視を解除する。

原因をコードで確認すると、本文と目次は標準のスクロールバー描画を使い、つまみを隠す指定がなかった。本文はscrollbar-gutter: stableと、未対応環境向けのoverflow-y: scrollで幅を確保していた。ファイル一覧はhoverで色を付けるため、マウスを止めてもつまみが消えなかった。[CSSの仕様](https://www.w3.org/TR/css-overflow/#scrollbar-gutter-property)では、stableは従来型のスクロールバーの領域を確保する指定であり、つまみの表示時間を制御する指定ではない。[WebKitの公式記録](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)では、対応開始はSafari 18.2。stableだけが常時表示を起こすという仮説は、今回の一時ページでは確定していない。

幅の確認では別の問題を再現した。WKWebViewで8pxのカスタム幅にstableとoverflow-y: autoを組み合わせると、幅220pxの領域のclientWidthが長い文書では212px、短い文書では203pxになった。短い文書の予約幅が標準の17pxへ戻るため、対応環境でautoへ戻す分岐を外した。stableは残し、全環境でoverflow-y: scrollと透明な8pxのスクロールバーを使う。修正後は3領域とも、表示・非表示、長短の文書、ライト・ダークでclientWidthが212pxのまま保たれた。stableを無効にして未対応環境と同じ幅の確保にした場合も212pxだった。

つまみは8pxの領域に透明な1pxの縁を付け、見える部分を6pxの角丸にした。溝・角は透明、矢印は非表示とし、つまみの色は各テーマのmutedを使う。WebKitの[つまみ自体のCSS遷移に関する制約](https://bugs.webkit.org/show_bug.cgi?id=104412)を避けるため、領域のcolorを遷移させてつまみにcurrentColorを継承する。本文、目次の文字、ファイル名の入力欄には文字色を明示し、つまみの透明化が文字に及ばないようにした。視差効果を減らす設定ではフェードを省く。新しいCSS APIや依存パッケージは追加していない。

Nodeの追加テストで、初期状態、ホバーだけでは表示しないこと、マウス移動での表示、スクロールでのタイマー延長、1秒後の非表示、監視とタイマーの解除を確認した。npm run checkは0エラー・0警告、npm testは79件すべて成功、src-tauriでのcargo testは15件成功、npm run buildも成功した。既存の500kB超チャンク警告は残る。日本語文書3ファイルをyomiyasuのリンターで確認し、既存の表現への指摘と仕様書・手順書の箇条書きは残した。

macOS 26.6.2の一時WKWebViewに実装した共通CSSと関数を読み込み、3領域の表示、フェード途中と完了、実際のscrollTop変更での表示、ライト・ダーク、長短の文書、文字色の保持を確認した。検証プロセスだけにAppleShowScrollBars Alwaysを渡し、AppKitの従来型指定を確認した。OS全体の設定は変更していない。Nagori本体でのマウス・キー・トラックパッドの操作、つまみのドラッグ、OS設定ごとの表示、IME・保存・右クリックメニューとの併用は未確認で、[QA項目6e](mac-qa-checklist.md#項目6e-スクロールバーの表示と幅)に残した。

変更ファイルはsrc/lib/Editor.svelte、src/app.css、src/lib/Outline.svelte、src/lib/FileTree.svelte、src/lib/activityScrollbar.ts、tests/activity-scrollbar.test.ts、docs/specification.md、docs/mac-qa-checklist.md、この文書。FileTree.svelteへのimportとアクション指定はコーディネーターの許可を得て追加した。仕様書は改訂版1.9へ更新した。App.svelte、目次の文字サイズ、src-tauriのソースには触れず、コミット・pushは行っていない。

## 本文の右クリックメニュー（2026-10-04、feature/context-menu）

本文の右クリックとShift＋F10からTauriのネイティブメニューを開く処理を追加した。標準編集、見出し1〜3と本文、箇条書き・番号付き・タスク、引用、3列の表、区切り線、既存の画像挿入を用意した。Editorから位置と編集可否を通知し、Appでメニューを組み立てる。表・画像・数式Widget上も本文領域でイベントを受ける。

読み取り専用、Preview、日本語の変換中、ファイル処理中は編集項目を無効にし、コピーと全選択を残す。Markdown以外は標準編集の4項目だけを出す。コード・Front Matter・数式に触れる行では段落操作を止め、リスト・引用・表では見出し変更も止める。本文や選択、記事の変更後は古いメニューの段落操作と画像挿入を止める。

追加したNodeテスト9件で見出しの置換・解除、保護対象と継続行、リストの置換・解除と番号付け、引用のトグル、インデントと空行、選択外の記法とCRLF、表の分離と最初のセルの選択、区切り線とSetext回避、各段落操作のUndoを確認した。型チェックは0エラー・0警告、Nodeテスト68件、Rustテスト15件が成功し、Viteのビルドも成功した。Appの整形を実行し、他の対象部品に変更はなかった。日本語文書5ファイルをyomiyasuのリンターで確認し、既存の指摘と手順書の箇条書きは意味を保って残した。

判断した点は、選択終端が次行先頭ならその行を対象外にすること、保護判定を行全体に適用すること、区切り線の後ろも空行で分離すること。見出しの解除では末尾の閉じる記号も外す。Tauriの定義済み項目には無効状態のAPIがないため、編集禁止時の切り取りと貼り付けは無効な通常項目で表示する。既存のメニュー権限で足り、Rustと権限設定は変更していない。GUIでの確認は未実施で、ネイティブメニュー、実際のクリップボード、日本語IMEはMac実機QAの項目15で確認する。

変更ファイルは`src/lib/Editor.svelte`、`src/lib/editor.ts`、`src/lib/blockEdit.ts`、`tests/blockEdit.test.ts`、`src/App.svelte`、`docs/specification.md`、`README.md`、`docs/architecture.md`、`docs/mac-qa-checklist.md`、`docs/verification.md`。変更は未コミットで残した。

## 本文右側の目次と末尾の余白（2026-10-04、feature/outline）

MarkdownにATX・Setextの見出し1〜4があり、中央の領域が1068px以上の時だけ、本文右側に幅220pxの目次を表示する。本文の左右余白128pxを除いて720px以上を残すため、表示の境界は940pxより広くした。見出しのない記事、画像、Markdown以外のテキスト、未選択状態では表示しない。記号を外した見出しを字下げし、本文上端以前の最後の見出しをアクセント色と左の細い線で示す。

クリックとTab・Enterによる操作で見出し行の末尾へカーソルを移し、本文上端付近へスクロールしてフォーカスを戻す。Previewでは選択を保持する。CodeMirrorの構文木を使い、本文変更は150msまとめてから抽出する。長文の末尾まで解析できていない場合は20msずつ進める。スクロール時は本文上端の行を測り、二分探索で現在の節を求める。

Live Preview・Preview・テキストファイルで、本文の表示領域の高さの半分をcm-contentの下側のpaddingへ設定する。CodeMirrorの測定と同じスクロール高を使えるため、scrollRestore.tsの処理は変更していない。半画面の余白を含めた末尾の復元と、高さ変更後の計算をテストした。

追加の依頼として、cm-scrollerにscrollbar-gutter: stableを付け、縦スクロールバーの出現・消失で本文幅が変わらないようにした。[WebKitの公式記録](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)では対応開始がSafari 18.2のため、未対応の環境ではoverflow-y: scrollで縦スクロールバーの幅を常に確保する。対応している環境は@supportsでoverflow-y: autoへ戻す。すべての本文表示で共通とし、macOSの「常に表示」での実機確認はQA項目6cに残した。

Nodeテストでは、見出しの種類と階層、コード・Front Matter・HTMLの除外、引用とリスト内の見出し、重複と空の見出し、装飾とリンクの表示文字、コード・数式・文字参照、複数行Setext、長文の末尾、差分更新、現在の節、余白を含む末尾復元を確認した。型チェックは0エラー・0警告、Nodeテストは69件、Rustテストは15件が成功し、Viteのビルドも成功した。既存の500kB超チャンク警告は残る。

一時WebページのDOMでは、読み上げ用の「目次」ナビゲーションとボタン、1067pxでの非表示と1068pxでの表示、表示領域600pxに対する末尾余白300pxを確認した。Orcaブラウザの非表示タブではフレーム更新が進まず、クリック後のスクロールと高さ変更後の再測定は合格判定に使っていない。WKWebViewでのGUI確認も未実施で、[QA項目6c](mac-qa-checklist.md#項目6c-目次と本文末尾のスクロール)に残した。

変更したファイルはsrc/lib/Outline.svelte、src/lib/outline.ts、tests/outline.test.ts、src/lib/Editor.svelte、src/lib/editor.ts、src/App.svelte、src/app.css、package.json、README.md、docs/specification.md、docs/architecture.md、docs/mac-qa-checklist.md、この文書。package.jsonではnpm run formatの対象に新しい目次部品を追加した。依存追加、Rustのソース変更、コミット・pushは行っていない。

## 装飾の付け直し（2026-10-04、feature/format-merge）

すでに同じ装飾を含む範囲を選んで装飾した時に、操作を止めず、内側の同じ記号を外して全体に付け直すようにした。同じ装飾の中だけを選んだ時は、その装飾を外す。別の種類の装飾は丸ごと入る時だけ残し、境界を途中でまたぐ時は止める。Bold・Italic・Strikethroughでは、選択範囲の前後の空白を除いてから付ける。Linkは従来どおり。

Nodeテストで、依頼の例(`something about **Autumn** that`)、境界を途中でまたぐ選択、複数の同じ装飾、取り消し線とInline Codeでのまとめ、中だけの選択での解除、別の種類の装飾を残す場合と止める場合、前後の空白の除去を確認した。Web版の確認用ページで、マウスで選んでツールバーの太字を押すと付け直され、1回のCmd＋Zで元に戻ることを確かめた。Mac実機での確認は未実施。

## Markdown以外のテキストファイル（2026-10-04、feature/open-text-files）

JSONやコードなど、Markdownと画像以外のファイルを、等幅のプレーンテキストとして開いて編集できるようにした。ツリーの表示では中身を読まず、開く時にUTF-8でNUL文字がないかを判定する。保存・競合・別名保存はMarkdownと同じ処理を使い、Live Preview・装飾・画像挿入・Preview切替は使わない。Quick Openの候補にも含めた。

Rustテストで、CRLFのJSONの読み込みと改行を保った保存、拡張子のないテキスト、バイナリとUTF-8以外の拒否、画像の拒否、別名保存の規則、索引への追加を確認した。NodeテストでQuick Openの候補を確認した。Web版の確認用ページで、JSONを開いて編集・保存でき、Markdown向けの機能が出ず、バイナリは理由を表示して開かないことを確かめた。Mac実機での確認は未実施。

## 参考画像に寄せたUIの改修（2026-10-04、feature/ui-redesign）

参考画像に似ていないという指摘を受け、1か所ずつ撮影して見比べながら直した。

- 本文の空行の高さをCSSで詰め、見出しの上下の余白を合わせた。本文のテキストとカーソルの動きは変えていない。
- タスクリストでは、チェックボックスの前の箇条書きの点を表示しない。カーソルを置けば元の記法が見える。
- サイドバーのフォルダを2色の塗りのアイコンにした。ミントになるのは開いている記事を含むフォルダだけで、同じ階層で緑になるのは1つに限る。ほかのフォルダは展開していても青。
- 表示中の記事の横の点を削除した。ファイル一覧のスクロールバーは、マウスを乗せた時だけ細く表示する。
- 見出しの＋ボタンを枠付きの角丸にし、サイドバーの幅を244pxから272pxへ広げた。
- サイドバー下部に、画像生成した波とNのカードを置いた。経緯は[デザイン資料](../design/README.md)。

型チェックは0エラー・0警告、Nodeテストは全件成功。Tauriの呼び出しを差し替えたWeb版でライト・ダークを撮影して確認した。Mac実機での表示、信号機ボタンとの位置関係は未確認。

## 画像の貼り付け（2026-10-04、feature/paste-image）

画像だけをコピーした状態で貼り付けると、記事と同じフォルダの`assets`へ`pasted-image.<拡張子>`として保存し、相対パスの記法を挿入する。同名があれば番号を付ける。文字も含むクリップボードは、通常の文字の貼り付けを優先する。画像はJSONに変換せず、バイト列のままRustへ渡す。検証と保存は「画像を挿入」と同じ処理を使う。

Rustテストで、保存先と番号付け、JPEGの拡張子、途中で切れた画像と画像以外の拒否、20MiBの上限、Markdown以外への貼り付けの拒否を確認した。Nodeテストで、画像だけの時に限って画像を選ぶ判定を確認した。Web版の確認用ページでは、合成した貼り付けイベントで記法が挿入され、記事のパスとバイト列が渡ることを確かめた。Mac実機での実際のクリップボードからの貼り付けは未確認。

## レビューに基づく整理（2026-10-03、feature/review-fixes）

コードレビューで挙がった無駄な処理と保守性の問題を直した。

- 画像はJSONの数値配列ではなく、バイナリのままWebViewへ渡す。表示時のRust側の全デコードをやめ、取り込む画像だけを最後までデコードして破損を確かめる。
- ファイル監視の通知では、展開中のフォルダだけを読み直す。プロジェクト全体の索引は、Quick Openを開く時と前回のファイルを復元する時だけ作る。
- 保存1回あたりのファイルの読み込みを3回から2回に減らした。
- 選択ツールバーの表示判定では、前回の構文木からの差分解析を使う。ボタンを押して本文を変える時は、全文解析で判定し直す。100KiBの記事（Node、未装飾の選択）で、表示判定は約14msから約3msになった。押した時の判定は約9ms。
- 数式の抽出は全文解析のまま残した。Lezerの差分解析は、まれに全文解析と異なる木を返すことをランダム編集の比較で確認したため。
- 2件の登録・解除しかないコマンドパレットを削除し、アプリメニューの項目へ移した。結果は通知に表示する。
- 公開前の設定移行（appearanceVersionと17pxから19pxへの変更）と、未使用の`EditorApi.getText`を削除した。
- App.svelteからファイルツリー、Quick Open、保存失敗・競合、別名保存のダイアログを部品へ分け、Prettierで整形した。
- 仕様書§19の初回実装・検証記録を[履歴の検証記録](history/verification.md)へ移した。

型チェックは0エラー・0警告。Nodeテスト55件とRustテスト13件が成功し、Viteのビルドも成功した。Mac実機での画面確認は未実施で、特に画像の表示と寸法表示、ツリーの更新、Quick Openのキー操作、メニューからのコマンド登録が確認待ち。

## コマンドパレットとCLIの**登録**（2026-10-02、9528951）

Cmd＋Shift＋Pと「表示 → コマンドパレット…」から、nagoriコマンドの登録・解除を実行する。Workspace未選択でも使え、検索・上下キー・Enter・Escapeに対応する。IME変換中、他のダイアログ表示中、保存などの処理中は開かない。登録結果、登録先、認証キャンセル、既存コマンドとの衝突をパレットに表示する。

起動スクリプトと登録用シェルをNagori.appのResources/cliへ同梱する。登録先は/usr/local/bin/nagoriで、/Applicationsまたは~/Applicationsに置いたアプリから登録する。書き込み権限が足りない場合はmacOSの管理者認証を使う。同名の別ファイル・別リンクを上書きせず、自分の登録だけを解除する。既存の~/.local/bin/nagoriは操作しない。

シェル構文とgit diff --checkが成功。一時ディレクトリで登録・解除の繰り返し、別コマンド・切れたリンクの保持、登録直前に同名ファイルが現れる場合を確認した。CLI引数には日本語、空白、特殊文字、ネスト、シンボリックリンクを含めた。登録シェルは一時領域だけで実行し、/usr/local/binへの実登録と管理者認証は実行していない。

Releaseビルドとad-hoc署名のstrict検証が成功。製品Nagori.appは16,182,451 bytes、15.43MiB。実行ファイルSHA-256は0e50f0283c82abd99216fcd6bbb5be03db2eea53b4d75074e38add6ae7faadae。同梱スクリプトがソースと一致し、実行属性と--helpも確認した。開発用のQA識別子で作ったアプリは、製品アプリと区別して測定する。

専用識別子app.nagori.editor.qa20261002のQAアプリを同梱CLIから起動し、指定Workspace・記事が設定へ反映されることを確認した。日本語・空白パス、起動中への別記事要求、4連続要求の最終記事、--helpが成功。不存在パス・引数過多は終了コード1でQA設定を変えなかった。記事選択は設定ファイルで確認し、本文の描画完了や起動性能の測定とは扱わない。通常のNagoriの設定SHAは開始前後で一致した。

Mac画面操作の権限確認が応答せず、独立したAXプローブもtrusted=falseを返した。パレットのキー操作、認証成功・キャンセル、Mac IME、編集直後の終了・保存、Finder・ゴミ箱の画面操作は未検証。以前のブラウザ成功を代わりの合格判定にはしない。

## 実機メモリとDMG（2026-10-02）

専用QAアプリでLight・19px・1120×800を固定して39サンプル採取した。通常記事の中央値142.38MiB、数式記事246.96MiB、通常記事へ戻した後264.41MiB。戻し区間は205.83〜300.55MiBで変動し、最終値を定常Idleとは扱わない。初回測定にはユーザー操作が入ったため比較から除外する。通常記事は元の100KiBから1byte増えた同じ本文を使用した。詳細と全サンプルは[メモリ調査](performance/memory.md)と[macos-measurements.json](performance/macos-measurements.json)。起動の描画完了、物理入力・検索遅延、全画像スクロール、長時間使用は未測定で、仕様§16の性能合格判定は保留。

`npm run tauri build -- --bundles app,dmg --ci`で製品識別子app.nagori.editorのアプリとarm64 DMGを生成。アプリは15.43MiB、DMGは8,914,861 bytes、8.50MiB。DMGのSHA-256はf50776a2d9ebbc62ce79f565fe2f5d84ba1881529376b755542bab13357f0712。hdiutilの内部チェックサム検証に成功し、読み取り専用でマウントして製品識別子・Applicationsリンク・署名・実行ファイルと同梱CLIの一致を確認した。検証マウントは解除済み。製品実行ファイルのSHAは上記と同じ。

Developer ID Application証明書は0件、公証用の環境変数も未設定。Tauriも公証のスキップを記録した。今回の署名はad-hocで、外部配布用の署名・公証ではない。Finderからのインストール、パレットの認証、Gatekeeperの外部配布判定は未検証。本番リリース・mainへの反映は行わない。

## 外部配布用の署名手順とVite警告の調査（2026-10-02）

scripts/release-sign.shを追加し、npm run release:signとrelease:sign:checkから呼べるようにした。環境変数で証明書名と公証資格情報が与えられた時だけ、署名・公証つきでビルドし、codesign strict、spctl、staplerで検証する。足りない場合は何も署名せず、案内を出して終了コード2で終わる。シェル構文のチェックと、環境変数なし・ad-hoc指定・公証資格情報なし・証明書がキーチェーンにない場合の案内表示を確認した。実際の署名・公証は、証明書が0件のため実行していない。署名つきビルドの成功は未検証。

Viteの500kB超チャンク警告は、今回は解消していない。警告の対象はmathjax（555.59kB）とindex（644.59kB）の2つ。mathjaxはすでに数式の描画時だけ動的に読み込む。数式エンジン本体が単一のモジュールで、これ以上は遅延で小さくできない。indexはSvelte、CodeMirror、Tauri APIとアプリ本体で、起動直後の画面とエディタに必要。Editorを遅延読み込みにすると起動時の表示が遅れ、IMEや初期化順序の確認をやり直す必要がある。チャンクを分けても起動時に読む総量は変わらない。警告の上限を上げるだけの対応は原因を隠すため行わない。対応する場合は、起動性能とIMEの実機確認とあわせて検討する。

## Mac実機QAの実施結果（2026-10-03、52ebd61）

専用識別子app.nagori.editor.qa20261003のReleaseビルドと、複製した検証用Workspaceを使い、Orcaのcomputer-useで画面を操作した。macOS 26.6.2、Mac16,12。通常のNagoriの設定SHA-256は開始前後で一致した。項目ごとの手順と見えた内容は[Mac実機QA手順書](mac-qa-checklist.md)に書いた。

画面で確認できた範囲は次のとおり。フォルダ選択のキャンセル、Workspace選択、無編集保存でのSHA-256一致、新規作成と500ms後の保存、Quick Open、前回のWorkspaceと記事の復帰。Cmd＋Q、Cmd＋W、閉じるボタンからの終了と、再起動後の本文とディスクの一致。表と画像の記法への切り替え、太字と斜体の入れ子や複数行選択での記号表示。Previewでの記号の非表示、チェックボックスと文字入力の無効、検索。保存失敗の理由表示、切り替えと終了の停止、再試行、別名保存、破棄の確認。外部更新のReload、競合の表示と確認文、外部のRenameと削除での本文保持と再作成なし。日本語変換中の候補表示、Escapeでのキャンセル、変換中の自動保存停止。

2026-10-03の追記。スクロールのずれは、切り替え時のscrollTopをピクセル値のまま戻していたことが原因と考えられるため、末尾にいた場合は新しい末尾へ合わせる修正を入れた。判定関数はNodeで確認し、WKWebViewでの再確認は未実施。Previewのコピーは、仕様§9.2が選択されたソース上のMarkdownテキストを対象と明記しており、現在の動作がこれに沿うため修正しない。この扱いは依頼者が確認した。

見つかった不具合候補は3つある。終了のApple Eventをosascriptで送ると、直前に入力した語が保存されずに終了した（2回続けて再現、Cmd＋Qでは保存された。Dockの実操作は未確認）。この不具合は、tao 0.37.1の読み取りから、Apple Eventの終了がRunEvent::ExitRequestedを通らずフロントの保存も待たないことが原因と判断し、src-tauri/src/lib.rsのapple_quitで直した。修正後のQAアプリで同じ手順を3回送り、3回とも入力が記事に残った。末尾までスクロールしてPreviewと往復すると、表示位置が約1行半ずれた。Previewで全選択してコピーすると、Markdownソース全文が貼り付けられた。操作ツールのtype-textで入力した直後に本文が崩れたことが1回あるが、アプリの不具合かツールの入力方式かは切り分けていない。

未確認のまま残るのは、アプリメニューとDockからの終了、日本語IMEの再変換と変換中の記事切り替えとパレット抑止、未完の記法の入力、Previewでの画像と数式付近の操作とUndo、保存と編集が重なる連続入力、Rename、Finder、ゴミ箱、キーボードだけの一連操作（項目10と12は、右クリックの直後にOrcaの操作接続が切れたため中断）。画像挿入、CLI登録、安全性、性能は今回の対象外。仕様§16の合格判定は引き続き保留する。

## 受け入れ条件ごとの現在地

| §16 | 確認できた範囲 | 残るネイティブ確認 |
|---|---|---|
| 1 作成・検索・保存・復帰 | ファイルAPI、ブラウザの作成／Quick Open、設定roundtrip | 終了→再起動で前回のプロジェクト・記事へ復帰 |
| 2 原文保持 | RustでBOM／CRLF／空白と無編集保存、表示変更とUndoのNodeチェック | アプリから無編集保存したバイト列の確認 |
| 3 Markdown・未対応記法 | 構文・Front Matter・Raw HTMLの原文保持、実Editorのブラウザ表示 | 実記事での未完成記法・長文編集 |
| 4 IME・基本編集・Undo | 変換中の装飾維持／本文同期、Formatting、保存世代とUndo | Mac IME候補・キャンセル・再変換、コピー／貼付／Redo |
| 5 選択・表・画像 | 選択境界のNodeチェック、変換中の画像／表DOM維持 | WKWebViewでクリック・複数行選択・スクロール位置 |
| 6 画像挿入 | Rustで形式・上限・同名非上書き、相対参照生成 | 実画像の選択・挿入・プレビュー・Undo |
| 7 保存世代 | 連続編集・並行flush・変換中開始・失敗時の最新本文保持、2世代目の失敗で1世代目だけ完了、保存中の終了要求は最終世代の完了まで待つ（Node） | 編集直後の切替・終了とディスク保存の一連操作 |
| 8 保存失敗・救済 | Rustのstaging失敗／readonly、Nodeの共有flush失敗、別名救済API。追加：失敗コード別の状態表示と本文保持、失敗後の編集保持と再試行、失敗中は終了側のflushが停止し再書き込みしないこと（Node）。符号化失敗・上限超過・readonlyで元ファイルと一時ファイルが残らないこと、readonlyからの別名保存、別名保存の上書き拒否・範囲外拒否・BOM／CRLF引き継ぎ（Rust） | 保存失敗UIの再試行・別名保存・終了停止 |
| 9 外部更新 | Rustの比較基準チェック、遅延読み取りとIME競合のブラウザ再現。追加：自分の保存後の基準が読み直しと一致、同一バイト列の書き戻しは競合にならず外部の別内容は競合、不正UTF-8・混在改行・上限超過の外部更新で上書きしない（Rust）。未保存なしのReloadと新基準での保存、競合のReload・確認済み基準での再開、変換中のReload後も保存を止めること（Node）。checkExternalと終了の呼び出し順はsrc/lib/appFlow.tsへ抜き出し、IPCとDOMを差し替えてNodeで確認した。確認内容は、変換中は確認を保留して変換後に再開すること、読み取り中に変換が始まると結果を反映せず保留すること、未保存の編集がある状態で外部更新を検知すると競合として本文を保持し自動保存を止めること、保存失敗中は終了が止まり設定保存も終了も行わないこと、終了前の保存が共通のflushを通ることである（Node） | OS監視通知、自分の保存通知、実ファイルReload／競合UI。App.svelteからappFlow.tsを呼ぶ配線と、Cmd+Q、Cmd+W、閉じるボタン、Dock終了の各経路から実際に終了要求が届くことは、GUIで未確認。外部更新が上限超過の場合は保存がCONFLICTでなくLIMITで止まる（本文は上書きされない） |
| 10 外部削除 | ファイル／Workspace消失時に再作成せず、復帰後も再比較。追加：ファイル削除後の保存・再読み込みがMISSINGで再作成しないこと、削除後の別名救済、別内容で作り直された場合のCONFLICT、ディレクトリへの置換で書き込まないこと（Rust）。MISSING後に本文を保持し、救済済み世代だけを完了にすること（Node） | 外部Rename／削除とUI・監視の復帰 |
| 11 Rename・ゴミ箱 | Mac実ファイルで親／case-only Rename・同名拒否後の保存 | アプリのパス更新、Finder表示、OSゴミ箱と失敗時保持 |
| 12 安全性 | UTF-8／上限／画像／symlink／範囲外参照をRust、HTML非実行をNodeで確認 | アプリの各エラー表示を確認 |
| 13 キーボード・状態表示 | ブラウザでQuick Open／Formatting／状態表示、終了経路の共通flushをコード確認 | Cmd＋Q／Cmd＋W／閉じるボタン／Dock終了、キーボード一連操作 |
| 14 性能 | ブラウザ参考計測と専用QAの実機メモリ | WKWebViewで固定条件の起動・入力・検索・Idle／長時間メモリ |

## 次に確認すること

複製した記事とReleaseアプリを使い、保存失敗・外部更新・削除時の本文保持と終了停止を確認する。続いてCmd＋Q、Cmd＋W、閉じるボタン、アプリメニュー、Dock終了から再起動までを試し、最新の本文と前回のWorkspace・記事が復元されるか確かめる。

日本語IMEでは候補表示、確定、キャンセル、再変換を行い、Live PreviewとUndoを確認する。パレットからCLIを登録・解除し、管理者認証が必要な場合の成功・キャンセルと、既存コマンドを保持することも確認する。表・画像の選択、Previewでのコピー、画像挿入とUndo、Rename、Finder・ゴミ箱の操作が残る。

性能は起動の描画完了、入力・Quick Open、全画像のスクロール、長時間メモリを実機で測定する。数式表示では再処理回数を記録し、記事を切り替えた後の保持を調べる。外部配布用の署名・公証は未設定で、本番リリースの判定は保留。

## 記録の参照先

[ブラウザでの参考性能](performance/browser-baseline.md)はWKWebViewの合格判定には使わない。個別修正の経緯と以前のテスト件数・ビルド値は[検証履歴](history/verification.md)に残す。測定条件は[メモリ調査](performance/memory.md)、今後の作業順は[実装計画](implementation-plan.md)を参照。
