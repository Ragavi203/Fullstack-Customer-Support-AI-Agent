import assert from "node:assert/strict";
import test from "node:test";
import { cosine, localEmbed, sharesContentTerm, stem } from "./embeddings";

test("stemmer maps inflections of the same word together", () => {
  const same = (words: string[]) => assert.equal(new Set(words.map(stem)).size, 1, words.join(", "));
  same(["bill", "billing", "billed", "bills"]);
  same(["line", "lines"]);
  same(["charge", "charges", "charged", "charging"]);
  same(["drop", "dropped", "dropping", "drops"]);
  same(["call", "calls", "calling"]);
  same(["email", "emailed", "emails"]);
  same(["policy", "policies"]);
  same(["pass", "passes"]);
});

test("local embeddings rank a refund query above an unrelated one", () => {
  const refund = localEmbed("Refund policy. Pro plan. Pro accounts may refund the last charge within 14 days up to $50.");
  const pizza = localEmbed("pizza brooklyn recipe");
  const query = localEmbed("Can I get a refund for my last charge?");
  assert.ok(cosine(query, refund) > cosine(pizza, refund));
});

test("lexical guard rejects a vector hit that shares no content words", () => {
  assert.equal(sharesContentTerm("best pizza in brooklyn", "Pro refund window is 14 days."), false);
  assert.equal(sharesContentTerm("refund my last charge", "Pro accounts may refund the last charge."), true);
});
