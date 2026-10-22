-- Branding, admin-set (David, 2026-10-22): a logo by public URL and three
-- brand colours. Deliberately not free-form CSS: a stylesheet from a
-- settings box could restyle the consent wording or send page details
-- elsewhere. Colours are validated hex values; the logo must be https.
-- Blank means the built-in gift icon and palette.

alter table campaigns
  add column logo_url text check (
    logo_url is null or (logo_url ~ '^https://[^\s"''<>]+$' and length(logo_url) <= 500)
  ),
  add column brand_primary text check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column brand_accent text check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column brand_background text check (brand_background is null or brand_background ~ '^#[0-9a-fA-F]{6}$');

-- Appending columns keeps the view's existing ones where they were.
create or replace view public_campaign
with (security_barrier = true) as
  select
    id, name, year, organization_name, coordinator_name, contact_email,
    contact_phone, nominations_open, nominations_close, claims_close,
    gifts_due, status, show_public_count, sponsor_cap,
    logo_url, brand_primary, brand_accent, brand_background
  from campaigns;
