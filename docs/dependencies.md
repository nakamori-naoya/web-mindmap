# 依存の採用確認

実行時に外部SaaSへ接続する依存はありません。画面とAPIは同梱し、SQLiteをNode.js標準機能で利用します。中国系運営サービスを使わない条件は外部サービスの運営と主要ライブラリの管理主体を確認するものとし、個々のOSS貢献者の国籍を保証するものではありません。

## 主要依存

2026年11月8日に公式ドキュメント、公式リポジトリ、npmのパッケージ配布メタデータを確認しました。採用版の公開日は更新が続いているかを判断する観測値であり、将来の保守保証ではありません。

| 依存 | 導入版 | 管理主体 | ライセンス | 採用版の公開日 |
| --- | --- | --- | --- | --- |
| React / React DOM | 19.3.1 | ReactコミュニティとLeadership Council | MIT | 2026-10-14 |
| Vite | 7.3.7 | Vite国際チーム・VoidZero | MIT | 2026-10-06 |
| TypeScript | 5.9.3 | Microsoft | Apache-2.0 | 2025-09-30 |
| tsx | 4.23.15 | privatenumber / OSS | MIT | 2026-09-20 |
| Playwright | 1.65.0 | Microsoft | Apache-2.0 | 2026-11-05 |
| Vite React plugin | 5.2.0 | Viteチーム | MIT | 2026-03-12 |
| Node.js / node:sqlite | 26系 | OpenJS Foundation・Node.jsプロジェクト | MITほか同梱ライセンス | 実行環境による |

Reactは[公式チーム](https://react.dev/community/team)、Viteは[公式チーム](https://vite.dev/team)と[VoidZero](https://voidzero.dev/about)、Node.jsは[ガバナンス](https://nodejs.org/en/about/governance)を管理主体の根拠にしています。Viteの国際チームにはさまざまな背景の貢献者がいますが、Viteを外部サービスとして利用する構成ではありません。tsxは[公式リポジトリ](https://github.com/privatenumber/tsx)を公開するOSSで、運営企業や個人の国籍は断定していません。仕様が避ける外部SaaSへの依存には当たりません。

## 保守情報と再現性

全導入パッケージの版・ライセンス・リポジトリは /path/to/web-mindmap/docs/dependency-licenses.json、主要依存の公式配布時刻は /path/to/web-mindmap/docs/dependency-maintenance.json に保存しています。正確な解決版は /path/to/web-mindmap/package-lock.json に固定し、Dockerはnpm ciで取得します。npm auditは初回導入時に脆弱性0件でした。CIでもhigh以上を検査します。

[Reactのソース](https://github.com/react/react)、[Viteのソース](https://github.com/vitejs/vite)、[TypeScriptのソース](https://github.com/microsoft/TypeScript)、[Playwrightのソース](https://github.com/microsoft/playwright)、[Node.js SQLiteの公式API](https://nodejs.org/api/sqlite.html)が一次資料です。Node.jsのSQLiteバックアップAPIを使い、起動中のDBファイルを単純コピーしません。

## 開発時の情報保護ツール

Gitleaks 8.30.1（Gitleaks OSS、MIT）とpre-commit 4.7.0（pre-commit OSS、MIT）を開発環境の検査に使う。いずれもアプリの実行時依存や外部SaaSではない。pre-commitは公式PyPI配布をuv toolで導入し、版を /path/to/web-mindmap/requirements-security.txt に記録した。Gitleaksはホストの既存導入を利用し、CIは公式配布物と固定SHA256を使う。公式の保守方針・導入・検査の限界は /path/to/web-mindmap/docs/security.md にまとめた。
