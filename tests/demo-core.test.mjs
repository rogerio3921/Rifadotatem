import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCampaigns, defaultSettings, validateCampaigns, validateReservations, validateSettings,
  statusOf, occupiedNumbers, assertCampaignCapacity, makeReservation, updateReservations, receiptPDF
} from "../demo-core.mjs";

const campaign = { ...defaultCampaigns[0], price: 19.90 };
const now = Date.UTC(2026, 10, 6);
const reserve = (overrides = {}) => makeReservation({
  campaign, numbers: [1, 2], name: "Teste", phone: "(11) 99999-9999", records: [], hours: 24, id: "pedido-1", now, ...overrides
});

test("validates defaults and accepts campaigns saved before the storyboard update", () => {
  assert.equal(validateCampaigns(defaultCampaigns).length, 2);
  const { minimum, cover, ...legacy } = campaign;
  assert.equal(validateCampaigns([legacy])[0].id, "pesca");
  assert.equal(validateSettings(defaultSettings).hours, 24);
});

test("rejects malformed or duplicate campaigns, prices and impossible dates", () => {
  for (const patch of [{ price: 0 }, { price: 1.001 }, { count: 1001 }, { count: 1.5 }, { date: "2026-02-30" }, { cover: "javascript:alert(1)" }]) {
    assert.throws(() => validateCampaigns([{ ...campaign, ...patch }]));
  }
  assert.throws(() => validateCampaigns([campaign, campaign]));
  assert.throws(() => validateCampaigns([]));
});

test("reservation stores a price snapshot, normalizes phone, deduplicates numbers and increments order number", () => {
  const first = reserve({ numbers: [2, 1, 2] });
  assert.deepEqual(first.numbers, [1, 2]);
  assert.equal(first.total, 39.8);
  assert.equal(first.phone, "11999999999");
  assert.equal(first.orderNumber, "000001");
  assert.equal(first.expires, now + 86400000);
  const second = reserve({ records: [first], numbers: [3], id: "pedido-2" });
  assert.equal(second.orderNumber, "000002");
  campaign.price = 20;
  assert.equal(first.unitPrice, 19.9);
  assert.equal(first.total, 39.8);
  campaign.price = 19.9;
});

test("blocks invalid input, occupied numbers and empty selection", () => {
  const first = reserve();
  assert.throws(() => reserve({ records: [first], now: now + 1 }), /disponíveis/);
  for (const patch of [{ numbers: [] }, { numbers: [101] }, { numbers: [0] }, { phone: "123" }, { name: " " }, { hours: 0 }]) {
    assert.throws(() => reserve(patch));
  }
});

test("expiration and cancellation free numbers but confirmed orders stay occupied", () => {
  const record = reserve();
  assert.equal(statusOf(record, record.expires), "expired");
  assert.equal(occupiedNumbers([record], campaign.id, record.expires).size, 0);
  const cancelled = updateReservations([record], new Set([record.id]), "cancelled", now + 1);
  assert.equal(occupiedNumbers(cancelled, campaign.id, now + 2).size, 0);
  const sold = updateReservations([record], new Set([record.id]), "sold", now + 1);
  assert.equal(occupiedNumbers(sold, campaign.id, record.expires + 1).size, 2);
});

test("expired, missing and already processed orders cannot be confirmed", () => {
  const record = reserve();
  assert.throws(() => updateReservations([record], new Set([record.id]), "sold", record.expires));
  assert.throws(() => updateReservations([record], new Set(["missing"]), "sold", now));
  assert.throws(() => updateReservations([record], new Set(), "sold", now));
  assert.throws(() => updateReservations([{ ...record, status: "sold" }], new Set([record.id]), "sold", now));
});

test("campaign quantity cannot hide active or sold numbers but can discard expired numbers", () => {
  const record = reserve({ numbers: [99] });
  assert.throws(() => assertCampaignCapacity({ ...campaign, count: 50 }, [record], now));
  assert.doesNotThrow(() => assertCampaignCapacity({ ...campaign, count: 50 }, [record], record.expires));
  assert.throws(() => assertCampaignCapacity({ ...campaign, count: 50 }, [{ ...record, status: "sold" }], record.expires));
});

test("legacy reservations remain readable without inventing historical prices", () => {
  const record = reserve();
  delete record.total;
  delete record.unitPrice;
  delete record.orderNumber;
  assert.equal(validateReservations([record]).length, 1);
  assert.equal(record.total, undefined);
  assert.throws(() => validateReservations([{ ...record, numbers: [1, 1] }]));
});

test("new deadlines and settings are validated", () => {
  assert.equal(reserve({ hours: 2 }).expires, now + 7200000);
  assert.throws(() => validateSettings({ ...defaultSettings, hours: 0 }));
  assert.throws(() => validateSettings({ ...defaultSettings, hours: 1.5 }));
  assert.throws(() => validateSettings({ ...defaultSettings, hours: 169 }));
  assert.throws(() => validateSettings({ ...defaultSettings, organizer: " " }));
});

test("generates a valid ASCII PDF with demonstration warning and exact xref offsets", () => {
  const record = { ...reserve(), status: "sold", name: "João (Teste) \\ Silva" };
  const pdf = receiptPDF(record, "Tatem");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /SEM VALOR FISCAL/);
  assert.match(pdf, /Joao \\\(Teste\\\) \\\\ Silva/);
  assert.equal(Buffer.byteLength(pdf), pdf.length);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n /gm)].map(match => Number(match[1]));
  offsets.forEach((offset, index) => assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`));
  assert.throws(() => receiptPDF(reserve(), "Tatem"));
});

test("long receipts create multiple pages instead of dropping numbers", () => {
  const record = { ...reserve({ campaign: { ...campaign, count: 1000 }, numbers: Array.from({ length: 1000 }, (_, i) => i + 1) }), status: "sold" };
  const pdf = receiptPDF(record, "Tatem");
  assert.match(pdf, /\/Count [2-9]/);
  assert.match(pdf, /1000/);
});
