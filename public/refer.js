// The referral form, filled in by the household or by someone on their
// behalf. One sitting, one submit.
//
// This page does not import auth.js: nobody signs in here, and auth.js
// rewrites the address bar on load, which would wipe the link's token out
// of the URL fragment before it was read. It makes its own Supabase client
// from the same config instead.
//
// The token is read from `#t=…`. Browsers never send the fragment to a
// server, so the token stays out of every request log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, detectSessionInUrl: false },
});

const token = new URLSearchParams(window.location.hash.slice(1)).get("t") || "";

const ruleLine = document.getElementById("rule-line");
const linkMessage = document.getElementById("link-message");
const form = document.getElementById("refer-form");
const membersRoot = document.getElementById("members");
const memberTemplate = document.getElementById("member-template");
const submitButton = document.getElementById("submit");
const submitStatus = document.getElementById("submit-status");
const submitError = document.getElementById("submit-error");
const contactError = document.getElementById("contact-error");
const primaryRow = document.getElementById("primary-row");
const labelRow = document.getElementById("label-row");
const done = document.getElementById("done");

let campaign = null;

// ---------- Saying what is wrong with a link ----------

function showLinkMessage(title, body) {
  linkMessage.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = body;
  linkMessage.append(heading, text);
  if (campaign?.contact_email) {
    const contact = document.createElement("p");
    contact.className = "muted";
    contact.textContent = `Questions? Email the coordinator at ${campaign.contact_email}.`;
    linkMessage.appendChild(contact);
  }
  linkMessage.classList.remove("hidden");
  ruleLine.classList.add("hidden");
}

// ---------- The text guard, client side ----------
//
// The same three patterns the database refuses, so the person hears about
// it while typing instead of on submit. Plus two the database leaves to a
// human: a school name in the story, and a reference that reads like a
// name. Those only warn.

const BLOCKING = [
  [/\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/, "a phone number"],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "an email address"],
  [/\d+\s+[a-z]+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way|pl|place|cir|circle)\b/i, "a street address"],
];
const SCHOOL = /\b(school|elementary|academy|kindergarten|preschool|high school|middle school)\b/i;

function problemsIn(text) {
  const blocking = BLOCKING.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const warning = SCHOOL.test(text);
  return { blocking, warning };
}

function updateWarning(target, text) {
  const { blocking, warning } = problemsIn(text);
  if (blocking.length) {
    target.textContent = `This looks like it contains ${blocking.join(" and ")}. Please take it out — the coordinator reaches you through step 4 instead.`;
    target.classList.remove("hidden");
    return true;
  }
  if (warning) {
    target.textContent = "This mentions a school. Naming one can identify a family, so the coordinator may ask you to remove it.";
    target.classList.remove("hidden");
    return false;
  }
  target.classList.add("hidden");
  return false;
}

function watchField(input, warningTarget) {
  input.addEventListener("input", () => updateWarning(warningTarget, input.value));
}

// ---------- Contact: who, and how ----------

function syncContact() {
  const onBehalf = form.elements.contact_is.value === "submitter";
  labelRow.classList.toggle("hidden", !onBehalf);
  const both = form.elements.email.value.trim() && form.elements.phone.value.trim();
  primaryRow.classList.toggle("hidden", !both);
  contactError.classList.add("hidden");
}

function phoneDigits(value) {
  return value.replace(/\D/g, "").length;
}

function contactProblem(referral) {
  if (!referral.email && !referral.phone) return "Give an email address or a phone number the coordinator can reach you at.";
  if (referral.email && !/^[^@\s]+@[^@\s]+$/.test(referral.email)) return "That email address does not look right.";
  if (referral.phone && (phoneDigits(referral.phone) < 7 || phoneDigits(referral.phone) > 15)) return "That phone number does not look right.";
  return null;
}

// ---------- People ----------

const CHILD_ROLES = new Set(["boy", "girl", "child"]);

function addMember() {
  const block = memberTemplate.content.firstElementChild.cloneNode(true);
  const role = block.querySelector('[name="role"]');
  const ageField = block.querySelector(".age-field");
  const age = block.querySelector('[name="age"]');
  const warning = block.querySelector('[data-warning-for="member"]');

  function syncAge() {
    const isChild = CHILD_ROLES.has(role.value);
    ageField.classList.toggle("hidden", !isChild);
    age.required = isChild;
    if (!isChild) age.value = "";
  }
  role.addEventListener("change", syncAge);
  syncAge();

  for (const name of ["clothing_size", "shoe_size", "needs", "would_love"]) {
    const input = block.querySelector(`[name="${name}"]`);
    input.addEventListener("input", () => {
      const all = ["clothing_size", "shoe_size", "needs", "would_love"]
        .map((n) => block.querySelector(`[name="${n}"]`).value)
        .join(" \n ");
      updateWarning(warning, all);
    });
  }

  block.querySelector(".remove-member").onclick = () => {
    if (membersRoot.children.length > 1) block.remove();
  };

  membersRoot.appendChild(block);
}

function readMembers() {
  return [...membersRoot.querySelectorAll(".member")].map((block) => {
    const value = (name) => block.querySelector(`[name="${name}"]`).value.trim();
    return {
      role: value("role"),
      age: CHILD_ROLES.has(value("role")) ? Number(value("age")) : null,
      clothing_size: value("clothing_size"),
      shoe_size: value("shoe_size"),
      needs: value("needs"),
      would_love: value("would_love"),
    };
  });
}

