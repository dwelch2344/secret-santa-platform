-- Final form copy, 2026-10-22 (S4S Nominations 2026 doc): the person
-- submitting attests "I am the parent/guardian of the children listed",
-- required, and one agreement covers sharing the story and information
-- with potential donors. The not-a-guardian path is gone, so every contact
-- is the household's own.

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
  v_note text;
  v_household_name text;
  v_submitter_name text;
  v_source text;
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
    raise exception 'Please agree to share the story and information with potential donors.';
  end if;
  if coalesce((p_referral->>'is_guardian')::boolean, false) is not true then
    raise exception 'The form must be filled in by the parent or guardian of the children listed.';
  end if;
  if jsonb_typeof(p_referral->'members') is distinct from 'array'
     or jsonb_array_length(p_referral->'members') not between 1 and 12 then
    raise exception 'Please list between one and twelve people.';
  end if;

  -- The contact.
  -- 2026-10-21: one checkbox, "I am not the parent or guardian", replaces
  -- the who-is-filling-this-in choice. The older key is still accepted.
  v_contact_is := case
    when coalesce((p_referral->>'not_guardian')::boolean, false) then 'submitter'
    else coalesce(nullif(trim(p_referral->>'contact_is'), ''), 'household')
  end;
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

  -- The note to the coordinator, and the contact first names (allowed
  -- 2026-10-21, admin-only, in the contacts table).
  v_note := left(trim(coalesce(p_referral->>'coordinator_note', '')), 1500);
  -- The person filling in the form gives their first name; older clients
  -- sent it as household_first_name.
  v_household_name := nullif(left(trim(coalesce(p_referral->>'first_name', p_referral->>'household_first_name', '')), 40), '');
  v_source := nullif(left(trim(coalesce(p_referral->>'referral_source', '')), 120), '');
  v_submitter_name := case when v_contact_is = 'submitter'
                           then nullif(left(trim(coalesce(p_referral->>'submitter_first_name', '')), 40), '')
                      end;

  -- The text guard, on every free-text field, the note and names included.
  for v_text in
    select p_referral->>'summary'
    union all select p_referral->>'story'
    union all select v_label
    union all select v_note
    union all select coalesce(v_household_name, '')
    union all select coalesce(v_submitter_name, '')
    union all select coalesce(v_source, '')
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
    consent_wish_list, consent_story, referral_link_id, submitter_label, family_note
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
    v_label,
    v_note
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
  insert into public.household_contacts (household_id, email, phone, primary_channel, contact_is, household_first_name, submitter_first_name, referral_source)
  values (v_household_id, v_email, v_phone, v_primary, v_contact_is, v_household_name, v_submitter_name, v_source);

  -- Count the use; exhaust the link on the last one.
  update public.referral_links
  set uses = uses + 1,
      used_at = case when uses + 1 >= max_uses then now() else used_at end
  where id = v_link.id;

  return v_ref_code;
end;
$$;

grant execute on function submit_referral(text, jsonb) to anon, authenticated;
