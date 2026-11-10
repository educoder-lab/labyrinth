-- 生徒データ削除 RPC を追加（SQL Editor で1回実行）

create or replace function public.delete_student_progress(
  p_token text,
  p_grade integer,
  p_class_name integer,
  p_student_no integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok_session boolean;
  deleted_count integer;
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

  if p_grade is null or p_class_name is null or p_student_no is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_student');
  end if;

  delete from progress
  where grade = p_grade
    and class_name = p_class_name
    and student_no = p_student_no;

  get diagnostics deleted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted', deleted_count,
    'grade', p_grade,
    'className', p_class_name,
    'studentNo', p_student_no
  );
end;
$$;

create or replace function public.delete_class_progress(
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
  deleted_count integer;
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

  if p_grade is null or p_class_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_class_filter');
  end if;

  delete from progress
  where grade = p_grade
    and class_name = p_class_name;

  get diagnostics deleted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted', deleted_count,
    'grade', p_grade,
    'className', p_class_name
  );
end;
$$;

grant execute on function public.delete_student_progress(text, integer, integer, integer) to anon, authenticated;
grant execute on function public.delete_class_progress(text, integer, integer) to anon, authenticated;
