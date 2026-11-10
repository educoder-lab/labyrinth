// 授業用バックエンド設定
// セットアップ手順は README.md の「授業ログイン（Supabase）」を参照
window.LABYRINTH_CONFIG = {
  // ===== 推奨: Supabase =====
  // Project Settings → API の Project URL / anon public key を貼る
  // 両方入っているときだけ Supabase を使い、空なら下の GAS にフォールバックします
  supabaseUrl: 'https://gcdvoricopxbsrwftlvf.supabase.co', // 末尾に /rest/v1 は付けない
  supabaseAnonKey: "sb_publishable_lKI92eCf_ZA1-FHwsMv3Ng_nAETPAJD", // 例: 'eyJhbGciOi...'

  // ===== 旧運用（互換）: Google Apps Script =====
  gasUrl:
    "https://script.google.com/macros/s/AKfycbyAcSQTzi6yadp_AMW9p3Bf7Bal3Mcr9IFeKNa9VpUXFMPG7BvV7c5YB8UVlDhdtxF40A/exec",
  // テスト用（任意）: 教師画面から progress シートを直接開くリンク
  spreadsheetUrl:
    "https://docs.google.com/spreadsheets/d/11TBoaTqr-APfrz1ky0GYd4VEmPbSHGURi9LVnf2CpQU/edit?usp=sharing",
};
