-- 教師パスワードを sensei-26 に更新（SQL Editor で実行）
update app_config
set value = 'sensei-26'
where key = 'teacherPassword';

-- teacher_login のデフォルトも最新に揃える
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
  delete from teacher_sessions where expires_at < now();

  return jsonb_build_object(
    'ok', true,
    'token', tok,
    'expiresInHours', hours
  );
end;
$$;

grant execute on function public.teacher_login(text) to anon, authenticated;
