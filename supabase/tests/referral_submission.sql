-- A family submits through a link. The happy path writes one household,
-- its people, items and contact email, and burns the link. Every refusal
-- path refuses: used, expired, unknown, no consent, identifying text. And
-- an anonymous caller can read none of it back afterwards.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test');
insert into profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'admin');

-- Links are made as the admin.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
create temporary table link_a as select * from create_referral_link();
create temporary table link_b as select * from create_referral_link();
create temporary table link_c as select * from create_referral_link();
reset role;

-- The temp tables above belong to the authenticated role; the family below
-- is anon, so it needs leave to read them (and the payload table).
grant select on link_a, link_b, link_c to anon;

-- An already-expired link, planted directly.
insert into referral_links (token_hash, expires_at)
values (sha256(convert_to('expired-token', 'UTF8')), now() - interval '1 day');

create temporary table good as select jsonb_build_object(
  'summary', 'Household of 3 — mom & two kids, ages 4 and 9',
  'story', 'Work hours were cut in the autumn. Warm clothes first, then one thing each to open.',
  'email', 'Family.Test@example.test',
  'consent_wish_list', true,
  'is_guardian', true,
  'consent_story', true,
  'members', jsonb_build_array(
    jsonb_build_object('role', 'boy', 'age', 9, 'clothing_size', 'Shirt 10', 'shoe_size', '3',
                       'needs', 'Winter coat, jeans', 'would_love', 'Chapter books'),
    jsonb_build_object('role', 'girl', 'age', 4, 'clothing_size', '4T', 'shoe_size', '9',
                       'needs', 'Pajamas', 'would_love', 'Stacking toys, board books'),
    jsonb_build_object('role', 'mom', 'clothing_size', 'M', 'needs', 'Grocery gift card')
  )
) as payload;
grant select on good to anon;

-- Everything below happens as the anonymous role, which is what a family is.
set local role anon;

select is(referral_link_status((select token from link_a)), 'valid', 'a fresh link is valid');
select is(referral_link_status('expired-token'), 'expired', 'an expired link says so');
select is(referral_link_status('no-such-token'), 'unknown', 'an unknown link says so');

-- The happy path.
create temporary table submitted as
  select submit_referral((select token from link_a), (select payload from good)) as ref_code;

select matches((select ref_code from submitted), '^#[0-9]+$', 'submission returns a ref code');

select is(referral_link_status((select token from link_a)), 'used', 'the link is burned');

-- A second go on the same link is refused.
select throws_ok(
  format('select submit_referral(%L, (select payload from good))', (select token from link_a)),
  'P0001',
  'This link has already been used.',
  'a used link cannot be used again'
);

select throws_ok(
  $$ select submit_referral('expired-token', (select payload from good)) $$,
  'P0001',
  'This link has expired.',
  'an expired link is refused'
);

select throws_ok(
  $$ select submit_referral('no-such-token', (select payload from good)) $$,
  'P0001',
  'This link is not recognised.',
  'an unknown link is refused'
);

-- No consent, no referral.
select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"consent_wish_list": false}'' from good))', (select token from link_b)),
  'P0001',
  'Please agree to share the story and information with potential donors.',
  'the wish-list consent is required'
);

-- Identifying text is refused, and names what it found.
select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"story": "Call us on (801) 555-0100 any evening."}'' from good))', (select token from link_b)),
  'P0001',
  'Please take out a phone number: the coordinator can reach you by email instead.',
  'a phone number in the story is refused'
);

select throws_ok(
  format('select submit_referral(%L, (select payload || ''{"summary": "Mom and kids at 412 Oak Street"}'' from good))', (select token from link_b)),
  'P0001',
  'Please take out a street address: the coordinator can reach you by email instead.',
  'a street address in the summary is refused'
);

select is(referral_link_status((select token from link_b)), 'valid', 'a refused submission does not burn the link');

-- Anonymous callers read nothing back.
select is((select count(*) from households), 0::bigint, 'anon cannot read households');
select is((select count(*) from household_members), 0::bigint, 'anon cannot read household members');
select is((select count(*) from household_contacts), 0::bigint, 'anon cannot read household contacts');

reset role;

-- As the database itself: what actually landed.
select is(
  (select count(*) from household_members m
   join households h on h.id = m.household_id
   where h.ref_code = (select ref_code from submitted)),
  3::bigint,
  'three people were recorded'
);

select is(
  (select count(*) from wish_items w
   join households h on h.id = w.household_id
   where h.ref_code = (select ref_code from submitted)),
  7::bigint,
  'seven wish items were split out of the comma lists'
);

select * from finish();
rollback;
