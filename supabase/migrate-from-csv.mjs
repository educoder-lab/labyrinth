/**
 * スプレッドシート CSV → Supabase progress 移行
 * 使い方: node supabase/migrate-from-csv.mjs "けやっきー迷路_進捗 - progress.csv"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadConfig() {
  const text = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const url = (text.match(/supabaseUrl:\s*['"]([^'"]+)['"]/) || [])[1];
  const key = (text.match(/supabaseAnonKey:\s*['"]([^'"]+)['"]/) || [])[1];
  if (!url || !key) throw new Error('config.js に supabaseUrl / supabaseAnonKey がありません');
  return { url: url.replace(/\/$/, ''), key };
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  }
  return rows;
}

function mergeCsv(a, b) {
  const set = new Set();
  for (const src of [a, b]) {
    String(src || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((x) => set.add(x));
  }
  return [...set]
    .sort((x, y) => {
      const nx = Number(x);
      const ny = Number(y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
      return String(x).localeCompare(String(y));
    })
    .join(',');
}

function makeKey(grade, className, studentNo) {
  return `G${grade}-C${className}-N${studentNo}`;
}

function normalizeRows(rawRows) {
  const header = rawRows[0].map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['grade', 'className', 'studentNo'];
  for (const k of required) {
    if (idx[k] === undefined) throw new Error(`CSVに列 ${k} がありません`);
  }

  const map = new Map();
  for (let r = 1; r < rawRows.length; r++) {
    const cols = rawRows[r];
    const grade = Number(cols[idx.grade]);
    const className = Number(cols[idx.className]);
    const studentNo = Number(cols[idx.studentNo]);
    if (![grade, className, studentNo].every((n) => Number.isFinite(n) && n > 0)) {
      console.warn(`skip invalid row ${r + 1}:`, cols.join(','));
      continue;
    }
    const key = makeKey(grade, className, studentNo);
    const next = {
      key,
      grade,
      className,
      studentNo,
      cleared: String(cols[idx.cleared] || '').trim(),
      perfect: String(cols[idx.perfect] || '').trim(),
      masterCleared: String(cols[idx.masterCleared] || '').trim(),
      masterPerfect: String(cols[idx.masterPerfect] || '').trim(),
      medals: String(cols[idx.medals] || '').trim(),
      updatedAt: String(cols[idx.updatedAt] || '').trim()
    };
    const prev = map.get(key);
    if (!prev) {
      map.set(key, next);
      continue;
    }
    // 同一生徒は進捗をマージし、新しい更新日時を採用
    map.set(key, {
      key,
      grade,
      className,
      studentNo,
      cleared: mergeCsv(prev.cleared, next.cleared),
      perfect: mergeCsv(prev.perfect, next.perfect),
      masterCleared: mergeCsv(prev.masterCleared, next.masterCleared),
      masterPerfect: mergeCsv(prev.masterPerfect, next.masterPerfect),
      medals: mergeCsv(prev.medals, next.medals),
      updatedAt: [prev.updatedAt, next.updatedAt].sort().pop() || next.updatedAt
    });
  }
  return [...map.values()];
}

async function saveProgress(cfg, row) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/save_progress`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_grade: row.grade,
      p_class_name: row.className,
      p_student_no: row.studentNo,
      p_cleared: row.cleared,
      p_perfect: row.perfect,
      p_master_cleared: row.masterCleared,
      p_master_perfect: row.masterPerfect,
      p_medals: row.medals,
      p_reset: true
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  if (!data.ok) throw new Error(data.error || 'api_error');
  return data;
}

async function main() {
  const csvArg = process.argv[2] || 'けやっきー迷路_進捗 - progress.csv';
  const csvPath = path.isAbsolute(csvArg) ? csvArg : path.join(root, csvArg);
  if (!fs.existsSync(csvPath)) throw new Error(`CSVが見つかりません: ${csvPath}`);

  const cfg = loadConfig();
  const raw = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const rows = normalizeRows(raw);
  console.log(`CSV rows(raw-1)=${raw.length - 1}, unique students=${rows.length}`);

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    try {
      await saveProgress(cfg, row);
      ok += 1;
      process.stdout.write('.');
    } catch (err) {
      fail += 1;
      console.error(`\nFAIL ${row.key}:`, err.message || err);
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
