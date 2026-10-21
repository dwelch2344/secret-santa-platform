-- Three changes to the referral chain, decided by David on 2026-10-20.
--
-- 1. A referral link may be used up to 1000 times. `max_uses` is set at
--    creation; `uses` counts submissions; `used_at` now means "exhausted
--    at". A household remembers which link it came through.
-- 2. The contact can be an email, a phone, or both, with a preferred
--    channel, and it belongs either to the household itself or to the
--    person who submitted on their behalf. A household's own phone number
--    is new: it lives in the same private table as the email, admin-only,
--    never public, deleted on rejection. (The 2026-10-10 "email only"
--    decision is changed here, on the record.)
-- 3. An on-behalf submitter may keep a private reference per household
--    ("Alpha", "Family 3"), up to 40 characters, shown to the coordinator
--    only. The form and the queue both steer it away from names.

-- ---------- 1. links ----------

alter table referral_links
  add column max_uses integer not null default 1 check (max_uses between 1 and 1000),
  add column uses integer not null default 0 check (uses >= 0);

alter table households
  add column referral_link_id uuid references referral_links (id);

create index households_referral_link_id_idx on households (referral_link_id);

-- Carry the old one-to-one over, then drop the old column.
update households h
set referral_link_id = l.id
from referral_links l
where l.household_id = h.id;

update referral_links set uses = 1 where household_id is not null;

alter table referral_links drop column household_id;

-- ---------- 2. contacts ----------

alter table household_contacts
  alter column email drop not null,
  add column phone text check (phone is null or length(phone) between 7 and 40),
  add column primary_channel text not null default 'email'
    check (primary_channel in ('email', 'phone')),
  add column contact_is text not null default 'household'
    check (contact_is in ('household', 'submitter')),
  add constraint household_contacts_has_a_channel
    check (email is not null or phone is not null),
  add constraint household_contacts_primary_exists check (
    (primary_channel = 'email' and email is not null)
    or (primary_channel = 'phone' and phone is not null)
  );

-- ---------- 3. the private reference ----------

alter table households
  add column submitter_label text not null default ''
    check (length(submitter_label) <= 40);

-- ---------- the functions ----------

drop function create_referral_link();

create or replace function create_referral_link(p_max_uses integer default 1)
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

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.referral_links (token_hash, expires_at, created_by, max_uses)
  values (sha256(convert_to(v_token, 'UTF8')), v_expires, (select auth.uid()), p_max_uses)
  returning referral_links.id into v_id;

  return query select v_id, v_token, v_expires, p_max_uses;
end;
$$;

revoke execute on function create_referral_link(integer) from public, anon;
grant execute on function create_referral_link(integer) to authenticated;

-- 'used' now means exhausted.
create or replace function referral_link_status(p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
       when uses >= max_uses then 'used'
       when expires_at < now() then 'expired'
       else 'valid'
     end
     from public.referral_links
     where token_hash = sha256(convert_to(p_token, 'UTF8'))),
    'unknown'
  );
$$;

