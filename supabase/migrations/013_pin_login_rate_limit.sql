-- DB-backed rate limiting for the pin-login Edge Function.
-- We record failed attempts keyed by IP and IP+PIN and apply temporary blocks.
-- These RPCs are intended to be callable only by the Edge Function (service_role).

create table if not exists pin_login_failures (
  key text primary key,
  window_started_at timestamptz not null default now(),
  failures int not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pin_login_failures_blocked_until
  on pin_login_failures (blocked_until)
  where blocked_until is not null;

create or replace function pin_login_is_blocked(
  p_ip text,
  p_pin varchar(6)
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  v_now timestamptz := now();
  v_key_ip text := 'ip:' || v_ip;
  v_key_ip_pin text := 'ip_pin:' || v_ip || ':' || p_pin;
  v_blocked_until timestamptz;
begin
  select max(blocked_until)
  into v_blocked_until
  from pin_login_failures
  where key in (v_key_ip, v_key_ip_pin)
    and blocked_until is not null;

  if v_blocked_until is null or v_blocked_until <= v_now then
    return jsonb_build_object('success', true, 'blocked', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'blocked', true,
    'blocked_until', v_blocked_until,
    'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_blocked_until - v_now)))::int)
  );
end;
$$;

revoke all on function pin_login_is_blocked(text, varchar) from public, anon, authenticated;
grant execute on function pin_login_is_blocked(text, varchar) to service_role;

create or replace function pin_login_record_failure(
  p_ip text,
  p_pin varchar(6)
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Tuning knobs:
  -- - IP-only limit protects from broad guessing.
  -- - IP+PIN limit slows targeted guessing from a single IP.
  v_window interval := interval '10 minutes';
  v_block interval := interval '15 minutes';
  v_ip_limit int := 20;
  v_ip_pin_limit int := 5;

  v_ip text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  v_now timestamptz := now();
  v_key_ip text := 'ip:' || v_ip;
  v_key_ip_pin text := 'ip_pin:' || v_ip || ':' || p_pin;

  v_blocked_until timestamptz;
begin
  -- Update the IP-level counter.
  perform 1 from pin_login_failures where key = v_key_ip for update;
  if not found then
    insert into pin_login_failures (key, window_started_at, failures, blocked_until, updated_at)
    values (v_key_ip, v_now, 1, null, v_now);
  else
    update pin_login_failures
    set
      window_started_at = case
        when blocked_until is null and window_started_at < (v_now - v_window) then v_now
        else window_started_at
      end,
      failures = case
        when blocked_until is not null and blocked_until > v_now then failures
        when window_started_at < (v_now - v_window) then 1
        else failures + 1
      end,
      blocked_until = case
        when blocked_until is not null and blocked_until > v_now then blocked_until
        when (case
          when window_started_at < (v_now - v_window) then 1
          else failures + 1
        end) >= v_ip_limit then v_now + v_block
        else null
      end,
      updated_at = v_now
    where key = v_key_ip;
  end if;

  -- Update the IP+PIN-level counter.
  perform 1 from pin_login_failures where key = v_key_ip_pin for update;
  if not found then
    insert into pin_login_failures (key, window_started_at, failures, blocked_until, updated_at)
    values (v_key_ip_pin, v_now, 1, null, v_now);
  else
    update pin_login_failures
    set
      window_started_at = case
        when blocked_until is null and window_started_at < (v_now - v_window) then v_now
        else window_started_at
      end,
      failures = case
        when blocked_until is not null and blocked_until > v_now then failures
        when window_started_at < (v_now - v_window) then 1
        else failures + 1
      end,
      blocked_until = case
        when blocked_until is not null and blocked_until > v_now then blocked_until
        when (case
          when window_started_at < (v_now - v_window) then 1
          else failures + 1
        end) >= v_ip_pin_limit then v_now + v_block
        else null
      end,
      updated_at = v_now
    where key = v_key_ip_pin;
  end if;

  -- Return the effective block status (max of both scopes).
  select max(blocked_until)
  into v_blocked_until
  from pin_login_failures
  where key in (v_key_ip, v_key_ip_pin)
    and blocked_until is not null;

  if v_blocked_until is null or v_blocked_until <= v_now then
    return jsonb_build_object('success', true, 'blocked', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'blocked', true,
    'blocked_until', v_blocked_until,
    'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_blocked_until - v_now)))::int)
  );
end;
$$;

revoke all on function pin_login_record_failure(text, varchar) from public, anon, authenticated;
grant execute on function pin_login_record_failure(text, varchar) to service_role;

create or replace function pin_login_record_success(
  p_ip text,
  p_pin varchar(6)
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  v_key_ip text := 'ip:' || v_ip;
  v_key_ip_pin text := 'ip_pin:' || v_ip || ':' || p_pin;
begin
  -- Best-effort cleanup to avoid punishing users after a successful login.
  delete from pin_login_failures where key in (v_key_ip, v_key_ip_pin);
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function pin_login_record_success(text, varchar) from public, anon, authenticated;
grant execute on function pin_login_record_success(text, varchar) to service_role;

