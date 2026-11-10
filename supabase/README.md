# Supabase

1. SQL Editor で [`schema.sql`](./schema.sql) を実行  
2. Project Settings → API の URL / Publishable key を [`../config.js`](../config.js) に設定  
3. （パスワード変更時）[`patch-password.sql`](./patch-password.sql) を実行  
4. （削除機能追加時）[`patch-delete-student.sql`](./patch-delete-student.sql) を実行  

## CSV 移行

```bash
node supabase/migrate-from-csv.mjs "progress.csv"
```
