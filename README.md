# KIF/SFEN ツール集

KIF棋譜の変換、SFEN局面の閲覧・管理、ブラウザ上のAI解析をまとめたローカル完結のツール集です。

## 構成
- `index.html` : 入口ページ（ハブ）
- `kif_to_sfen/` : KIF → SFEN 変換・分析
- `sfen_viewer/` : SFEN 局面ビューア
- `data_manager/` : SFEN データ管理
- `ai_analyzer/` : AI解析（SFEN入力のみ）
- `server.js` : COOP/COEP対応の簡易サーバ

## 起動方法
AI解析に必要なCOOP/COEPヘッダーを付与するため、`server.js` で配信してください。

```bash
node server.js
# ブラウザで http://localhost:4173/ を開く
```

ポートを変えたい場合は環境変数 `PORT` を指定します。

## 操作方法
`index.html` を開き、使いたいツールを選択します。

### KIF → SFEN 変換
- KIF/KIFUファイルの変換
- KIFテキストの貼り付け変換
- フォルダ内のKIF一括処理（CSV出力）
- 一括処理の出力はCSV/JSONL（軽量）を選択可能
- KIFのヘッダから対局日時を抽出し、出力に含める
- 出力に user_name 列を含め、ユーザー単位管理に対応
- 一括処理では「先手勝利数/後手勝利数/引分数」と「対象ユーザーの先手/後手回数」を集計可能

### SFEN 局面ビューア
- CSV/JSON/JSONLの読み込みに対応
- 出現回数や開始手数でのフィルタ
- コメントの付与と保存
- 先手勝率の表示、対象ユーザーの先手/後手回数の表示
- データ保存はIndexedDBで管理（重複のない局面のみ追加）
- 期間フィルタと任意期間のデータ削除に対応

### AI解析
- 盤クリックで合法手のみ指せます（持ち駒ボタンで打ち駒選択 → 盤クリック）
- MultiPV設定と解析時間（秒）を指定して「解析開始」
- 候補手の「手順を再現」で一手ずつ再現、「この局面を解析する」で解析対象を切替
- YaneuraOu WASM と shogiops を使用（外部ネットワーク不要）

### データ管理
- ユーザー名単位でデータを管理
- 登録データの最古/最新日に合わせた期間指定
- 任意期間のデータ削除

## 機能の連携
- KIF → SFEN の出力（CSV/JSONL）を SFEN 局面ビューアで読み込みます。
- ビューアで追加・コメントしたデータはIndexedDBに保存され、`data_manager/` で同じデータを削除・CSVダウンロードできます（同一オリジンで開いてください）。
- ビューアの局面カードにある「AI解析」から、その局面を直接解析できます。単体解析は `ai_analyzer/` でSFENを入力します。

## 注意事項
- 一括処理のフォルダ選択は、ブラウザによって挙動が異なる場合があります。
- ローカルストレージを利用するため、ブラウザの保存容量に制限があります。

## ライセンス

このプロジェクトは以下のオープンソースプロジェクトのコードを移植して作成されています:

### 移植元プロジェクト

- **lishogi** (https://github.com/WandererXII/lishogi)
  - ライセンス: GNU Affero General Public License v3.0 (AGPL-3.0)
  - 移植機能: 盤面描画、局面表示機能の一部

- **shogiops** (https://github.com/WandererXII/shogiops)
  - ライセンス: GNU General Public License v3.0 (GPL-3.0)
  - 移植機能: SFEN解析、指し手生成、記譜法変換

### 本プロジェクトのライセンス

本プロジェクトは、移植元プロジェクトのライセンス条件に従い、**GNU General Public License v3.0 (GPL-3.0)** の下で公開されます。

詳細は各プロジェクトのライセンスファイルを参照してください:
- lishogi: https://github.com/WandererXII/lishogi/blob/master/LICENSE
- shogiops: https://github.com/WandererXII/shogiops/blob/master/LICENSE.txt