-- The submission, with the new contact shape and the private reference.
--
-- p_referral gains:
--   "contact_is": "household" | "submitter"
--   "email": "...", "phone": "..."        (one or both)
--   "primary_channel": "email" | "phone"  (needed only when both are given)
--   "submitter_label": "Alpha"            (on-behalf only, optional)
create or replace function submit_referral(p_token text, p_referral jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.referral_links%rowtype;
  v_household_id uuid;
  v_ref_code text;
  v_member jsonb;
  v_member_id uuid;
  v_position integer := 0;
  v_item text;
  v_item_position integer;
  v_problem text;
  v_text text;
  v_contact_is text;
  v_email text;
  v_phone text;
  v_primary text;
  v_label text;
begin
  -- The link.
  select * into v_link
  from public.referral_links
  where token_hash = sha256(convert_to(p_token, 'UTF8'))
  for update;

  if not found then
    raise exception 'This link is not recognised.';
  elsif v_link.uses >= v_link.max_uses then
    raise exception 'This link has already been used.';
  elsif v_link.expires_at < now() then
    raise exception 'This link has expired.';
  end if;

  if (select status from public.campaigns where id = v_link.campaign_id) <> 'open' then
    raise exception 'This drive is closed to new referrals.';
  end if;

  -- The shape.
  if coalesce(length(trim(p_referral->>'summary')), 0) not between 5 and 120 then
    raise exception 'Please describe the household in one line (up to 120 characters).';
  end if;
  if coalesce(length(p_referral->>'story'), 0) > 1500 then
    raise exception 'The story can be up to 1500 characters.';
  end if;
  if coalesce((p_referral->>'consent_wish_list')::boolean, false) is not true then
    raise exception 'An adult in the household needs to agree to share the wish list.';
  end if;
  if jsonb_typeof(p_referral->'members') is distinct from 'array'
     or jsonb_array_length(p_referral->'members') not between 1 and 12 then
    raise exception 'Please list between one and twelve people.';
  end if;

  -- The contact.
  v_contact_is := coalesce(nullif(trim(p_referral->>'contact_is'), ''), 'household');
  if v_contact_is not in ('household', 'submitter') then
    raise exception 'Please say whose contact details these are.';
  end if;
  v_email := nullif(lower(trim(coalesce(p_referral->>'email', ''))), '');
  v_phone := nullif(trim(coalesce(p_referral->>'phone', '')), '');
  if v_email is not null and (v_email not like '%_@_%' or length(v_email) > 200) then
    raise exception 'That email address does not look right.';
  end if;
  if v_phone is not null and (
       length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15
       or v_phone !~ '^[0-9+()\s.-]+$'
     ) then
    raise exception 'That phone number does not look right.';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Please give an email address or a phone number the coordinator can reach you at.';
  end if;
  v_primary := coalesce(nullif(trim(p_referral->>'primary_channel'), ''),
                        case when v_email is not null then 'email' else 'phone' end);
  if v_primary not in ('email', 'phone')
     or (v_primary = 'email' and v_email is null)
     or (v_primary = 'phone' and v_phone is null) then
    raise exception 'Please choose a preferred way to be reached that you have given.';
  end if;

  -- The private reference, on-behalf only.
  v_label := case when v_contact_is = 'submitter'
                  then left(trim(coalesce(p_referral->>'submitter_label', '')), 40)
                  else '' end;

  -- The text guard, on every free-text field, the reference included.
  for v_text in
    select p_referral->>'summary'
    union all select p_referral->>'story'
    union all select v_label
    union all select m->>'needs' from jsonb_array_elements(p_referral->'members') m
    union all select m->>'would_love' from jsonb_array_elements(p_referral->'members') m
    union all select m->>'clothing_size' from jsonb_array_elements(p_referral->'members') m
    union all select m->>'shoe_size' from jsonb_array_elements(p_referral->'members') m
  loop
    v_problem := public.identifying_text_problem(coalesce(v_text, ''));
    if v_problem is not null then
      raise exception 'Please take out %: the coordinator can reach you by email instead.', v_problem;
    end if;
  end loop;

  -- The household.
  v_ref_code := '#' || nextval('public.household_ref_seq');

  insert into public.households (
    campaign_id, ref_code, summary, story, status, referred_on,
    consent_wish_list, consent_story, referral_link_id, submitter_label
  ) values (
    v_link.campaign_id,
    v_ref_code,
    trim(p_referral->>'summary'),
    coalesce(trim(p_referral->>'story'), ''),
    'pending_review',
    now(),
    true,
    coalesce((p_referral->>'consent_story')::boolean, false),
    v_link.id,
    v_label
  )
  returning id into v_household_id;

  -- The people, and their items.
  for v_member in select * from jsonb_array_elements(p_referral->'members') loop
    v_position := v_position + 1;

    insert into public.household_members (
      household_id, position, role, age, clothing_size, shoe_size
    ) values (
      v_household_id,
      v_position,
      v_member->>'role',
      nullif(v_member->>'age', '')::integer,
      coalesce(trim(v_member->>'clothing_size'), ''),
      coalesce(trim(v_member->>'shoe_size'), '')
    )
    returning id into v_member_id;

    v_item_position := 0;
    for v_item in
      select trim(part) from unnest(string_to_array(coalesce(v_member->>'needs', ''), ',')) part
      where length(trim(part)) > 0
    loop
      v_item_position := v_item_position + 1;
      insert into public.wish_items (household_id, member_id, kind, label, position)
      values (v_household_id, v_member_id, 'need', left(v_item, 60), v_item_position);
    end loop;

    for v_item in
      select trim(part) from unnest(string_to_array(coalesce(v_member->>'would_love', ''), ',')) part
      where length(trim(part)) > 0
    loop
      v_item_position := v_item_position + 1;
      insert into public.wish_items (household_id, member_id, kind, label, position)
      values (v_household_id, v_member_id, 'would_love', left(v_item, 60), v_item_position);
    end loop;
  end loop;

  -- The contact, in its own table.
  insert into public.household_contacts (household_id, email, phone, primary_channel, contact_is)
  values (v_household_id, v_email, v_phone, v_primary, v_contact_is);

  -- Count the use; exhaust the link on the last one.
  update public.referral_links
  set uses = uses + 1,
      used_at = case when uses + 1 >= max_uses then now() else used_at end
  where id = v_link.id;

  return v_ref_code;
end;
$$;

grant execute on function submit_referral(text, jsonb) to anon, authenticated;
