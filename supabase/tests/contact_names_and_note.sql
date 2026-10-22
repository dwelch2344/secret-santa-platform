-- The contact first names and the note to the coordinator land, admin-only,
-- and still refuse phone numbers; anon reads none of it.
begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'admin@example.test');
insert into profiles (id, role) values ('00000000-0000-4000-8000-000000000001', 'admin');
update campaigns set status = 'open' where id = '00000000-0000-4000-a000-000000002026';
insert into referral_links (token_hash, expires_at, max_uses)
values (sha256(convert_to('names-token', 'UTF8')), now() + interval '1 day', 5);

create temporary table base as select jsonb_build_object(
  'summary', 'Household of 2 — one adult, one child',
  'consent_wish_list', true,
  'is_guardian', true,
  'email', 'helper@example.test',
  'members', jsonb_build_array(jsonb_build_object('role', 'girl', 'age', 6, 'needs', 'Coat'))
) as payload;
grant select on base to anon;

set local role anon;
create temporary table made as select submit_referral('names-token',
  (select payload || '{"contact_is":"submitter","household_first_name":"Jamie","submitter_first_name":"Pat","coordinator_note":"Best reached after 5pm."}' from base)) as ref_code;
select throws_ok(
  $$ select submit_referral('names-token', (select payload || '{"coordinator_note":"call 801 555 0100"}' from base)) $$,
  'P0001', null, 'a phone number in the note is refused'
);
select is((select count(*) from household_contacts), 0::bigint, 'anon reads no contacts');
reset role;

select is((select household_first_name from household_contacts c join households h on h.id = c.household_id where h.ref_code = (select ref_code from made)), 'Jamie', 'the household contact name is stored');
select is((select submitter_first_name from household_contacts c join households h on h.id = c.household_id where h.ref_code = (select ref_code from made)), 'Pat', 'the submitter name is stored');
select is((select family_note from households where ref_code = (select ref_code from made)), 'Best reached after 5pm.', 'the note to the coordinator is stored');
select hasnt_column('public', 'public_households', 'family_note', 'the public view has no note');

select * from finish();
rollback;
