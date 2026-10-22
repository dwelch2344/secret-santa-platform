-- Branding: public to read, admin to set, validated either way.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'someone@example.test');
insert into profiles (id, role) values ('00000000-0000-4000-8000-000000000001', 'admin');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update campaigns set logo_url = 'https://example.org/logo.png', brand_primary = '#123abc'
where id = '00000000-0000-4000-a000-000000002026';
select throws_ok(
  $$ update campaigns set logo_url = 'http://example.org/logo.png' where id = '00000000-0000-4000-a000-000000002026' $$,
  '23514', null, 'a non-https logo is refused'
);
select throws_ok(
  $$ update campaigns set brand_accent = 'red; background:url(x)' where id = '00000000-0000-4000-a000-000000002026' $$,
  '23514', null, 'anything but a hex colour is refused'
);
reset role;

set local role anon;
select is((select logo_url from public_campaign limit 1), 'https://example.org/logo.png', 'anon reads the logo through the public view');
select is((select brand_primary from public_campaign limit 1), '#123abc', 'anon reads the primary colour');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update campaigns set brand_primary = '#000000';
reset role;
select is((select brand_primary from campaigns where id = '00000000-0000-4000-a000-000000002026'), '#123abc', 'a non-admin cannot change the brand');
select hasnt_column('public', 'public_campaign', 'drop_off_address', 'the view still hides the drop-off address');

select * from finish();
rollback;
