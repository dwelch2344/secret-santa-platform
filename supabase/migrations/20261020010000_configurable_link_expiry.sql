-- Link expiry becomes a per-link choice instead of a fixed seven days, the
-- same way the number of uses already is.

drop function create_referral_link(integer);

create or replace function create_referral_link(p_max_uses integer default 1, p_expires_days integer default 7)
returns table (id uuid, token text, expires_at timestamptz, max_uses integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can create referral links'
      using errcode = '42501';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'A link can be used between 1 and 1000 times.';
  end if;
  if p_expires_days is null or p_expires_days < 1 or p_expires_days > 90 then
    raise exception 'A link can stay open between 1 and 90 days.';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires := now() + (p_expires_days || ' days')::interval;

  insert into public.referral_links (token_hash, expires_at, created_by, max_uses)
  values (sha256(convert_to(v_token, 'UTF8')), v_expires, (select auth.uid()), p_max_uses)
  returning referral_links.id into v_id;

  return query select v_id, v_token, v_expires, p_max_uses;
end;
$$;

revoke execute on function create_referral_link(integer, integer) from public, anon;
grant execute on function create_referral_link(integer, integer) to authenticated;
