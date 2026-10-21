// The approval queue (A2): referrals waiting on the left, the selected one
// on the right exactly as sponsors would see it, a set of automatic checks,
// a private note, and the decision. Approved and rejected households sit
// below in folding sections and open in the same pane, read-only.
//
// Nothing here checks who the caller is. The database returns households
// only to the admin; for anyone else every list is simply empty.
//
// Everything a family typed is rendered with textContent. A story is data
// to display, never markup to interpret (CLAUDE.md, "database rows are
// untrusted input").
import { supabase } from "./auth.js";
import { mountConsole, requireSession, setBadge } from "./console.js";

const root = document.getElementById("queue-root");
const pendingList = document.getElementById("pending-list");
const pendingHeading = document.getElementById("pending-heading");
const detail = document.getElementById("detail");
const decided = document.getElementById("decided");

let households = [];
let selectedId = null;

const ROLE_LABELS = {
  boy: "Boy", girl: "Girl", child: "Child", mom: "Mom", dad: "Dad",
  grandmother: "Grandmother", grandfather: "Grandfather", adult: "Adult",
};
const CHILD_ROLES = new Set(["boy", "girl", "child"]);

function personLabel(member) {
  const base = ROLE_LABELS[member.role] ?? member.role;
  return CHILD_ROLES.has(member.role) && member.age != null ? `${base}, ${member.age}` : base;
}

function contactOf(household) {
  const contact = household.household_contacts;
  return (Array.isArray(contact) ? contact[0] : contact) ?? null;
}

// "the household's own email, 555-0100 (phone first)" — who, which
// channels, and which to try first. Never shown to anyone but the admin.
function describeContact(contact) {
  if (!contact) return "";
  const whose = contact.contact_is === "submitter" ? "the person who submitted on their behalf" : "the household itself";
  const channels = [];
  if (contact.email) channels.push(`email ${contact.email}`);
  if (contact.phone) channels.push(`phone ${contact.phone}`);
  const prefer = contact.email && contact.phone ? ` (${contact.primary_channel} first)` : "";
  return `Reach ${whose}: ${channels.join(", ")}${prefer}.`;
}

function reachableAt(contact) {
  if (!contact) return "";
  return contact.primary_channel === "phone" && contact.phone ? contact.phone : (contact.email || contact.phone || "");
}

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- The automatic checks ----------
//
// The database already refuses phone numbers, emails and street addresses,
// so those should never appear; they are checked again here because a
// check that is cheap to repeat should be. Schools are a judgement call
// and only warn.

const PATTERNS = [
  [/\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/, "bad", "The text looks like it contains a phone number."],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "bad", "The text looks like it contains an email address."],
  [/\d+\s+[a-z]+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way|pl|place|cir|circle)\b/i, "bad", "The text looks like it contains a street address."],
  [/\b(school|elementary|academy|kindergarten|preschool)\b/i, "warn", "The story names a school — ask for that to be removed before it goes live."],
];

function checksFor(household) {
  const checks = [];
  checks.push(
    household.consent_wish_list
      ? ["ok", "An adult in the household agreed to share the wish list."]
      : ["bad", "No consent recorded for the wish list. It cannot be published."],
  );
  checks.push(
    household.consent_story
      ? ["ok", "The family agreed the story can be shown to sponsors."]
      : ["info", "The story stays private — the family did not tick that box. Sponsors will see the one-line summary and the wish list only."],
  );

  const children = household.household_members.filter((m) => CHILD_ROLES.has(m.role));
  const unsized = children.filter((m) => !m.clothing_size || !m.shoe_size);
  checks.push(
    unsized.length
      ? ["warn", `${unsized.length} of ${children.length} children ${unsized.length === 1 ? "is" : "are"} missing a clothing or shoe size.`]
      : ["ok", children.length ? "Every child has clothing and shoe sizes." : "No children listed."],
  );

  const text = `${household.summary}\n${household.story}`;
  for (const [pattern, level, message] of PATTERNS) {
    if (pattern.test(text)) checks.push([level, message]);
  }
  if (household.submitter_label && /^[A-Z][a-z]+(\s+[A-Z]\.?|\s+[A-Z][a-z]+)+$/.test(household.submitter_label)) {
    checks.push(["warn", `The submitter's reference "${household.submitter_label}" reads like a person's name. Ask them to use something that does not identify the household.`]);
  }
  return checks;
}

// ---------- The detail pane ----------

function renderPerson(member) {
  const card = el("div", "person");
  const heading = el("h3");
  heading.append(el("span", null, personLabel(member)));
  const sizes = el("span", "sizes");
  if (member.clothing_size) sizes.appendChild(el("span", "size", member.clothing_size));
  if (member.shoe_size) sizes.appendChild(el("span", "size", member.shoe_size));
  heading.appendChild(sizes);
  card.appendChild(heading);

  const items = [...member.wish_items].sort((a, b) => a.position - b.position);
  const needs = items.filter((i) => i.kind === "need").map((i) => i.label);
  const loves = items.filter((i) => i.kind === "would_love").map((i) => i.label);
  if (needs.length) {
    const line = el("p");
    line.append(el("b", null, "Needs "), document.createTextNode(needs.join(", ")));
    card.appendChild(line);
  }
  if (loves.length) {
    const line = el("p");
    line.append(el("b", null, "Would love "), document.createTextNode(loves.join(", ")));
    card.appendChild(line);
  }
  return card;
}

