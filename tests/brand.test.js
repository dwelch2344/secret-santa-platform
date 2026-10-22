import { test } from "node:test";
import assert from "node:assert/strict";
import { isHex, shade, brandVariables } from "../public/brand-colors.js";

test("only six-digit hex colours count", () => {
  assert.equal(isHex("#a81e32"), true);
  assert.equal(isHex("red"), false);
  assert.equal(isHex("#abc"), false);
  assert.equal(isHex("#123456; background:url(x)"), false);
  assert.equal(isHex(null), false);
});

test("shade moves toward black or white", () => {
  assert.equal(shade("#ffffff", 1), "#000000");
  assert.equal(shade("#000000", -1), "#ffffff");
  assert.equal(shade("#808080", 0), "#808080");
});

test("blank brand colours leave the built-in palette alone", () => {
  assert.deepEqual(brandVariables({}), {});
  assert.deepEqual(brandVariables({ brand_primary: "not a colour" }), {});
});

test("a primary colour drives the button variables", () => {
  const vars = brandVariables({ brand_primary: "#123abc" });
  assert.equal(vars["--cranberry"], "#123abc");
  assert.ok(isHex(vars["--cranberry-700"]));
});
