// Drive settings: the one campaign row, edited by the admin. The form's
// input names match the column names exactly, so loading is "copy each
// column into the input with that name" and saving is the reverse. Nothing
// here checks who the caller is — if the database returns no row, the
// caller is not the admin, and the page says so.
import { supabase } from "./auth.js";
import { mountConsole, requireSession } from "./console.js";

const CAMPAIGN_ID = "00000000-0000-4000-a000-000000002026";

const root = document.getElementById("settings-root");
const form = document.getElementById("settings-form");
const status = document.getElementById("settings-status");
const saveStatus = document.getElementById("save-status");

// The built-in palette. A colour equal to its default is saved as blank,
// so changing the stylesheet later still reaches drives that never chose.
const DEFAULT_COLORS = { brand_primary: "#a81e32", brand_accent: "#1b6b45", brand_background: "#f4efe9" };

const TEXT_FIELDS = [
  "organization_name", "name", "coordinator_name", "contact_phone",
  "contact_email", "drop_off_address", "drop_off_hours",
  "nominations_open", "nominations_close", "claims_close", "gifts_due",
];

function fillForm(campaign) {
  for (const name of TEXT_FIELDS) {
    form.elements[name].value = campaign[name] ?? "";
  }
  form.elements.sponsor_cap.value = campaign.sponsor_cap;
  form.elements.show_public_count.checked = campaign.show_public_count;
  form.elements.logo_url.value = campaign.logo_url ?? "";
  for (const [name, fallback] of Object.entries(DEFAULT_COLORS)) {
    form.elements[name].value = campaign[name] ?? fallback;
  }
}

function readForm() {
  const values = {};
  for (const name of TEXT_FIELDS) {
    values[name] = form.elements[name].value.trim();
  }
  values.sponsor_cap = Number(form.elements.sponsor_cap.value);
  values.show_public_count = form.elements.show_public_count.checked;
  values.logo_url = form.elements.logo_url.value.trim() || null;
  for (const [name, fallback] of Object.entries(DEFAULT_COLORS)) {
    const chosen = form.elements[name].value.toLowerCase();
    values[name] = chosen === fallback ? null : chosen;
  }
  return values;
}

// ---------- Close-out (A5, bottom) ----------
//
// Closing empties the public list and refuses claims; it deletes nothing.
// The retention purge is a separate, approved GitHub Action
// (.github/workflows/retention-purge.yml) and refuses to run until the
// drive is closed. Reopening is allowed, because a wrong click in December
// should not need a database engineer.

const totals = document.getElementById("totals");
const closeOutActions = document.getElementById("close-out-actions");
const closeOutWhen = document.getElementById("close-out-when");
const retentionLine = document.getElementById("retention-line");

function tile(number, label) {
  const card = document.createElement("div");
  card.className = "card tile";
  const num = document.createElement("div");
  num.className = "num";
  num.textContent = String(number);
  const text = document.createElement("div");
  text.className = "label";
  text.textContent = label;
  card.append(num, text);
  return card;
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function renderCloseOut(campaign) {
  const { data: rows } = await supabase.from("season_totals").select("*").eq("campaign_id", CAMPAIGN_ID).limit(1);
  const t = rows?.[0];
  totals.innerHTML = "";
  if (t) {
    totals.append(
      tile(t.sponsored, "households sponsored"),
      tile(t.still_open, "still open"),
      tile(t.withdrawn, "withdrawn"),
      tile(t.logged_events, "logged events"),
    );
  }

  const [gy, gm, gd] = campaign.gifts_due.split("-").map(Number);
  const pastDeadline = new Date() >= new Date(gy, gm - 1, gd);
  closeOutWhen.textContent = campaign.status === "closed"
    ? "The drive is closed."
    : pastDeadline ? "The drop-off deadline has passed." : `Intended for after the drop-off deadline (${formatDateLocal(campaign.gifts_due)}).`;

  closeOutActions.innerHTML = "";
  const status = document.createElement("span");
  status.className = "status-line";
  if (campaign.status === "closed") {
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "btn btn-outline";
    reopen.textContent = "Reopen the drive";
    reopen.onclick = () => setStatus("open", status);
    closeOutActions.append(reopen, status);
    retentionLine.textContent = `Retention: the family contact rows (${t?.contact_rows_held ?? "?"} held) are deleted by the approved retention workflow, due ${addDays(campaign.gifts_due, 60)}. Stories and wish lists are kept without identifying data for next year's planning.`;
  } else {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn-green";
    close.textContent = "Close the drive";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-danger hidden";
    confirm.textContent = "Yes, close the drive";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-outline hidden";
    cancel.textContent = "Not yet";
    close.onclick = () => {
      close.classList.add("hidden");
      confirm.classList.remove("hidden");
      cancel.classList.remove("hidden");
    };
    cancel.onclick = () => renderCloseOut(campaign);
    confirm.onclick = () => setStatus("closed", status);
    closeOutActions.append(close, confirm, cancel, status);
    retentionLine.textContent = `Closing empties the public list and stops new claims. Nothing is deleted. Contact details are deleted 60 days after the drive closes by the retention workflow (${addDays(campaign.gifts_due, 60)} if closed on the deadline).`;
  }
}

function formatDateLocal(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function setStatus(value, statusLine) {
  statusLine.textContent = "Saving…";
  const { error } = await supabase.from("campaigns").update({ status: value }).eq("id", CAMPAIGN_ID);
  if (error) {
    statusLine.textContent = `Not saved: ${error.message}`;
    return;
  }
  await load();
}

async function load() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", CAMPAIGN_ID)
    .maybeSingle();

  if (error) {
    status.className = "notice notice-red";
    status.textContent = `Couldn't load the settings: ${error.message}`;
    return;
  }

  // No row and no error means RLS returned nothing: not the admin.
  if (!data) {
    status.className = "notice";
    status.textContent = "There are no settings to show for this account.";
    return;
  }

  fillForm(data);
  status.classList.add("hidden");
  form.classList.remove("hidden");
  await renderCloseOut(data);
}

form.onsubmit = async (event) => {
  event.preventDefault();
  saveStatus.textContent = "Saving…";

  const { error } = await supabase
    .from("campaigns")
    .update(readForm())
    .eq("id", CAMPAIGN_ID);

  if (error) {
    // The dates-in-order check and the cap range both come back as errors
    // from the database, which is the right place for them to live.
    saveStatus.textContent = `Not saved: ${error.message}`;
    return;
  }

  saveStatus.textContent = `Saved at ${new Date().toLocaleTimeString()}.`;
};

mountConsole({ title: "Drive settings" });
const session = await requireSession(root);
if (session) await load();

document.getElementById("reset-colors").onclick = () => {
  for (const [name, fallback] of Object.entries(DEFAULT_COLORS)) form.elements[name].value = fallback;
};