function statusPill(status) {
  const labels = {
    pending_review: ["pill-pending", "Pending review"],
    live: ["pill-live", "Live"],
    rejected: ["pill-rejected", "Rejected"],
    withdrawn: ["pill-withdrawn", "Withdrawn"],
  };
  const [cls, text] = labels[status] ?? ["pill-grey", status];
  return el("span", `pill ${cls}`, text);
}

function renderDetail(household) {
  detail.innerHTML = "";
  if (!household) {
    const card = el("div", "card");
    card.appendChild(el("p", "muted", "Select a referral to review it."));
    detail.appendChild(card);
    return;
  }

  const pending = household.status === "pending_review";

  // Header: the code, the status, when it came in.
  const head = el("div", "card");
  const title = el("h2");
  title.append(el("span", null, `Referral ${household.ref_code} `), statusPill(household.status));
  head.append(title, el("p", "muted small", `Submitted ${formatDate(household.referred_on)}`));

  // What sponsors see: the summary, the story if consented, the people.
  const publicCard = el("div", "card");
  publicCard.appendChild(el("p", "eyebrow", household.consent_story ? "Story · will be public" : "Story · stays private"));
  publicCard.appendChild(el("p", null, household.summary));
  publicCard.appendChild(el("div", "story-box", household.story || "(no story given)"));
  publicCard.appendChild(el("p", "eyebrow", "Wish list · will be public"));
  const people = el("div", "people");
  const members = [...household.household_members].sort((a, b) => a.position - b.position);
  for (const member of members) people.appendChild(renderPerson(member));
  if (!members.length) people.appendChild(el("p", "muted", "No people recorded."));
  publicCard.appendChild(people);

  // Private: the contact and the submitter's reference, there for the
  // admin and nobody else.
  const contact = contactOf(household);
  const email = reachableAt(contact);
  const privateCard = el("div", "card card-tinted");
  privateCard.appendChild(el("p", "eyebrow", "Private · the coordinator only"));
  privateCard.appendChild(
    el("p", null, contact ? `${describeContact(contact)} Never shown to sponsors.` : "No contact on file (it is deleted on rejection)."),
  );
  if (household.submitter_label) {
    privateCard.appendChild(el("p", "muted small", `The submitter's own reference for this household: "${household.submitter_label}".`));
  }

  // Checks.
  const checksCard = el("div", "card");
  checksCard.appendChild(el("p", "eyebrow", "Before publishing"));
  const list = el("ul", "check-list");
  const checks = checksFor(household);
  const marks = { ok: "✓", info: "·", warn: "!", bad: "✕" };
  for (const [level, message] of checks) {
    const item = el("li", level);
    item.append(el("span", "mark", marks[level]), el("span", null, message));
    list.appendChild(item);
  }
  checksCard.appendChild(list);

  // Note and decisions.
  const decideCard = el("div", "card");
  const noteLabel = el("label", "field");
  noteLabel.appendChild(el("span", null, "Note to self (private, never shown to anyone else)"));
  const note = el("textarea");
  note.value = household.admin_note;
  note.disabled = !pending;
  noteLabel.appendChild(note);
  decideCard.appendChild(noteLabel);

  const actions = el("div", "form-actions");
  const status = el("span", "status-line");
  if (pending) {
    const saveNote = el("button", "btn btn-outline btn-sm", "Save note");
    saveNote.type = "button";
    saveNote.onclick = () => saveAdminNote(household.id, note.value, status);
    actions.append(saveNote, status);
    decideCard.appendChild(actions);

    const decisions = el("div", "form-actions");
    const approve = el("button", "btn btn-green", "Approve & publish");
    approve.type = "button";
    approve.disabled = checks.some(([level]) => level === "bad");
    approve.onclick = () => decide(household.id, "live");
    const changes = el("button", "btn btn-outline", "Request changes");
    changes.type = "button";
    changes.disabled = true;
    const reject = el("button", "btn btn-danger", "Reject");
    reject.type = "button";
    reject.onclick = () => decide(household.id, "rejected");
    decisions.append(approve, changes, reject);
    decideCard.appendChild(decisions);

    // Families cannot edit after submitting (no login), so "request
    // changes" has no recipient yet. The honest substitute is the admin
    // emailing the family herself.
    decideCard.appendChild(
      el("p", "notice notice-amber small", email
        ? `Request changes is still in work. For now, reach them at ${email} and ask for the fix; a resubmission needs a new link.`
        : "Request changes is still in work."),
    );
  } else if (household.status === "live") {
    // Withdrawing is the one thing that can happen to a live household from
    // here. Two clicks, no dialog: a browser confirm() would block the page.
    const withdraw = el("button", "btn btn-danger", "Withdraw from the public list");
    withdraw.type = "button";
    const confirm = el("button", "btn btn-danger hidden", "Yes, withdraw " + household.ref_code);
    confirm.type = "button";
    const cancel = el("button", "btn btn-outline hidden", "Keep it live");
    cancel.type = "button";
    withdraw.onclick = () => {
      withdraw.classList.add("hidden");
      confirm.classList.remove("hidden");
      cancel.classList.remove("hidden");
    };
    cancel.onclick = () => renderDetail(household);
    confirm.onclick = () => decide(household.id, "withdrawn");
    actions.append(withdraw, confirm, cancel);
    decideCard.appendChild(actions);
    decideCard.appendChild(el("p", "muted small", "Withdrawing takes the household off the list for good and deletes the family's contact email. There is no undo."));
  } else {
    actions.append(el("span", "muted small", "Decided. Nothing more to do here."));
    decideCard.appendChild(actions);
  }

  detail.append(head, publicCard, privateCard, checksCard, decideCard);
}

