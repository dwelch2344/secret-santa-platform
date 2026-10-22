// Pure colour helpers for brand.js, no imports so Node can test them.

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value) {
  return typeof value === "string" && HEX.test(value);
}

// Mix a hex colour toward black (amount > 0) or white (amount < 0).
// Used for the hover and dark variants the stylesheet expects.
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 0 : 255;
  const k = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * k);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

// The stylesheet variables each brand colour drives.
export function brandVariables({ brand_primary, brand_accent, brand_background }) {
  const vars = {};
  if (isHex(brand_primary)) {
    vars["--cranberry"] = brand_primary;
    vars["--cranberry-700"] = shade(brand_primary, 0.15);
    vars["--cranberry-100"] = shade(brand_primary, -0.85);
    vars["--cranberry-50"] = shade(brand_primary, -0.93);
  }
  if (isHex(brand_accent)) {
    vars["--green-700"] = brand_accent;
    vars["--green-900"] = shade(brand_accent, 0.35);
    vars["--green-600"] = shade(brand_accent, -0.1);
    vars["--green-300"] = shade(brand_accent, -0.5);
    vars["--green-100"] = shade(brand_accent, -0.88);
    vars["--green-50"] = shade(brand_accent, -0.95);
  }
  if (isHex(brand_background)) {
    vars["--cream"] = brand_background;
    vars["--cream-2"] = shade(brand_background, -0.4);
  }
  return vars;
}
