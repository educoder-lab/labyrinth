# Supabase セットアップ

1. [Supabase](https://supabase.com/) でプロジェクト作成
2. SQL Editor で [`schema.sql`](./schema.sql) を実行
3. Project Settings → API から URL と anon key をコピー
4. リポジトリ直下の [`config.js`](../config.js) に貼り付け

詳細は [README.md](../README.md) を参照。

## 授業前の行作成（任意）

```sql
select seed_class_rows(3, 1, 30); -- 3年1組 1〜30番
```

または教師ダッシュボードの「クラス行を用意」ボタン。
