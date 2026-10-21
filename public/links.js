// Referral links: the admin makes one, copies it, and sees the ones made
// before with their state. The token comes back from the database exactly
// once, goes into the link shown on this page, and is never fetched again
// — the table only holds its hash.
//
// The token rides in the URL *fragment* (#t=…), not the path or query
// string. Browsers never send the fragment to a server, so it stays out of
// Cloudflare's request logs and out of our own server.js log line.
import { supabase } from "./auth.js";
import { mountConsole, requireSession } from "./console.js";

const root = document.getElementById("links-root");
const createButton = document.getElementById("create-link");
const createStatus = document.getElementById("create-status");
const newLink = document.getElementById("new-link");
const newLinkUrl = document.getElementById("new-link-url");
const newLinkExpiry = document.getElementById("new-link-expiry");
const copyButton = document.getElementById("copy-link");
const list = document.getElementById("links-list");

function linkFor(token) {
  return `${window.location.origin}/refer.html#t=${token}`;
}

function stateOf(link) {
  if (link.uses >= link.max_uses) return { label: "Used up", pill: "pill-grey" };
  if (new Date(link.expires_at) < new Date()) return { label: "Expired", pill: "pill-rejected" };
  return { label: "Usable", pill: "pill-live" };
}

function renderList(links) {
  list.innerHTML = "";
  if (links.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No links yet.";
    list.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  const head = table.createTHead().insertRow();
  for (const label of ["Created", "Expires", "Uses", "State", "Referrals"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    head.appendChild(cell);
  }
  const body = table.createTBody();
  for (const link of links) {
    const row = body.insertRow();
    row.insertCell().textContent = new Date(link.created_at).toLocaleString();
    row.insertCell().textContent = new Date(link.expires_at).toLocaleString();
    row.insertCell().textContent = `${link.uses} of ${link.max_uses}`;
    const state = stateOf(link);
    const pill = document.createElement("span");
    pill.className = `pill ${state.pill}`;
    pill.textContent = state.label;
    row.insertCell().appendChild(pill);
    // Which referrals came through it — by ref code, the only handle a
    // household ever has.
    const codes = (link.households ?? []).map((h) => h.ref_code);
    row.insertCell().textContent = codes.length ? codes.join(", ") : "—";
  }
  list.appendChild(table);
}

async function loadLinks() {
  const { data, error } = await supabase
    .from("referral_links")
    .select("id, created_at, expires_at, uses, max_uses, households ( ref_code )")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = "";
    const message = document.createElement("p");
    message.className = "notice notice-red";
    message.textContent = `Couldn't load the links: ${error.message}`;
    list.appendChild(message);
    return;
  }
  renderList(data);
}

createButton.onclick = async () => {
  createButton.disabled = true;
  createStatus.textContent = "Creating…";

  // The function refuses anyone but the admin; the page does not pre-check.
  const maxUses = Math.min(1000, Math.max(1, Number(document.getElementById("max-uses").value) || 1));
  const { data, error } = await supabase.rpc("create_referral_link", { p_max_uses: maxUses });

  createButton.disabled = false;
  if (error) {
    createStatus.textContent = `Couldn't create a link: ${error.message}`;
    return;
  }

  const made = Array.isArray(data) ? data[0] : data;
  createStatus.textContent = "";
  newLinkUrl.value = linkFor(made.token);
  newLinkExpiry.textContent = `Expires ${new Date(made.expires_at).toLocaleString()} · ${made.max_uses === 1 ? "one household" : `up to ${made.max_uses} households`}.`;
  newLink.classList.remove("hidden");
  await loadLinks();
};

copyButton.onclick = async () => {
  try {
    await navigator.clipboard.writeText(newLinkUrl.value);
    copyButton.textContent = "Copied";
  } catch {
    // Clipboard access can be refused (older browsers, some permissions);
    // selecting the text is the fallback, and Ctrl/Cmd-C does the rest.
    newLinkUrl.select();
    copyButton.textContent = "Press Ctrl/Cmd-C to copy";
  }
  setTimeout(() => {
    copyButton.textContent = "Copy link";
  }, 2500);
};

mountConsole({ title: "Referral links" });
const session = await requireSession(root);
if (session) await loadLinks();
