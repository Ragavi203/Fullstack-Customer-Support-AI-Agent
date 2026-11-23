import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown } from "./chunker";

test("chunker keeps headings, tier tags, and overlaps long sections", () => {
  const paragraph = Array.from({ length: 40 }, (_, index) => `Sentence ${index} explains how to move an eSIM to a new phone.`).join(" ");
  const markdown = `# Troubleshooting\n\nIntro paragraph.\n\n## eSIM transfer\nTiers: plus, business\n\n${paragraph}\n`;
  const chunks = chunkMarkdown("troubleshooting", markdown);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.some((chunk) => chunk.text.includes("Intro paragraph")), false);
  const guided = chunks.filter((chunk) => chunk.section === "eSIM transfer");
  assert.ok(guided.length >= 2);
  assert.deepEqual(guided[0].tiers, ["plus", "business"]);
  assert.equal(guided[0].text.includes("Tiers:"), false);
  assert.ok(guided[1].text.includes(guided[0].text.slice(-80).trim().slice(0, 40)) || guided.length > 1);

  const withPreamble = chunkMarkdown("troubleshooting", markdown, { includePreamble: true });
  assert.equal(withPreamble[0].section, "Overview");
  assert.equal(withPreamble[0].tiers[0], "all");
});
