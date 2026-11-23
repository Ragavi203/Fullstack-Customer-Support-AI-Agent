import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { findCustomerByEmail, resetDemoData } from "../data/customers";
import { evaluateRefund } from "./policy";

beforeEach(() => resetDemoData());

test("approves Avery's in-window Plus charge and rejects the others", () => {
  const avery = findCustomerByEmail("avery.chen@example.com")!;
  const approved = evaluateRefund(avery, 35);
  assert.equal(approved.approved, true);
  assert.equal(approved.amountUsd, 35);

  const tooMuch = evaluateRefund(avery, 80);
  assert.equal(tooMuch.approved, false);

  const sam = findCustomerByEmail("sam.okonkwo@example.com")!;
  assert.match(evaluateRefund(sam, null).reason, /Prepaid refills are not refundable/);

  const riley = findCustomerByEmail("riley.shah@example.com")!;
  assert.match(evaluateRefund(riley, 65).reason, /past due/);

  const jordan = findCustomerByEmail("jordan.blake@example.com")!;
  assert.equal(evaluateRefund(jordan, null).approved, true);
  assert.equal(evaluateRefund(jordan, null).amountUsd, 225);
});
