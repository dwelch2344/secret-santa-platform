-- The locked contact shape: first name, email, phone, who referred them,
-- and the not-a-guardian checkbox; story consent is opt-in.
begin;
select plan(8);

update campaigns set status = 'open' where id = '00000000-0000-4000-a000-000000002026';
insert into referral_links (token_hash, expires_at, max_uses)
values (sha256(convert_to('lockdown-token', 'UTF8')), now() + interval '1 day', 5);

create temporary table base as select jsonb_build_object(
  'summary', 'Household of 2 — one adult, one child',
  'story', 'Hours were cut this autumn.',
  'consent_wish_list', true,
  'is_guardian', true,
  'members', jsonb_build_array(jsonb_build_object('role', 'girl', 'age', 6, 'needs', 'Coat'))
) as payload;
grant select on base to anon;

set local role anon;
create temporary table parent as select submit_referral('lockdown-token',
  (select payload || '{"first_name":"Jamie","email":"jamie@example.test","referral_source":"school counselor"}' from base)) as ref_code;
create temporary table worker as select submit_referral('lockdown-token',
  (select payload || '{"first_name":"Pat","phone":"555 010 0177","not_guardian":true,"consent_story":true}' from base)) as ref_code;
select throws_ok(
  $$ select submit_referral('lockdown-token', (select payload || '{"email":"x@example.test","referral_source":"call 801 555 0100"}' from base)) $$,
  'P0001', null, 'a phone number in the referral source is refused'
);
select throws_ok(
  $$ select submit_referral('lockdown-token', (select (payload - 'is_guardian') || '{"email":"x@example.test"}' from base)) $$,
  'P0001', 'The form must be filled in by the parent or guardian of the children listed.',
  'without the guardian attestation the form is refused'
);
reset role;

select is((select c.household_first_name || '/' || c.contact_is from household_contacts c join households h on h.id = c.household_id where h.ref_code = (select ref_code from parent)),
  'Jamie/household', 'a parent: first name stored, contact is the household');
select is((select c.referral_source from household_contacts c join households h on h.id = c.household_id where h.ref_code = (select ref_code from parent)),
  'school counselor', 'who referred them is stored');
select is((select c.household_first_name || '/' || c.contact_is from household_contacts c join households h on h.id = c.household_id where h.ref_code = (select ref_code from worker)),
  'Pat/submitter', 'not the parent or guardian: the contact is the coordinator acting for them');
select is((select consent_story from households where ref_code = (select ref_code from parent)),
  false, 'story consent is opt-in: absent means no');
select is((select consent_story from households where ref_code = (select ref_code from worker)),
  true, 'ticking the story consent shares it');
select hasnt_column('public', 'public_households', 'referral_source', 'the public view carries no referral source');

select * from finish();
rollback;