// ---------- The lists ----------

function pickButton(household) {
  const item = el("li");
  const button = el("button");
  button.type = "button";
  if (household.id === selectedId) button.setAttribute("aria-current", "true");
  const top = el("span", "pick-top");
  top.append(el("span", "ref", household.ref_code), el("span", "meta", formatDate(household.referred_on)));
  button.append(top, el("span", "pick-summary", household.submitter_label ? `${household.summary} · ref "${household.submitter_label}"` : household.summary));
  button.onclick = () => select(household.id);
  item.appendChild(button);
  return item;
}

function renderLists() {
  const pending = households.filter((h) => h.status === "pending_review");
  pendingHeading.textContent = `${pending.length} waiting`;
  setBadge("pending", pending.length);
  pendingList.innerHTML = "";
  if (!pending.length) pendingList.appendChild(el("li", "empty", "Nothing is waiting for review right now."));
  for (const household of pending) pendingList.appendChild(pickButton(household));

  decided.innerHTML = "";
  for (const [status, title, empty] of [
    ["live", "Approved", "Nothing has been approved yet."],
    ["rejected", "Rejected", "Nothing has been rejected."],
    ["withdrawn", "Withdrawn", "Nothing has been withdrawn."],
  ]) {
    const rows = households.filter((h) => h.status === status);
    if (status === "withdrawn" && !rows.length) continue;
    const section = el("details", "section");
    const summary = el("summary");
    summary.append(el("span", null, title), el("span", "count", `(${rows.length})`));
    section.appendChild(summary);
    const list = el("ul", "pick-list");
    if (!rows.length) list.appendChild(el("li", "empty", empty));
    for (const household of rows) list.appendChild(pickButton(household));
    section.appendChild(list);
    decided.appendChild(section);
  }
}

function select(id) {
  selectedId = id;
  renderLists();
  renderDetail(households.find((h) => h.id === id) ?? null);
}

// ---------- Data ----------

async function load() {
  const { data, error } = await supabase
    .from("households")
    .select(
      "id, ref_code, summary, story, status, referred_on, consent_wish_list, consent_story, admin_note, submitter_label, " +
        "household_members ( id, position, role, age, clothing_size, shoe_size, wish_items ( id, kind, label, position ) ), " +
        "household_contacts ( email, phone, primary_channel, contact_is )",
    )
    .order("referred_on", { ascending: true });

  if (error) {
    root.innerHTML = "";
    root.appendChild(el("p", "notice notice-red", `Couldn't load referrals: ${error.message}`));
    return;
  }

  households = data;
  // The dashboard links here with ?select=<id>; honour it once, on load.
  const requested = new URLSearchParams(window.location.search).get("select");
  if (requested && households.some((h) => h.id === requested)) selectedId = requested;
  if (!households.some((h) => h.id === selectedId)) {
    selectedId = households.find((h) => h.status === "pending_review")?.id ?? null;
  }
  renderLists();
  renderDetail(households.find((h) => h.id === selectedId) ?? null);
}

async function saveAdminNote(id, note, status) {
  status.textContent = "Saving…";
  const { error } = await supabase.from("households").update({ admin_note: note }).eq("id", id);
  status.textContent = error ? `Not saved: ${error.message}` : "Note saved.";
  if (!error) {
    const household = households.find((h) => h.id === id);
    if (household) household.admin_note = note;
  }
}

// Re-fetching afterwards is what proves the write landed: the row shows
// up under Approved or Rejected because the database says so.
async function decide(id, status) {
  const { error } = await supabase.from("households").update({ status }).eq("id", id);
  if (error) {
    detail.prepend(el("p", "notice notice-red", `Couldn't save the decision: ${error.message}`));
    return;
  }
  selectedId = null;
  await load();
}

mountConsole({ title: "Approval queue" });
const session = await requireSession(root);
if (session) await load();
