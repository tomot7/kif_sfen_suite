# SFEN Viewer & AI Analyzer

## 実行方法
```bash
cd kif_sfen_suite
node server.js
# ブラウザで http://localhost:4173/sfen_viewer/ または /ai_analyzer/ を開く
```

## 前提
- COOP/COEP を満たすため `server.js` で配信してください。
- AI解析は YaneuraOu WASM と shogiops を使用します。外部ネットワーク不要。

## ページ構成
- `index.html`: ハブ
- `sfen_viewer/`: CSV読み込み＋AI解析ボタン
- `data_manager/`: データ管理
- `kif_to_sfen/`: KIF→SFEN 変換
- `ai_analyzer/`: SFEN入力のみでAI解析

## 使い方（AI解析）
- 盤クリックで合法手のみ指せます。持ち駒ボタンで打ち駒選択→盤クリック。
- MultiPV設定と解析時間（秒）を指定して「解析開始」。
- 候補手の「手順を再現」で一手ずつ再現、「この局面を解析する」で解析対象を切替。