// ---------- Submit ----------

function readForm() {
  const onBehalf = form.elements.contact_is.value === "submitter";
  const email = form.elements.email.value.trim();
  const phone = form.elements.phone.value.trim();
  return {
    summary: form.elements.summary.value.trim(),
    story: form.elements.story.value.trim(),
    consent_wish_list: form.elements.consent_wish_list.checked,
    consent_story: form.elements.consent_story.checked,
    contact_is: onBehalf ? "submitter" : "household",
    email,
    phone,
    primary_channel: email && phone ? form.elements.primary_channel.value : email ? "email" : "phone",
    coordinator_note: form.elements.coordinator_note.value.trim(),
    household_first_name: form.elements.filler_first_name.value.trim(),
    submitter_first_name: onBehalf ? form.elements.submitter_first_name.value.trim() : "",
    members: readMembers(),
  };
}

function showSubmitError(message) {
  submitError.textContent = message;
  submitError.classList.remove("hidden");
  submitError.scrollIntoView({ behavior: "smooth", block: "center" });
}

form.onsubmit = async (event) => {
  event.preventDefault();
  submitError.classList.add("hidden");
  contactError.classList.add("hidden");

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const referral = readForm();

  const problem = contactProblem(referral);
  if (problem) {
    contactError.textContent = problem;
    contactError.classList.remove("hidden");
    contactError.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const texts = [referral.summary, referral.story, referral.coordinator_note, referral.household_first_name, referral.submitter_first_name, ...referral.members.flatMap((m) => [m.needs, m.would_love, m.clothing_size, m.shoe_size])];
  const blocking = texts.flatMap((text) => problemsIn(text).blocking);
  if (blocking.length) {
    showSubmitError(`Please take out ${[...new Set(blocking)].join(" and ")} before submitting. The coordinator reaches you through step 4.`);
    return;
  }

  submitButton.disabled = true;
  submitStatus.textContent = "Submitting…";

  // The database does every check again and either writes everything or
  // nothing. Its message is written for the person, so it is shown as is.
  const { data, error } = await supabase.rpc("submit_referral", {
    p_token: token,
    p_referral: referral,
  });

  submitButton.disabled = false;
  submitStatus.textContent = "";

  if (error) {
    showSubmitError(error.message);
    return;
  }

  showDone(data, referral);
};

function showDone(refCode, referral) {
  form.classList.add("hidden");
  ruleLine.classList.add("hidden");
  done.innerHTML = "";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Submitted";
  const heading = document.createElement("h2");
  heading.textContent = `The referral is ${refCode}`;
  const body = document.createElement("p");
  body.textContent = "The coordinator reviews every referral before it appears to donors, usually within a couple of days. Nothing is public yet. Write the number down — it is how the coordinator will refer to this household, and it is the only handle donors ever see.";
  done.append(eyebrow, heading, body);
  const next = document.createElement("p");
  next.className = "muted";
  next.textContent = campaign?.contact_email
    ? `If anything needs changing, email the coordinator at ${campaign.contact_email} and quote ${refCode}.`
    : `If anything needs changing, contact the coordinator and quote ${refCode}.`;
  done.appendChild(next);
  if (referral.contact_is === "submitter") {
    const again = document.createElement("p");
    again.textContent = "Referring another household? Open the same link again if it allows more uses; the link page will say if it has been used up.";
    done.appendChild(again);
  }
  done.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Start ----------

async function start() {
  const { data: campaigns } = await supabase.from("public_campaign").select("*").limit(1);
  campaign = campaigns?.[0] ?? null;
  if (campaign) {
    document.getElementById("org-line").textContent = `${campaign.organization_name} · ${campaign.year} gift drive`;
    ruleLine.textContent = `Nothing here is public until the coordinator approves it. Nominations close ${new Date(campaign.nominations_close + "T00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`;
  }

  if (!token) {
    showLinkMessage("This page needs a link", "Referrals open through a link from the coordinator. If you were sent one, open it exactly as it was sent to you.");
    return;
  }

  const { data: status, error } = await supabase.rpc("referral_link_status", { p_token: token });
  if (error) {
    showLinkMessage("Something went wrong", `Couldn't check your link: ${error.message}`);
    return;
  }

  if (status === "used") {
    showLinkMessage("This link has been used up", "It has been used as many times as it allows. Nobody did anything wrong — ask the coordinator for a new one.");
    return;
  }
  if (status === "expired") {
    showLinkMessage("This link has expired", "Links last seven days. Ask the coordinator for a new one.");
    return;
  }
  if (status !== "valid") {
    showLinkMessage("This link isn't recognised", "Check that it was copied in full, or ask the coordinator for a new one.");
    return;
  }

  watchField(form.elements.summary, form.querySelector('[data-warning-for="summary"]'));
  watchField(form.elements.story, form.querySelector('[data-warning-for="story"]'));
  for (const radio of form.elements.contact_is) radio.addEventListener("change", syncContact);
  form.elements.email.addEventListener("input", syncContact);
  form.elements.phone.addEventListener("input", syncContact);
  document.getElementById("add-member").onclick = addMember;
  addMember();
  syncContact();
  form.classList.remove("hidden");
}

await start();
