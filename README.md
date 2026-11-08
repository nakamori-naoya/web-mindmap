# 枝とことば

本人1人がローカルで使う、日本語のマインドマップアプリです。Docker Composeで起動し、SQLiteへ自動保存します。編集内容を外部へ送信する機能はありません。マップ1件につき1つの編集画面で使ってください。

## 起動する

Docker DesktopまたはOrbStackとDocker Composeを起動してから、次を実行します。以下の /path/to/web-mindmap は配置先の絶対パスへ置き換えてください。初回のビルドにはNode.jsイメージとnpmパッケージの取得が必要です。ビルド済みイメージの実行にはインターネット接続は不要です。

```sh
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml up --build -d
```

ブラウザで http://127.0.0.1:4173 を開きます。ホストのポート公開は127.0.0.1だけです。スマートフォンや外部ネットワークへの公開はこの構成の対象外です。

停止は次の操作です。コンテナを削除しても、ホストに保存したSQLiteとバックアップは残ります。

```sh
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml down
```

## 保存と復旧

正式な保存先は /path/to/web-mindmap/data/mindmaps.sqlite です。コンテナ内では /app/data/mindmaps.sqlite に対応します。画面に「保存済み」と表示された内容はSQLiteのコミット成功応答を受信済みです。保存失敗中は編集画面を閉じず、再試行またはJSON出力で保全してください。Undo履歴はブラウザを終了すると消えます。

マップごとに直近5世代の復旧候補を保持します。日次の初回保存後にSQLiteのバックアップAPIで整合したコピーを作り、/path/to/web-mindmap/backup に直近7日分を保持します。コンテナ内の対応先は /app/backup です。日次コピーはその日の初回保存時点であり、当日の最終状態の保証ではありません。重要な編集後は手動バックアップも行ってください。

起動中のマップをまとめてバックアップするには、次を実行します。出力先は自動で日時付きになります。

```sh
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml exec app npm run backup
```

マップ単位のJSON出力も利用できます。ディスク故障に備える場合は、整合したバックアップファイルを別ディスクのユーザー管理先へ複製してください。起動中の正式DBだけをFinder等でコピーする方法は使わないでください。外部サービスへの自動送信はありません。

復元はサーバー停止後に行います。次の例は日次バックアップ /path/to/web-mindmap/backup/mindmaps-2026-11-08.sqlite を復元する場合です。実在する復元元を選んで日付を置き換えてください。

```sh
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml stop app
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml run --rm --no-deps app npm run restore -- /app/backup/mindmaps-2026-11-08.sqlite --confirm
docker compose --project-directory /path/to/web-mindmap -f /path/to/web-mindmap/compose.yaml up -d
```

復元コマンドは元のDBを /path/to/web-mindmap/data 内の日時付き退避ファイルへ保存し、復元前後にSQLiteと文書の整合性を検査します。復元中にサーバーを起動しないでください。ゴミ箱へ移して約30日後に、アプリ内の一覧で完全削除するか確認します。了承するまでは自動削除せず、30日を超えても復元できます。完全削除はマップ名の入力と明示的な承認が必要です。既存バックアップや書き出したファイルは別管理です。

## 開発と検証

ホスト上で開発する場合はNode.js 26を推奨します。Dockerと同時に同じ保存先へ起動しないでください。開発用サーバーは http://127.0.0.1:5173 です。

```sh
npm --prefix /path/to/web-mindmap ci
npm --prefix /path/to/web-mindmap run dev
```

型検査・本番ビルド、ドメイン・SQLite・API試験、ブラウザE2Eは次の操作で実行します。ブラウザE2EにはローカルのChromeを使用します。

```sh
npm --prefix /path/to/web-mindmap run build
npm --prefix /path/to/web-mindmap test
npm --prefix /path/to/web-mindmap run test:e2e
```

ユーザー操作ごとの受け入れ条件は[操作別の索引](docs/acceptance.md)、実施結果と未検証範囲は[検証記録](docs/verification-results.md)に分けて記録します。実機IME変換、Chromeの前版、WindowsのChrome/Edgeの確認は自動試験だけでは保証できません。性能目標は1000ノードで表示2秒、配置反映p95 100ms、操作フレームp95 33msです。実測値がない範囲を達成済みとは扱いません。

## 主要依存と提供範囲

画面はReact、ビルドはViteとTypeScript、実行はNode.js標準のSQLiteです。主要依存の運営元・ライセンス・保守情報は /path/to/web-mindmap/docs/dependencies.md、全導入依存の一覧は /path/to/web-mindmap/docs/dependency-licenses.json に保存しています。

JSONは書式・メモ・添付画像を保つバックアップ形式です。Markdownは見出しと箇条書きから階層を作り、通常段落とコードブロックをメモに残します。Markdown出力は色・文字サイズ・添付画像を保持しません。SVGとPNGは全マップを出力し、PNGは最大4096×4096へ縮小します。共同編集、複数タブ競合、公開認証、PDF、Xmind互換、関連線・境界・要約は対象外です。

## 公開前の検査

公開するのはソースと合成データによる試験記録です。SQLite、バックアップ、秘密鍵、環境変数ファイルはGitとDocker build contextから除外します。Gitleaksとpre-commitでコミット前を検査し、CIでも全取得履歴の秘密情報と公開対象ファイルを検査します。導入・実行と限界は /path/to/web-mindmap/docs/security.md を参照してください。

## アウトラインと長文を編集する

アウトラインを開き、行を選んで「子を追加」「兄弟を追加」を押すと、その場で本文を入力できます。行にフォーカスした状態のTabは子、Enterは兄弟、Spaceは本文編集に使います。編集中のShift+Enterは改行、Enterは確定、Escapeは取消です。変更はキャンバスと同じUndo/RedoとSQLite自動保存の対象になります。

キャンバスの本文欄は入力中の改行と長文に合わせて広がります。画面より長い本文は複数行の入力欄内をスクロールして見直せます。本文は2000文字までで、さらに長い内容はメモに入力します。

## ノードに画像を添付する

トピックを選び「画像」ボタンからファイルを選択するか、画像をノードへドロップします。画像をクリップボードから貼り付ける操作も使えます。添付画像は本文の下に表示され、拡大表示や取り外し、Undoに対応します。

元ファイルのパスや名前は保存せず、画像データを同じSQLiteへ取り込みます。元ファイルを移動しても表示でき、SQLiteバックアップには画像も含まれます。画像付きJSON、SVG、PNGも画像を含めて書き出します。形式・上限・保持と削除の扱いは[画像の保存設計](docs/node-images.md)、確認条件は[画像を添付する](docs/acceptance/19-画像を添付する.md)を参照してください。
