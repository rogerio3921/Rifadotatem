import test from "node:test";
import assert from "node:assert/strict";
import { ServerClient } from "../server-client.mjs";
import { receiptPDF } from "../demo-core.mjs";

const snapshot = {
  campaigns: [], reservations: [], settings: {}, occupancy: [],
  ownOrderIds: [], admin: false, csrf: "csrf-test", serverNow: 1700000000000
};

test("server client sends session cookies and CSRF, without local-storage fallback", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify(snapshot));
  });
  const client = new ServerClient();
  await client.request();
  await client.mutate("login", { user: "tatem", password: "test-only" });
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[1][1].headers["X-CSRF-Token"], "csrf-test");
  assert.deepEqual(JSON.parse(calls[1][1].body), { action: "login", user: "tatem", password: "test-only" });
});

test("server errors and invalid payloads are explicit and release mutation lock", async t => {
  const client = new ServerClient();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "Sessão encerrada." }), { status: 401 }));
  await assert.rejects(client.mutate("campaign-delete", { id: "one" }), error =>
    error.status === 401 && error.message === "Sessão encerrada.");
  assert.equal(client.pending, false);
  globalThis.fetch.mock.mockImplementation(async () => new Response("<html>PHP indisponível</html>"));
  await assert.rejects(client.request(), /resposta válida/);
  globalThis.fetch.mock.mockImplementation(async () => new Response("{}"));
  await assert.rejects(client.request(), /incompletos/);
});

test("server client prevents overlapping mutations", async t => {
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => {
    release = () => resolve(new Response(JSON.stringify(snapshot)));
  }));
  const client = new ServerClient();
  const first = client.mutate("settings-save", { settings: {} });
  await assert.rejects(client.mutate("settings-save", { settings: {} }), /Aguarde/);
  release();
  await first;
  assert.equal(client.pending, false);
});

test("late refresh cannot overwrite the CSRF token returned by a newer request", async t => {
  let release;
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++count === 1) return new Promise(resolve => {
      release = () => resolve(new Response(JSON.stringify({ ...snapshot, csrf: "old" })));
    });
    return new Response(JSON.stringify({ ...snapshot, csrf: "new" }));
  });
  const client = new ServerClient();
  const refresh = client.request();
  await client.mutate("login", {});
  release();
  await refresh;
  assert.equal(client.csrf, "new");
});

test("connection errors warn about uncertain outcome instead of claiming failure to save", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network down"); });
  await assert.rejects(new ServerClient().mutate("reserve", {}), /Consulte o status da reserva/);
});

test("manual receipt records organizer confirmation without demo or bank-verification claims", () => {
  const order = {
    id: "one", orderNumber: "000001", status: "sold", name: "Cliente",
    phone: "11999999999", campaign: "one", numbers: [1, 2],
    total: 100, created: 1700000000000, confirmed: 1700000001000
  };
  const pdf = receiptPDF(order, "Tatem", { manual: true });
  assert.match(pdf, /CONFIRMACAO MANUAL/);
  assert.match(pdf, /SEM VALOR FISCAL/);
  assert.match(pdf, /sem consulta bancaria/);
  assert.match(pdf, /Total registrado: R\$/);
  assert.doesNotMatch(pdf, /DEMONSTRATIVO|Total simulado|Dados locais/);
  assert.throws(() => receiptPDF({ ...order, status: "reserved" }, "Tatem", { manual: true }), /confirmação manual/);
});
