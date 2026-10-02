# Nagoriの開発資料

更新日2026-10-02。用途に応じて次の文書を参照する。利用・起動・ビルドの手順は[リポジトリのREADME](../README.md)にまとめる。

| 読みたいこと | 文書 |
|---|---|
| アプリの仕様、制限、受け入れ条件 | [仕様書](specification.md) |
| ファイル構成、各処理の担当、データの流れ | [アーキテクチャ](architecture.md) |
| 実装した範囲と今後の作業順 | [実装計画](implementation-plan.md) |
| 確認済みの範囲と残るMac実機確認 | [検証状況](verification.md) |
| Mac実機で順に確認する手順と記入欄 | [Mac実機QA手順書](mac-qa-checklist.md) |
| 最新のメモリ測定と未確定事項 | [メモリ調査](performance/memory.md) |
| ブラウザ上の入力・検索の参考値 | [ブラウザ参考性能](performance/browser-baseline.md) |

## 性能データ

[macos-measurements.json](performance/macos-measurements.json)には実機測定の全サンプルと条件を保存する。[browser-baseline.json](performance/browser-baseline.json)はブラウザfixtureの測定記録。異なる環境の値を混ぜて比較しない。

## 過去の記録

historyには整理前の[実装計画と経緯](history/implementation-plan.md)、[検証記録](history/verification.md)、[メモリ調査](history/memory.md)を保存した。文中の未実装・未測定やテスト件数は記録時点の状態を表す。現在の進捗を調べる時は、上の実装計画と検証状況から読む。

今後、構成や処理の担当を変えたらarchitecture.md、実機確認を行ったらverification.md、性能を測ったらperformanceを更新する。日々の検証結果を仕様書や計画へ重複して追記しない。Gitの運用と日本語の書き方は[AGENTS.md](../AGENTS.md)に従う。
