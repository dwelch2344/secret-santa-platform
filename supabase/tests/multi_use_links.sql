-- Multi-use links, email-or-phone contacts, and the private reference.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test');
insert into profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'admin');
update campaigns set status = 'open' where id = '00000000-0000-4000-a000-000000002026';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temporary table link_two as select * from create_referral_link(2);
create temporary table link_one as select * from create_referral_link();
select throws_ok(
  $$ select * from create_referral_link(1001) $$,
  'P0001', 'A link can be used between 1 and 1000 times.',
  'a link cannot allow more than 1000 uses'
);
select is((select max_uses from link_two), 2, 'the limit is returned with the link');
reset role;
grant select on link_two, link_one to anon;

create temporary table base as select jsonb_build_object(
  'summary', 'Household of 2 — one adult, one child',
  'story', 'Short on winter things this year.',
  'consent_wish_list', true,
  'members', jsonb_build_array(jsonb_build_object('role', 'girl', 'age', 6, 'needs', 'Coat'))
) as payload;
grant select on base to anon;

set local role anon;

-- Use 1 of 2: the household itself, email only.
create temporary table first as select submit_referral(
  (select token from link_two),
  (select payload || '{"contact_is":"household","email":"Family@Example.test"}' from base)
) as ref_code;
select is(referral_link_status((select token from link_two)), 'valid', 'after one of two uses the link is still valid');

-- Use 2 of 2: someone on the household's behalf, phone only, with a reference.
create temporary table second as select submit_referral(
  (select token from link_two),
  (select payload || '{"contact_is":"submitter","phone":"(801) 555-0199","submitter_label":"Alpha"}' from base)
) as ref_code;
select is(referral_link_status((select token from link_two)), 'used', 'after the last use the link is exhausted');

-- Use 3: refused.
select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"email":"x@example.test"}'' from base))', (select token from link_two)),
  'P0001', 'This link has already been used.',
  'an exhausted link refuses a further submission'
);

-- Contact rules, on the single-use link (each refusal leaves it usable).
select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"phone":"12"}'' from base))', (select token from link_one)),
  'P0001', 'That phone number does not look right.',
  'a phone with too few digits is refused'
);
select throws_ok(
  format('select submit_referral(%L, (select payload from base))', (select token from link_one)),
  'P0001', 'Please give an email address or a phone number the coordinator can reach you at.',
  'no contact at all is refused'
);
select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"contact_is":"submitter","email":"s@example.test","submitter_label":"Mrs K 801 555 0100"}'' from base))', (select token from link_one)),
  'P0001', 'Please take out a phone number: the coordinator can reach you by email instead.',
  'a phone number inside the reference is refused'
);
select is(referral_link_status((select token from link_one)), 'valid', 'refusals do not consume a use');

-- Both channels, phone preferred.
create temporary table third as select submit_referral(
  (select token from link_one),
  (select payload || '{"contact_is":"household","email":"both@example.test","phone":"+1 801 555 0100","primary_channel":"phone","submitter_label":"ignored for a household"}' from base)
) as ref_code;

reset role;

-- What landed.
select is(
  (select uses from referral_links where id = (select id from link_two)),
  2, 'the link counts two uses'
);
select is(
  (select count(*) from households where referral_link_id = (select id from link_two)),
  2::bigint, 'both households remember their link'
);
select is(
  (select contact_is || '/' || primary_channel || '/' || coalesce(email, '-') || '/' || coalesce(phone, '-')
   from household_contacts c join households h on h.id = c.household_id
   where h.ref_code = (select ref_code from first)),
  'household/email/family@example.test/-',
  'the first contact is the household''s own email, lower-cased'
);
select is(
  (select contact_is || '/' || primary_channel || '/' || coalesce(email, '-') || '/' || coalesce(phone, '-')
   from household_contacts c join households h on h.id = c.household_id
   where h.ref_code = (select ref_code from second)),
  'submitter/phone/-/(801) 555-0199',
  'the second contact is the submitter''s phone'
);
select is(
  (select submitter_label from households where ref_code = (select ref_code from second)),
  'Alpha', 'the private reference is stored for an on-behalf referral'
);
select is(
  (select submitter_label from households where ref_code = (select ref_code from third)),
  '', 'a reference is ignored when the household submits for itself'
);
select is(
  (select primary_channel from household_contacts c join households h on h.id = c.household_id
   where h.ref_code = (select ref_code from third)),
  'phone', 'with both channels the preferred one is kept'
);
select throws_ok(
  $$ insert into household_contacts (household_id, primary_channel) values ((select id from households limit 1), 'email') $$,
  '23514', null,
  'the table itself refuses a contact row with no channel'
);

select * from finish();
rollback;
