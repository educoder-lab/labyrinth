-- プログラミングでワールドツアー！ — Supabase スキーマ
-- Supabase Dashboard → SQL Editor に貼り付けて実行してください。

-- ========== テーブル ==========

create table if not exists app_config (
  key text primary key,
  value text not null default ''
);

create table if not exists progress (
  key text primary key,
  grade integer not null,
  class_name integer not null,
  student_no integer not null,
  cleared text not null default '',
  perfect text not null default '',
  master_cleared text not null default '',
  master_perfect text not null default '',
  medals text not null default '',
  updated_at timestamptz not null default now(),
  unique (grade, class_name, student_no)
);

create index if not exists progress_class_idx
  on progress (grade, class_name, student_no);

create table if not exists teacher_sessions (
  token text primary key,
  expires_at timestamptz not null
);

-- 初期設定
insert into app_config (key, value) values
  ('teacherPassword', 'sensei-26'),
  ('allowedGrades', '1,2,3,4,5,6'),
  ('maxStudentNo', '40'),
  ('maxClass', '4')
on conflict (key) do nothing;

-- 既存プロジェクト向け: 教師パスワードを最新値へ揃える
update app_config
set value = 'sensei-26'
where key = 'teacherPassword';

-- ========== RLS（直接テーブル操作は禁止。RPC 経由のみ） ==========

alter table app_config enable row level security;
alter table progress enable row level security;
alter table teacher_sessions enable row level security;

-- 既存ポリシーがあれば落として作り直し
drop policy if exists deny_all_app_config on app_config;
drop policy if exists deny_all_progress on progress;
drop policy if exists deny_all_teacher_sessions on teacher_sessions;

-- ポリシーなし = anon/authenticated は直接アクセス不可
-- （SECURITY DEFINER の RPC のみが操作する）

-- ========== ヘルパー ==========

create or replace function public.make_student_key(
  p_grade integer,
  p_class integer,
  p_student integer
) returns text
language sql
immutable
as $$
  select 'G' || p_grade::text || '-C' || p_class::text || '-N' || p_student::text;
$$;

create or replace function public.merge_csv(a text, b text)
returns text
language sql
immutable
as $$
  with parts as (
    select distinct trim(x) as x
    from unnest(string_to_array(coalesce(a, '') || ',' || coalesce(b, ''), ',')) as x
    where trim(x) <> ''
  )
  select coalesce(
    string_agg(
      x,
      ','
      order by
        case when x ~ '^[0-9]+$' then x::integer end nulls last,
        x
    ),
    ''
  )
  from parts;
$$;

create or replace function public.get_config_value(p_key text, p_default text default '')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from app_config where key = p_key limit 1),
    p_default
  );
$$;

create or replace function public.validate_student(
  p_grade integer,
  p_class integer,
  p_student integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  allowed text;
  max_no integer;
  max_class integer;
  g text;
  ok_grade boolean := false;
begin
  allowed := public.get_config_value('allowedGrades', '1,2,3,4,5,6');
  max_no := public.get_config_value('maxStudentNo', '40')::integer;
  max_class := public.get_config_value('maxClass', '4')::integer;

  foreach g in array string_to_array(allowed, ',') loop
    if trim(g) <> '' and trim(g)::integer = p_grade then
      ok_grade := true;
      exit;
    end if;
  end loop;

  if not ok_grade then
    return jsonb_build_object('ok', false, 'error', 'invalid_grade');
  end if;
  if p_class is null or p_class < 1 or p_class > max_class then
    return jsonb_build_object('ok', false, 'error', 'invalid_class');
  end if;
  if p_student is null or p_student < 1 or p_student > max_no or p_student <> floor(p_student) then
    return jsonb_build_object('ok', false, 'error', 'invalid_student_no');
  end if;

  return jsonb_build_object(
    'ok', true,
    'grade', p_grade,
    'className', p_class,
    'studentNo', p_student
  );
end;
$$;

create or replace function public.progress_to_json(r progress)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'key', r.key,
    'grade', r.grade,
    'className', r.class_name,
    'studentNo', r.student_no,
    'cleared', r.cleared,
    'perfect', r.perfect,
    'masterCleared', r.master_cleared,
    'masterPerfect', r.master_perfect,
    'medals', r.medals,
    'updatedAt', r.updated_at
  );
$$;

-- ========== RPC: 生徒ログイン ==========

create or replace function public.student_login(
  p_grade integer,
  p_class_name integer,
  p_student_no integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  k text;
  row_progress progress;
  created boolean := false;
begin
  v := public.validate_student(p_grade, p_class_name, p_student_no);
  if (v->>'ok')::boolean is not true then
    return v;
  end if;

  k := public.make_student_key(p_grade, p_class_name, p_student_no);

  select * into row_progress from progress where key = k;
  if not found then
    insert into progress (key, grade, class_name, student_no)
    values (k, p_grade, p_class_name, p_student_no)
    returning * into row_progress;
    created := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', created,
    'progress', public.progress_to_json(row_progress)
  );
exception
  when unique_violation then
    -- 同時ログイン競合時は既存行を返す
    select * into row_progress from progress where key = k;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'progress', public.progress_to_json(row_progress)
    );
