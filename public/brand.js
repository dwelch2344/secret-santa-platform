// Applies the drive's branding on every page: the logo in place of the
// gift icon, and the three brand colours as stylesheet variables. Reads
// the public campaign view, so it works signed in or not.
//
// Setting a variable through element.style is a script action, which the
// Content-Security-Policy allows; it never writes a style attribute into
// the HTML or loads a stylesheet from elsewhere.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { brandVariables } from "./brand-colors.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, detectSessionInUrl: false },
});

const { data } = await supabase
  .from("public_campaign")
  .select("logo_url, brand_primary, brand_accent, brand_background, organization_name")
  .limit(1);
const brand = data?.[0];

if (brand) {
  for (const [name, value] of Object.entries(brandVariables(brand))) {
    document.documentElement.style.setProperty(name, value);
  }

  if (brand.logo_url && brand.logo_url.startsWith("https://")) {
    for (const icon of document.querySelectorAll(".brand svg")) {
      const img = document.createElement("img");
      img.src = brand.logo_url;
      img.alt = brand.organization_name || "Logo";
      // A broken link puts the gift icon back.
      img.onerror = () => img.replaceWith(icon);
      icon.replaceWith(img);
    }
  }
}
