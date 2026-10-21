-- Configurable link expiry: the admin chooses how many days a link stays
-- open instead of a fixed seven.
begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test');
insert into profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'admin');
update campaigns set status = 'open' where id = '00000000-0000-4000-a000-000000002026';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create temporary table short_link as select * from create_referral_link(1, 1);
create temporary table long_link as select * from create_referral_link(1, 90);

select ok(
  (select expires_at from short_link) between now() + interval '23 hours' and now() + interval '25 hours',
  'a 1-day link expires about a day from now'
);
select ok(
  (select expires_at from long_link) between now() + interval '89 days' and now() + interval '91 days',
  'a 90-day link expires about ninety days from now'
);
select throws_ok(
  $$ select * from create_referral_link(1, 0) $$,
  'P0001', 'A link can stay open between 1 and 90 days.',
  'a link cannot stay open for zero days'
);
select throws_ok(
  $$ select * from create_referral_link(1, 91) $$,
  'P0001', 'A link can stay open between 1 and 90 days.',
  'a link cannot stay open for more than ninety days'
);

select * from finish();
rollback;