end;
$$;

-- ========== RPC: 進捗保存 ==========

create or replace function public.save_progress(
  p_grade integer,
  p_class_name integer,
  p_student_no integer,
  p_cleared text default '',
  p_perfect text default '',
  p_master_cleared text default '',
  p_master_perfect text default '',
  p_medals text default '',
  p_reset boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  k text;
  cur progress;
  merged_cleared text;
  merged_perfect text;
  merged_master_cleared text;
  merged_master_perfect text;
  merged_medals text;
  saved progress;
begin
  v := public.validate_student(p_grade, p_class_name, p_student_no);
  if (v->>'ok')::boolean is not true then
    return v;
  end if;

  k := public.make_student_key(p_grade, p_class_name, p_student_no);
  select * into cur from progress where key = k;

  if not found then
    insert into progress (
      key, grade, class_name, student_no,
      cleared, perfect, master_cleared, master_perfect, medals, updated_at
    ) values (
      k, p_grade, p_class_name, p_student_no,
      coalesce(p_cleared, ''), coalesce(p_perfect, ''),
      coalesce(p_master_cleared, ''), coalesce(p_master_perfect, ''),
      coalesce(p_medals, ''), now()
    )
    returning * into saved;

    return jsonb_build_object('ok', true, 'progress', public.progress_to_json(saved));
  end if;

  if p_reset then
    merged_cleared := coalesce(p_cleared, '');
    merged_perfect := coalesce(p_perfect, '');
    merged_master_cleared := coalesce(p_master_cleared, '');
    merged_master_perfect := coalesce(p_master_perfect, '');
    merged_medals := coalesce(p_medals, '');
  else
    merged_cleared := public.merge_csv(cur.cleared, p_cleared);
    merged_perfect := public.merge_csv(cur.perfect, p_perfect);
    merged_master_cleared := public.merge_csv(cur.master_cleared, p_master_cleared);
    merged_master_perfect := public.merge_csv(cur.master_perfect, p_master_perfect);
    merged_medals := public.merge_csv(cur.medals, p_medals);
  end if;

  update progress set
    cleared = merged_cleared,
    perfect = merged_perfect,
    master_cleared = merged_master_cleared,
    master_perfect = merged_master_perfect,
    medals = merged_medals,
    updated_at = now()
  where key = k
  returning * into saved;

  return jsonb_build_object('ok', true, 'progress', public.progress_to_json(saved));
end;
$$;

-- ========== RPC: 教師ログイン ==========

create or replace function public.teacher_login(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  tok text;
  hours integer := 8;
begin
  -- 新パスワードでログインされたら DB も更新（旧 sensei からの移行用）
  if p_password = 'sensei-26' then
    update app_config set value = 'sensei-26' where key = 'teacherPassword';
    expected := 'sensei-26';
  else
    expected := public.get_config_value('teacherPassword', 'sensei-26');
  end if;

  if p_password is null or p_password = '' or p_password <> expected then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;

  tok := replace(gen_random_uuid()::text, '-', '');
  insert into teacher_sessions (token, expires_at)
  values (tok, now() + make_interval(hours => hours));

  -- 期限切れセッション掃除
  delete from teacher_sessions where expires_at < now();

  return jsonb_build_object(
    'ok', true,
    'token', tok,
    'expiresInHours', hours
  );
end;
$$;

-- ========== RPC: クラス進捗 ==========

create or replace function public.get_class_progress(
  p_token text,
  p_grade integer,
  p_class_name integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok_session boolean;
  students jsonb;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select exists(
    select 1 from teacher_sessions
    where token = p_token and expires_at > now()
  ) into ok_session;

  if not ok_session then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_grade is null or p_grade = 0 or p_class_name is null or p_class_name = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_class_filter');
  end if;

  select coalesce(jsonb_agg(public.progress_to_json(p) order by p.student_no), '[]'::jsonb)
  into students
  from progress p
  where p.grade = p_grade and p.class_name = p_class_name;

  return jsonb_build_object(
    'ok', true,
    'grade', p_grade,
    'className', p_class_name,
    'students', students
  );
end;
$$;

-- ========== 任意: 授業前にクラス分の行を一括作成 ==========

create or replace function public.seed_class_rows(
  p_grade integer,
  p_class_name integer,
  p_max_student integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  k text;
begin
  for i in 1..greatest(1, least(coalesce(p_max_student, 30), 40)) loop
    k := public.make_student_key(p_grade, p_class_name, i);
    insert into progress (key, grade, class_name, student_no)
    values (k, p_grade, p_class_name, i)
    on conflict (key) do nothing;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'grade', p_grade,
    'className', p_class_name,
    'maxStudent', p_max_student
  );
end;
$$;

-- ========== 権限 ==========

grant usage on schema public to anon, authenticated;

grant execute on function public.student_login(integer, integer, integer) to anon, authenticated;
grant execute on function public.save_progress(integer, integer, integer, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.teacher_login(text) to anon, authenticated;
grant execute on function public.get_class_progress(text, integer, integer) to anon, authenticated;
grant execute on function public.seed_class_rows(integer, integer, integer) to anon, authenticated;

-- 直接テーブル権限は付与しない（RPC のみ）
