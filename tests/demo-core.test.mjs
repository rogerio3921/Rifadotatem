import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCampaigns, defaultSettings, validateCampaigns, validateReservations, validateSettings,
  statusOf, occupiedNumbers, assertCampaignCapacity, isCampaignPriceLocked, assertCampaignPrice,
  preserveCampaignPriceLocks, makeReservation, updateReservations, receiptPDF, validateCoverFile, MAX_COVER_BYTES, campaignProgress, deleteCampaign
} from "../demo-core.mjs";

const campaign = { ...defaultCampaigns[0], price: 19.90 };
const now = Date.UTC(2026, 10, 6);
const reserve = (overrides = {}) => makeReservation({
  campaign, numbers: [1, 2], name: "Teste", phone: "(11) 99999-9999", records: [], hours: 24, id: "pedido-1", now, ...overrides
});

test("cover upload accepts exactly 10 MB and rejects larger, empty or unsupported files", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.doesNotThrow(() => validateCoverFile({ type, size: MAX_COVER_BYTES }));
    assert.doesNotThrow(() => validateCoverFile({ type, size: 2 * 1024 * 1024 }));
  }
  for (const file of [
    { type: "image/png", size: MAX_COVER_BYTES + 1 },
    { type: "image/png", size: 0 },
    { type: "image/svg+xml", size: 100 }
  ]) assert.throws(() => validateCoverFile(file), /10 MB/);
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
  assert.deepEqual(validateCampaigns([]), []);
  assert.throws(() => validateCampaigns(null));
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

test("campaign progress separates confirmed, pending, expired, cancelled and other campaigns", () => {
  const rows = [
    { ...reserve({ numbers: [1, 2] }), status: "sold" },
    reserve({ numbers: [3, 4], id: "pending" }),
    { ...reserve({ numbers: [5], id: "expired" }), expires: now },
    { ...reserve({ numbers: [6], id: "cancelled" }), status: "cancelled" },
    { ...reserve({ numbers: [7], id: "other" }), campaign: "other", status: "sold" }
  ];
  assert.deepEqual(campaignProgress({ ...campaign, count: 10, minimum: 50 }, rows, now), {
    confirmed: 2, reserved: 2, available: 6, remaining: 8, percent: 20,
    minimumPercent: 50, minimum: 5, remainingToMinimum: 3
  });
  assert.equal(campaignProgress(campaign, rows, now + 86400000).reserved, 0);
});

test("campaign targets round up and distinguish minimum reached from fully sold", () => {
  assert.equal(campaignProgress({ ...campaign, count: 101 }, [], now).minimum, 51);
  assert.equal(campaignProgress({ ...campaign, minimum: 0 }, [], now).remainingToMinimum, 0);
  const sold = { ...reserve({ numbers: [1, 2] }), status: "sold" };
  const halfway = campaignProgress({ ...campaign, count: 4, minimum: 50 }, [sold], now);
  assert.equal(halfway.remainingToMinimum, 0);
  assert.equal(halfway.remaining, 2);
  const full = campaignProgress({ ...campaign, count: 2, minimum: 100 }, [sold], now);
  assert.equal(full.percent, 100);
  assert.equal(full.available, 0);
  assert.equal(full.remaining, 0);
  assert.equal(full.remainingToMinimum, 0);
});

test("price can increase or decrease only before the first reservation in that campaign", () => {
  assert.equal(isCampaignPriceLocked(campaign, []), false);
  for (const price of [10, 30]) {
    assert.doesNotThrow(() => assertCampaignPrice(campaign, { ...campaign, price }, []));
    assert.doesNotThrow(() => assertCampaignPrice(campaign, { ...campaign, price }, [{ ...reserve(), campaign: "other" }]));
  }
});

test("first reservation locks increases and decreases regardless of payment, expiration or cancellation", () => {
  const record = reserve();
  for (const row of [record, { ...record, status: "sold" }, { ...record, expires: 0 }, { ...record, status: "cancelled" }]) {
    assert.equal(isCampaignPriceLocked(campaign, [row]), true);
    for (const price of [10, 30]) {
      assert.throws(() => assertCampaignPrice(campaign, { ...campaign, price }, [row]), /primeira reserva/);
    }
    assert.doesNotThrow(() => assertCampaignPrice(campaign, { ...campaign, name: "Novo título" }, [row]));
  }
});

test("legacy reservations lock prices without changing their totals or numbers", () => {
  const legacy = { ...reserve() };
  delete legacy.total;
  delete legacy.unitPrice;
  const before = structuredClone(legacy);
  assert.throws(() => assertCampaignPrice(campaign, { ...campaign, price: 30 }, [legacy]));
  assert.deepEqual(legacy, before);
});

test("price locks persist when the reservation history is cleared", () => {
  const campaigns = preserveCampaignPriceLocks([campaign, defaultCampaigns[1]], [reserve()]);
  assert.equal(campaigns[0].priceLocked, true);
  assert.equal(isCampaignPriceLocked(campaigns[1], []), false);
  const reloaded = validateCampaigns(JSON.parse(JSON.stringify(campaigns)));
  assert.throws(() => assertCampaignPrice(reloaded[0], { ...reloaded[0], price: 30 }, []));
  assert.equal(preserveCampaignPriceLocks(reloaded, [])[0].priceLocked, true);
  assert.throws(() => validateCampaigns([{ ...campaign, priceLocked: "true" }]));
});

test("deletes only campaigns without reservation history, including the last campaign", () => {
  assert.deepEqual(deleteCampaign([campaign], campaign.id, []), []);
  assert.deepEqual(validateCampaigns(JSON.parse(JSON.stringify([]))), []);
  assert.deepEqual(deleteCampaign([campaign, defaultCampaigns[1]], campaign.id, [
    { ...reserve(), campaign: defaultCampaigns[1].id }
  ]), [defaultCampaigns[1]]);
  assert.throws(() => deleteCampaign([campaign], "missing", []), /não encontrada/);
  for (const record of [reserve(), { ...reserve(), status: "sold" }, { ...reserve(), expires: 0 }, { ...reserve(), status: "cancelled" }]) {
    assert.throws(() => deleteCampaign([campaign], campaign.id, [record]), /já recebeu reservas/);
  }
  const locked = preserveCampaignPriceLocks([campaign], [reserve()]);
  assert.throws(() => deleteCampaign(locked, campaign.id, []), /já recebeu reservas/);
  assert.equal(locked.length, 1);
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
