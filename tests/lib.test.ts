// Shared server helpers. Tests marked `todo` describe known wrong behaviour: they are
// reported on every run but don't fail. When one is fixed, remove its `todo` option.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanHtmlText } from "../server/lib/text.ts";
import { getCoordinatesForLocation } from "../server/lib/geo.ts";
import { categorizeByTitle, extractCategoryName, inferCategoryFromTitle } from "../server/lib/categories.ts";

describe("cleanHtmlText", () => {
  it("strips tags, decodes common entities and collapses whitespace", () => {
    assert.equal(cleanHtmlText("<p>Lathe &amp; tooling</p>\n<br/>  &quot;as seen&quot;"), 'Lathe & tooling "as seen"');
    assert.equal(cleanHtmlText("Tom&#39;s&nbsp;lot"), "Tom's lot");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(cleanHtmlText(""), "");
  });
});

describe("getCoordinatesForLocation", () => {
  it("finds known UK towns", () => {
    assert.deepEqual(getCoordinatesForLocation("Unit 4, Wakefield, West Yorkshire"), { latitude: 53.6829, longitude: -1.4912 });
  });

  it("finds known US cities when the country is US", () => {
    assert.deepEqual(getCoordinatesForLocation("Santa Clara, CA", "US"), { latitude: 37.3541, longitude: -121.9552 });
  });

  it("falls back to a default point for unknown places", () => {
    assert.deepEqual(getCoordinatesForLocation("Somewhere unknown"), { latitude: 51.5074, longitude: -0.1278 });
    assert.deepEqual(getCoordinatesForLocation("Somewhere unknown", "US"), { latitude: 37.5841, longitude: -122.3661 });
  });

  it("keeps UK addresses in the UK", { todo: '", ca" in "Leeds, Cambridgeshire" is read as California' }, () => {
    const coords = getCoordinatesForLocation("Unit 2, Leeds, Cambridgeshire");
    assert.ok(coords.longitude > -10 && coords.longitude < 2, "longitude within the UK");
  });

  it("matches whole place names only", { todo: '"hull" matches inside "Solihull"' }, () => {
    const hull = getCoordinatesForLocation("Hull");
    assert.notDeepEqual(getCoordinatesForLocation("Solihull, West Midlands"), hull);
  });
});

describe("inferCategoryFromTitle", () => {
  it("classifies clear examples", () => {
    assert.equal(inferCategoryFromTitle("Colchester CNC lathe"), "Industrial & Machinery");
    assert.equal(inferCategoryFromTitle("Agilent HPLC system"), "Laboratory & Biotech");
    assert.equal(inferCategoryFromTitle("Cisco network switch"), "IT & Telecom Equipment");
  });

  it("falls back to surplus equipment", () => {
    assert.equal(inferCategoryFromTitle("Assorted boxes"), "Surplus Tech & Equipment");
  });

  it("matches whole words only", () => {
    assert.notEqual(inferCategoryFromTitle("Oak dining table"), "Laboratory & Biotech");
    assert.notEqual(inferCategoryFromTitle("Farm gate"), "Robotics & Automation");
    assert.notEqual(inferCategoryFromTitle("Graphics card"), "Vehicles & Fleet");
  });
});

describe("categorizeByTitle", () => {
  it("matches whole words and plurals", () => {
    assert.equal(categorizeByTitle("Myford lathe", "General"), "Machinery");
    assert.equal(categorizeByTitle("Two office chairs", "General"), "Furniture");
    assert.equal(categorizeByTitle("Victorian walnut armchairs", "General"), "Furniture");
    assert.equal(categorizeByTitle("Ford Transit van", "General"), "Vehicles");
  });

  it("does not match keywords inside other words", () => {
    assert.equal(categorizeByTitle("Espresso cups", "General"), "General");
    assert.equal(categorizeByTitle("Carpet roll", "General"), "General");
    assert.equal(categorizeByTitle("Graphics card", "General"), "General");
    assert.equal(categorizeByTitle("Vanity unit", "General"), "General");
    assert.equal(categorizeByTitle("Pepper mill", "General"), "General");
  });

  it("uses the caller's fallback when nothing matches", () => {
    assert.equal(categorizeByTitle("Box of odds", "Industrial"), "Industrial");
  });
});

describe("extractCategoryName", () => {
  it("reads category names from the shapes APIs return", () => {
    assert.equal(extractCategoryName("  Plant  "), "Plant");
    assert.equal(extractCategoryName({ name: { en: "Catering" } }), "Catering");
    assert.equal(extractCategoryName({ title: "Vehicles" }), "Vehicles");
  });

  it("guesses from the title when there is no category", () => {
    assert.equal(extractCategoryName(null, "Bench grinder and welder"), "Machinery");
    assert.equal(extractCategoryName(undefined, "Box of odds"), "General");
  });
});
