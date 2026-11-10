# Google Apps Script テンプレート（旧運用・互換用）

新規セットアップは **Supabase** を推奨します。  
→ リポジトリの [README.md](../README.md)「授業ログイン（Supabase）」を参照。

このフォルダは、既存のスプレッドシート運用を継続する場合の互換用です。

1. スプレッドシートを新規作成
2. 「拡張機能」→「Apps Script」で `Code.gs` の内容を貼り付け
3. ウェブアプリとしてデプロイ（実行: 自分 / アクセス: 全員）
4. 発行 URL を [`config.js`](../config.js) の `gasUrl` に設定
5. `supabaseUrl` / `supabaseAnonKey` は空のままにする（空だと GAS 側が使われます）
