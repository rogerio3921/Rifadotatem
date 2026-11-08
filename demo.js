import {
  KEYS, defaultCampaigns, defaultSettings, money, displayDate, orderLabel, displayTotal, numbersLabel,
  validateCampaign, validateCampaigns, validateReservations, validateSettings,
  statusOf as localStatusOf, occupiedNumbers, assertCampaignCapacity, isCampaignPriceLocked, assertCampaignPrice,
  preserveCampaignPriceLocks, makeReservation, updateReservations, receiptPDF, validateCoverFile, campaignProgress, deleteCampaign,
  assertCampaignActive, cancelCampaign, campaignPaymentSummary
} from "./demo-core.mjs";
import { ServerClient } from "./server-client.mjs";

const $ = id => document.getElementById(id);
const server = document.body.dataset.server === "true" ? new ServerClient() : null;
const adminScreens = new Set(["painel", "nova-campanha", "reservas", "recibos", "configuracoes"]);
const statusNames = { reserved: "Aguardando confirmação", sold: "Confirmado (simulado)", expired: "Reserva expirada", cancelled: "Reserva cancelada" };
let state, route = { screen: "inicio", id: "" }, adminMode = false, editorId = null;
let selectedCampaignId = null, chosen = new Set(), selectedReservations = new Set(), expiredView = false;
let reservationOffer = null;
let cancellingCampaignId = null;
let reservationRequestId = null;
let refreshSequence = 0;
let serverTimeOffset = 0;

function now() { return Date.now() + (server ? serverTimeOffset : 0); }
function statusOf(order) { return localStatusOf(order, now()); }

function serverText(text) {
  if (!server || typeof text !== "string") return text;
  return text.replaceAll("neste navegador", "no aplicativo")
    .replaceAll("deste navegador", "do aplicativo")
    .replaceAll("Minhas reservas locais", "Minhas reservas")
    .replaceAll("histórico local", "histórico")
    .replaceAll("novas reservas locais", "novas reservas")
    .replaceAll("reservas locais", "reservas")
    .replaceAll("recibo demonstrativo", "recibo de confirmação manual")
    .replaceAll("PDF demonstrativo", "PDF de confirmação manual")
    .replaceAll("Soma demonstrativa", "Soma dos registros")
    .replaceAll("Valores confirmados registrados (simulação)", "Valores confirmados registrados")
    .replaceAll("Vendas simuladas", "Números confirmados")
    .replaceAll("Receita simulada", "Valores confirmados")
    .replaceAll("vendido (simulado)", "confirmado manualmente")
    .replaceAll("Confirmado (simulado)", "Confirmado manualmente");
}

function applyServerState(result) {
  serverTimeOffset = result.serverNow - Date.now();
  state = {
    campaigns: validateCampaigns(result.campaigns),
    reservations: validateReservations(result.reservations),
    settings: validateSettings(result.settings),
    occupancy: result.occupancy,
    ownOrderIds: result.ownOrderIds
  };
  const lostAdmin = adminMode && !result.admin;
  adminMode = result.admin;
  if (lostAdmin) {
    clearAdminViews();
    if (adminScreens.has(route.screen)) {
      setScreen("admin-login");
      go("admin-login");
    }
  }
}

function clearAdminViews() {
  for (const id of ["adminCampaigns", "dashboardStats", "reservationList", "receiptList", "receiptReminderList", "statusContent", "myOrders", "whatsAppPreview"]) $(id).replaceChildren();
  for (const id of ["campaignForm", "settingsForm", "passwordForm", "cancelCampaignForm"]) $(id).reset();
  for (const id of ["receiptReminderDialog", "cancelCampaignDialog", "messageDialog"]) if ($(id).open) $(id).close();
  selectedReservations.clear();
  editorId = null;
}

async function command(action, fields) {
  refreshSequence++;
  try {
    const result = await server.mutate(action, fields);
    refreshSequence++;
    applyServerState(result);
    return result;
  } catch (error) {
    if (error.status === 401) {
      adminMode = false;
      state = null;
      clearAdminViews();
      setScreen("admin-login");
      go("admin-login");
    }
    throw error;
  }
}

function takenNumbers(campaignId) {
  if (!server) return occupiedNumbers(state.reservations, campaignId);
  return new Map(state.occupancy.filter(item => item.campaign === campaignId).map(item => [item.number, item.status]));
}

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function link(text, hash, className = "button yellow wide") {
  const element = node("a", className, text);
  element.href = `#${hash}`;
  return element;
}

function empty(container, text) {
  container.replaceChildren(node("p", "empty", text));
}

function notify(text) {
  $("appMessage").textContent = serverText(text);
  $("appMessage").hidden = false;
}

function report(error) {
  console.error(server ? "Pescaria com o Tatem — servidor:" : "Pescaria com o Tatem — demonstração:", error);
  $("appError").textContent = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
  $("appError").hidden = false;
  if ($("cancelCampaignDialog").open) {
    $("cancelCampaignError").textContent = $("appError").textContent;
    $("cancelCampaignError").hidden = false;
  }
  $("appError").scrollIntoView({ block: "nearest" });
}

function safe(action, clearMessages = true) {
  return async (...args) => {
    if (clearMessages) {
      $("appError").hidden = true;
      $("appMessage").hidden = true;
    }
    try { await action(...args); } catch (error) { report(error); }
  };
}

function on(id, event, action) {
  $(id).addEventListener(event, safe(action));
}

function read(key, fallback, validator) {
  try {
    const stored = localStorage.getItem(key);
    return validator(stored === null ? structuredClone(fallback) : JSON.parse(stored));
  } catch (error) {
    throw new Error("Não foi possível ler os dados locais. Os dados foram preservados; verifique o armazenamento do navegador antes de recarregar.", { cause: error });
  }
}

async function loadState() {
  if (server) {
    if (server.pending && state) return;
    const sequence = ++refreshSequence;
    const result = await server.request();
    if (sequence === refreshSequence) applyServerState(result);
    return;
  }
  state = {
    campaigns: read(KEYS.campaigns, defaultCampaigns, validateCampaigns),
    reservations: read(KEYS.reservations, [], validateReservations),
    settings: read(KEYS.settings, defaultSettings, validateSettings)
  };
}

function persist(key, value) {
  if (server) throw new Error("A gravação deve ser confirmada pelo servidor.");
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) {
    throw new Error("Não foi possível salvar. O armazenamento pode estar cheio ou bloqueado. Seus dados anteriores foram mantidos; tente uma capa menor ou verifique o navegador.", { cause: error });
  }
}

function go(screen, id = "") {
  const hash = `#${screen}${id ? `/${encodeURIComponent(id)}` : ""}`;
  $("appError").hidden = true;
  $("appMessage").hidden = true;
  if (location.hash === hash) safe(render)();
  else location.hash = hash;
}

function currentCampaign(id = route.id) {
  const campaign = state.campaigns.find(item => item.id === id);
  if (!campaign) throw new Error(server
    ? "Montar Rifa não encontrada. Abra o menu e escolha uma Montar Rifa disponível."
    : "Montar Rifa não encontrada neste navegador. Abra o menu e escolha uma Montar Rifa disponível.");
  return campaign;
}

function currentOrder(id = route.id) {
  const order = state.reservations.find(item => item.id === id);
  if (!order) throw new Error(server
    ? "Reserva não encontrada ou sem acesso neste navegador. Consulte Minhas reservas ou contate o organizador."
    : "Reserva não encontrada neste navegador. Abra o menu e consulte suas reservas locais.");
  return order;
}

function setScreen(screen) {
  document.querySelectorAll("[data-screen]").forEach(section => { section.hidden = section.dataset.screen !== screen; });
  $("appMenu").hidden = true;
  $("menuToggle").setAttribute("aria-expanded", "false");
}

async function render() {
  $("appError").hidden = true;
  await loadState();
  const [screen = "inicio", id = ""] = location.hash.slice(1).split("/");
  route = { screen: screen || "inicio", id: decodeURIComponent(id) };
  if (adminScreens.has(route.screen) && !adminMode) {
    go("admin-login");
    notify(server ? "Entre com seu usuário e senha para acessar a administração." : "Entre com tatem / demo para abrir a simulação administrativa. Isto não é autenticação real.");
    return;
  }
  const screens = {
    inicio: () => {},
    campanhas: renderCampaigns,
    numeros: renderNumbers,
    reserva: renderReservation,
    pagamento: renderPayment,
    status: renderStatus,
    "admin-login": () => {
      $("loginForm").reset();
      $("loginPassword").type = "password";
      $("showPassword").setAttribute("aria-label", server ? "Mostrar senha" : "Mostrar senha de teste");
      $("showPassword").setAttribute("aria-pressed", "false");
    },
    painel: renderDashboard,
    "nova-campanha": renderCampaignForm,
    reservas: () => { selectedReservations.clear(); renderPending(); },
    recibos: renderReceipts,
    configuracoes: renderSettings,
    "meus-pedidos": renderMyOrders
  };
  if (!screens[route.screen]) throw new Error("Tela não encontrada. Use o menu para voltar ao início.");
  setScreen(route.screen);
  $("adminEntry").href = adminMode ? "#painel" : "#admin-login";
  const parents = { campanhas: "inicio", numeros: "campanhas", reserva: `numeros/${route.id}`, pagamento: "meus-pedidos", status: "meus-pedidos", "admin-login": "inicio", painel: "campanhas", "nova-campanha": "painel", reservas: "painel", recibos: "painel", configuracoes: "painel", "meus-pedidos": "campanhas" };
  $("backButton").href = `#${parents[route.screen] || "inicio"}`;
  screens[route.screen]();
  $("app").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function campaignCover(campaign) {
  const wrapper = node("div");
  if (campaign.cover) {
    const image = node("img", "campaign-cover");
    image.src = campaign.cover;
    image.alt = `Capa da Montar Rifa ${campaign.name}`;
    wrapper.append(image);
  } else {
    const image = node("img", "sample-cover");
    image.src = "assets/pescaria-campanha.png";
    image.alt = "Barco ao pôr do sol, imagem ilustrativa do storyboard";
    wrapper.append(image, node("p", "cover-note", "Imagem ilustrativa · envie a capa da Montar Rifa no painel"));
  }
  return wrapper;
}

function renderCampaigns() {
  const list = $("campaignList");
  list.replaceChildren();
  const activeCampaigns = state.campaigns.filter(campaign => !campaign.cancellation);
  if (!activeCampaigns.length) {
    empty(list, "Nenhuma Montar Rifa cadastrada no momento.");
    return;
  }
  activeCampaigns.forEach(campaign => {
    const card = node("article", "campaign-card"), body = node("div", "card-body");
    const sold = [...takenNumbers(campaign.id).values()].filter(status => status === "sold").length;
    body.append(node("h2", "", campaign.name), node("p", "small", campaign.desc), node("p", "small", `Prêmio: ${campaign.prize}`));
    const facts = node("div", "facts");
    facts.append(node("strong", "", `▧ ${campaign.count} números`), node("strong", "", `Sorteio: ${displayDate(campaign.date)}`));
    facts.append(node("span", "", `${campaign.count - takenNumbers(campaign.id).size} disponíveis · ${sold} confirmados`));
    body.append(facts, node("strong", "price", `${money(campaign.price)} por número`), link("Participar", `numeros/${encodeURIComponent(campaign.id)}`));
    const rules = node("details", "rules");
    rules.append(node("summary", "", server ? "Regras e condições" : "Regras e condições da demonstração"), node("p", "", `Condição mínima de vendas: ${campaign.minimum ?? 50}%. ${state.settings.rules}`));
    body.append(rules);
    card.append(campaignCover(campaign), body);
    list.append(card);
  });
}

function renderNumbers() {
  const campaign = currentCampaign();
  assertCampaignActive(campaign);
  if (selectedCampaignId !== campaign.id) { chosen.clear(); selectedCampaignId = campaign.id; }
  const taken = takenNumbers(campaign.id);
  chosen = new Set([...chosen].filter(n => n <= campaign.count && !taken.has(n)));
  $("numberCampaign").textContent = campaign.name;
  $("numbers").replaceChildren();
  for (let n = 1; n <= campaign.count; n++) {
    const status = taken.get(n) || (chosen.has(n) ? "selected" : "available");
    const button = node("button", `number ${status}`, String(n).padStart(2, "0"));
    button.type = "button";
    button.disabled = taken.has(n);
    button.setAttribute("aria-label", serverText(`Número ${n}, ${status === "selected" ? "selecionado" : status === "available" ? "disponível" : status === "sold" ? "vendido (simulado)" : "reservado"}`));
    button.setAttribute("aria-pressed", String(chosen.has(n)));
    button.addEventListener("click", safe(() => {
      reservationRequestId = null;
      chosen.has(n) ? chosen.delete(n) : chosen.add(n);
      renderNumbers();
      $("numbers").children[n - 1].focus({ preventScroll: true });
    }));
    $("numbers").append(button);
  }
  $("selectionCount").textContent = `${chosen.size} número(s) selecionado(s)`;
  $("unitPrice").textContent = `Valor por número: ${money(campaign.price)}`;
  $("selectionTotal").textContent = `Valor total: ${money(Math.round(chosen.size * campaign.price * 100) / 100)}`;
  $("continueReservation").disabled = chosen.size === 0;
}

function renderReservation() {
  const campaign = currentCampaign();
  assertCampaignActive(campaign);
  if (selectedCampaignId !== campaign.id || !chosen.size) {
    go("numeros", campaign.id);
    notify("Selecione os números antes de confirmar a reserva.");
    return;
  }
  $("reservationDeadline").textContent = `Seus números ficarão reservados por ${state.settings.hours} hora(s), aguardando confirmação ${server ? "manual" : "simulada"} do Tatem.`;
  $("chosenNumbers").replaceChildren(...[...chosen].sort((a, b) => a - b).map(n => node("span", "chip", String(n).padStart(2, "0"))));
  $("reservationTotal").textContent = money(Math.round(chosen.size * campaign.price * 100) / 100);
  reservationOffer = { campaignId: campaign.id, price: campaign.price, hours: state.settings.hours };
}

function renderPayment() {
  const order = currentOrder();
  if (state.campaigns.find(campaign => campaign.id === order.campaign)?.cancellation) {
    go("status", order.id);
    return;
  }
  if (statusOf(order) !== "reserved") { go("status", order.id); return; }
  $("pixKey").textContent = server ? state.settings.pixKey : `DEMO-${state.settings.pixKey}`;
  $("pixReceiver").textContent = state.settings.organizer;
  $("paymentTotal").textContent = displayTotal(order);
  $("paymentOrder").textContent = `Pedido ${orderLabel(order)} · ${server ? "Confirmação manual pelo organizador" : "Teste local"}`;
  $("openStatus").href = `#status/${encodeURIComponent(order.id)}`;
}

function tag(order) {
  const status = statusOf(order);
  return node("span", `status-tag ${status}`, serverText(statusNames[status]));
}

function renderStatus() {
  const order = currentOrder(), status = statusOf(order);
  const cancellation = state.campaigns.find(campaign => campaign.id === order.campaign)?.cancellation;
  const root = $("statusContent"), hero = node("div", "status-hero");
  const titles = { reserved: "Reserva concluída!", sold: "Participação confirmada!", expired: "Prazo da reserva encerrado", cancelled: "Reserva cancelada" };
  hero.append(node("span", "status-icon", status === "sold" || status === "reserved" ? "✓" : "◷"), node("h2", "", titles[status]), node("strong", "", `Pedido ${orderLabel(order)}`));
  const details = node("dl", "status-details");
  const fields = [
    ["Montar Rifa", order.campaignName || state.campaigns.find(c => c.id === order.campaign)?.name || order.campaign],
    [server ? "Participante" : "Participante de teste", order.name], ["Números", numbersLabel(order.numbers)],
    [server ? "Valor total" : "Valor total simulado", displayTotal(order)], ["Prazo", new Date(order.expires).toLocaleString("pt-BR")]
  ];
  fields.forEach(([label, text]) => {
    const row = node("div");
    row.append(node("dt", "", label), node("dd", "", text));
    details.append(row);
  });
  const notes = {
    reserved: "Aguardando confirmação simulada do pagamento pelo Tatem. Nenhum Pix foi realizado. Após a confirmação no painel local, o recibo demonstrativo ficará disponível.",
    sold: "Confirmação registrada somente neste navegador. O recibo é demonstrativo e não comprova pagamento real.",
    expired: "Os números foram liberados automaticamente para novas reservas locais. Este pedido não pode ser confirmado.",
    cancelled: "Os números foram liberados. Esta reserva de teste não pode ser confirmada."
  };
  if (server) Object.assign(notes, {
    reserved: "Aguardando conferência e confirmação manual do pagamento pelo Tatem. O aplicativo não consulta bancos ou Pix.",
    sold: "Confirmação registrada manualmente pelo organizador. O recibo registra essa confirmação, sem verificação bancária automática.",
    expired: "O prazo encerrou e os números foram liberados. Se já transferiu, contate o organizador para conferir o pagamento e a devolução.",
    cancelled: "Os números foram liberados. Se já transferiu, contate o organizador para conferir o pagamento e a devolução."
  });
  root.replaceChildren(hero, details, tag(order), node("p", `notice ${status === "sold" ? "success" : "warning"}`, notes[status]));
  if (cancellation) {
    hero.querySelector("h2").textContent = "Montar Rifa cancelada";
    hero.querySelector(".status-icon").textContent = "✕";
    const notice = node("div", "notice warning");
    notice.append(node("strong", "", `Justificativa: ${cancellation.reason}`), node("p", "", order.status === "sold"
      ? "O organizador deve entrar em contato e devolver o valor pago manualmente. Nenhum reembolso está registrado como realizado."
      : "Não realize pagamentos. Se já pagou e o pagamento ainda não foi confirmado, contate o organizador para conferir e devolver o valor."));
    root.replaceChildren(hero, notice, details);
  }
  if (status === "reserved" && !cancellation) root.append(link(server ? "Ver instruções de Pix" : "Ver instruções de Pix simulado", `pagamento/${encodeURIComponent(order.id)}`, "button soft-blue wide"));
  $("statusReceipt").hidden = status !== "sold";
}

function renderDashboard() {
  const pending = state.reservations.filter(r => statusOf(r) === "reserved" && !isCancelledOrder(r));
  const sales = state.reservations.filter(r => r.status === "sold");
  const revenue = sales.reduce((sum, r) => sum + (r.total ?? 0), 0);
  const stats = [
    ["▧", "Montar Rifa", `${state.campaigns.filter(c => !c.cancellation).length} ativas`],
    ["♧", "Reservas", `${pending.length} pendentes`],
    ["✓", "Vendas simuladas", `${sales.reduce((sum, r) => sum + r.numbers.length, 0)} números`],
    ["＄", "Receita simulada", money(revenue)]
  ];
  $("dashboardStats").replaceChildren(...stats.map(([icon, label, value]) => {
    const stat = node("div", "stat");
    stat.append(node("span", "stat-icon", icon), node("span", "", serverText(label)), node("strong", "", value));
    if (label === "Receita simulada" && sales.some(r => r.total === undefined)) stat.append(node("small", "", "Não inclui reservas antigas sem valor registrado."));
    if (label === "Receita simulada" && sales.some(isCancelledOrder)) stat.append(node("small", "", "Inclui valores históricos de Montar Rifa canceladas; devoluções não foram descontadas."));
    return stat;
  }));
  $("pendingBadge").textContent = String(pending.length);
  $("adminCampaigns").replaceChildren(...state.campaigns.map(campaign => {
    const row = node("div", "list-row"), info = node("div", "row-info");
    info.append(node("strong", "", campaign.name), node("p", "", `${campaign.prize} · ${money(campaign.price)} · ${campaign.count} números`));
    const progress = campaignProgress(campaign, state.reservations, now());
    const payments = campaignPaymentSummary(campaign.id, state.reservations);
    const metrics = node("dl", "campaign-metrics");
    [
      ["Confirmados", `${progress.confirmed} de ${campaign.count}`],
      ["Reservados aguardando pagamento", progress.reserved],
      ["Disponíveis para reservar", progress.available],
      ["Faltam para vender todos", progress.remaining]
    ].forEach(([label, value]) => {
      const metric = node("div");
      metric.append(node("dt", "", label), node("dd", "", String(value)));
      metrics.append(metric);
    });
    const paymentMetric = node("div");
    paymentMetric.append(
      node("dt", "", server ? "Valores confirmados registrados" : "Valores confirmados registrados (simulação)"),
      node("dd", "", money(payments.knownAmount))
    );
    metrics.append(paymentMetric);
    const bar = node("progress", "campaign-progress");
    bar.max = campaign.count;
    bar.value = progress.confirmed;
    bar.setAttribute("aria-label", `Vendas confirmadas de ${campaign.name}`);
    bar.textContent = `${progress.confirmed} de ${campaign.count}`;
    const percent = progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    info.append(metrics, bar, node("p", "muted", `${percent}% dos números confirmados`));
    if (campaign.cancellation) {
      info.append(node("p", "muted", "Indicadores históricos: esta Montar Rifa não aceita mais reservas ou pagamentos."));
    } else {
      info.append(node("p", "notice info", progress.remainingToMinimum > 0
        ? `Mínimo para o sorteio: ${progress.minimumPercent}% (${progress.minimum} números confirmados). Faltam ${progress.remainingToMinimum}.`
        : `Mínimo para o sorteio atingido: ${progress.minimumPercent}% (${progress.minimum} números confirmados).`));
      info.append(node("p", "muted", progress.remaining === 0
        ? "Todos os números foram confirmados. O sorteio e o encerramento não são automáticos."
        : "Reservas sem pagamento confirmado ainda contam como faltantes para vender todos."));
    }
    if (isCampaignPriceLocked(campaign, state.reservations)) info.append(node("p", "muted", "Valor bloqueado: esta Montar Rifa já recebeu uma reserva."));
    const actions = node("div", "stack");
    const remove = node("button", "button danger", "Excluir Montar Rifa");
    remove.type = "button";
    remove.disabled = Boolean(campaign.cancellation) || isCampaignPriceLocked(campaign, state.reservations);
    remove.setAttribute("aria-label", `Excluir Montar Rifa ${campaign.name}`);
    if (remove.disabled) {
      remove.title = "Esta Montar Rifa já recebeu reservas e não pode ser excluída.";
      info.append(node("p", "muted", "Exclusão bloqueada: Montar Rifa com histórico de reservas são preservadas."));
    }
    remove.addEventListener("click", safe(async () => {
      if (!confirm(`Excluir a Montar Rifa "${campaign.name}" e sua capa? Esta ação não pode ser desfeita.`)) return;
      await loadState();
      const next = deleteCampaign(state.campaigns, campaign.id, state.reservations);
      if (server) await command("campaign-delete", { id: campaign.id });
      else { persist(KEYS.campaigns, next); state.campaigns = next; }
      if (selectedCampaignId === campaign.id) { selectedCampaignId = null; chosen.clear(); }
      renderDashboard();
      notify("Montar Rifa e capa excluídas deste navegador.");
    }));
    if (campaign.cancellation) {
      info.append(node("h2", "", "Montar Rifa cancelada"), node("p", "", `Justificativa: ${campaign.cancellation.reason}`),
        node("p", "muted", `Cancelada em ${new Date(campaign.cancellation.created).toLocaleString("pt-BR")}`));
      const refunds = state.reservations.filter(order => order.campaign === campaign.id && order.status === "sold");
      const payments = campaignPaymentSummary(campaign.id, state.reservations);
      info.append(node("p", "notice warning", "Entre em contato com os clientes e devolva manualmente os valores pagos. Nenhum aviso ou reembolso foi enviado ou registrado como realizado."));
      info.append(node("h2", "", `Valores confirmados registrados para referência de devolução: ${money(payments.knownAmount)}`),
        node("p", "muted", `${payments.knownAmountCount} pedido(s) com valor registrado. ${server ? "Soma dos registros" : "Soma demonstrativa"}; confira comprovantes e transferências.`));
      if (payments.unknownAmountCount) {
        info.append(node("p", "notice warning", `${payments.unknownAmountCount} pedido(s) confirmado(s) não têm valor salvo no histórico antigo e não foram incluídos na soma.`));
      }
      const refundList = node("div", "card-list");
      refunds.forEach(order => {
        const detail = orderInfo(order);
        detail.append(node("p", "", `Contato: ${order.phone} · Devolução manual a providenciar`));
        refundList.append(detail);
      });
      info.append(node("h2", "", `Pagamentos confirmados para conferir e devolver (${refunds.length})`), refundList);
      if (!refunds.length) info.append(node("p", "muted", server ? "Sem pagamentos confirmados no histórico." : "Sem pagamentos confirmados no histórico local."));
      info.append(node("p", "muted", serverText("Confira também pagamentos recebidos que ainda não estavam confirmados no aplicativo. Pedidos e recibos estão preservados em Minhas reservas locais e Recibos.")));
    } else {
      const cancel = node("button", "button danger", "Cancelar Montar Rifa");
      cancel.type = "button";
      cancel.addEventListener("click", safe(() => {
        cancellingCampaignId = campaign.id;
        $("cancelCampaignForm").reset();
        $("cancelCampaignError").hidden = true;
        $("cancelCampaignName").textContent = campaign.name;
        $("cancelCampaignDialog").showModal();
      }));
      actions.append(link("Editar", `nova-campanha/${encodeURIComponent(campaign.id)}`, "button secondary"), remove, cancel);
    }
    info.append(actions);
    row.append(info);
    return row;
  }));
  if (!state.campaigns.length) empty($("adminCampaigns"), "Nenhuma Montar Rifa cadastrada. Use Montar Rifa para começar.");
}

function renderCampaignForm() {
  editorId = route.id || null;
  const campaign = editorId ? currentCampaign(editorId) : null;
  if (campaign) assertCampaignActive(campaign);
  $("campaignForm").reset();
  $("clearCoverFile").hidden = true;
  $("campaignFields").disabled = false;
  $("campaignFormTitle").textContent = campaign ? "Editar Montar Rifa" : "Montar Rifa";
  $("campaignName").value = campaign?.name || "";
  $("campaignPrize").value = campaign?.prize || "";
  $("campaignDescription").value = campaign?.desc || "";
  $("campaignCount").value = campaign?.count ?? 100;
  $("campaignPrice").value = campaign ? campaign.price.toFixed(2) : "";
  updateCampaignPriceLock(campaign);
  $("campaignDate").value = campaign?.date || "";
  $("campaignMinimum").value = campaign?.minimum ?? 50;
  showCoverPreview(campaign?.cover || "");
}

function updateCampaignPriceLock(campaign) {
  const locked = Boolean(campaign && isCampaignPriceLocked(campaign, state.reservations));
  $("campaignPrice").readOnly = locked;
  $("campaignPriceHelp").textContent = locked
    ? "Valor bloqueado desde a primeira reserva, mesmo após expiração ou cancelamento. Para outro valor, crie uma nova Montar Rifa."
    : "O valor pode ser alterado até a primeira reserva. Depois, ficará bloqueado para proteger os participantes.";
  if (locked) $("campaignPrice").value = campaign.price.toFixed(2);
}

function showCoverPreview(cover) {
  $("coverPreview").hidden = !cover;
  if (cover) $("coverPreview").src = cover;
  else $("coverPreview").removeAttribute("src");
}

async function readCover(file) {
  validateCoverFile(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch (error) { throw new Error("O arquivo não contém uma imagem válida. Escolha outra capa.", { cause: error }); }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador não conseguiu otimizar a capa. Tente outro navegador.");
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", 0.85);
      if (data.startsWith("data:image/") && data.length <= 700000) return data;
      scale *= 0.75;
    }
    throw new Error("Não foi possível otimizar esta capa. Escolha uma imagem com resolução menor.");
  } finally { URL.revokeObjectURL(url); }
}

function matchesSearch(order, query) {
  const text = `${order.name} ${order.phone} ${orderLabel(order)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return text.includes(query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

function orderInfo(order) {
  const info = node("div", "row-info");
  info.append(node("strong", "", `${orderLabel(order)} · ${order.name}`));
  info.append(node("p", "", order.campaignName || state.campaigns.find(c => c.id === order.campaign)?.name || order.campaign));
  info.append(node("p", "", `${numbersLabel(order.numbers)} · ${displayTotal(order)}`));
  if (isCancelledOrder(order)) info.append(node("p", "notice warning", "Montar Rifa cancelada · conferir devolução manual dos valores pagos."));
  return info;
}

function isCancelledOrder(order) {
  return Boolean(state.campaigns.find(campaign => campaign.id === order.campaign)?.cancellation);
}

function renderPending() {
  const status = expiredView ? "expired" : "reserved";
  const all = state.reservations.filter(r => statusOf(r) === status && !isCancelledOrder(r));
  const rows = all.filter(r => matchesSearch(r, $("reservationSearch").value));
  selectedReservations = new Set([...selectedReservations].filter(id => rows.some(r => r.id === id)));
  $("pendingTitle").textContent = `${expiredView ? "Reservas Expiradas" : "Reservas Pendentes"} (${all.length})`;
  $("showPending").setAttribute("aria-pressed", String(!expiredView));
  $("showExpired").setAttribute("aria-pressed", String(expiredView));
  $("showPending").className = `button ${expiredView ? "secondary" : "soft-blue"}`;
  $("showExpired").className = `button ${expiredView ? "soft-blue" : "secondary"}`;
  $("reservationList").replaceChildren();
  if (!rows.length) empty($("reservationList"), "Nenhuma reserva encontrada nesta lista.");
  rows.forEach(order => {
    const row = node("div", "list-row"), input = node("input"), info = orderInfo(order);
    input.type = "checkbox";
    input.checked = selectedReservations.has(order.id);
    input.setAttribute("aria-label", `Selecionar pedido ${orderLabel(order)} de ${order.name}`);
    input.addEventListener("change", () => {
      input.checked ? selectedReservations.add(order.id) : selectedReservations.delete(order.id);
      updateSelectionSummary();
    });
    info.append(node("p", "", `Celular: ${order.phone} · Prazo: ${new Date(order.expires).toLocaleString("pt-BR")}`));
    info.append(tag(order));
    row.append(input, info);
    $("reservationList").append(row);
  });
  $("confirmPayment").hidden = expiredView;
  updateSelectionSummary();
}

function updateSelectionSummary() {
  $("selectedReservations").textContent = `${selectedReservations.size} reserva(s) selecionada(s)`;
  $("confirmPayment").disabled = selectedReservations.size === 0;
  $("cancelReservation").disabled = selectedReservations.size === 0;
}

async function downloadReceipt(order) {
  await loadState();
  order = currentOrder(order.id);
  const campaignCancellation = state.campaigns.find(campaign => campaign.id === order.campaign)?.cancellation;
  const url = URL.createObjectURL(new Blob([receiptPDF({ ...order, campaignCancellation }, state.settings.organizer, { manual: Boolean(server) })], { type: "application/pdf" }));
  const anchor = node("a");
  anchor.href = url;
  anchor.download = `recibo-${server ? "manual" : "demonstrativo"}-${order.orderNumber || order.id.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderReceipts() {
  const rows = state.reservations.filter(r => r.status === "sold" && matchesSearch(r, $("receiptSearch").value));
  $("receiptList").replaceChildren();
  if (!rows.length) { empty($("receiptList"), server ? "Nenhum recibo. Confira o recebimento e confirme o pagamento manualmente no painel." : "Nenhum recibo. Confirme uma reserva de teste no painel para gerar um PDF demonstrativo."); return; }
  rows.forEach(order => {
    const row = node("div", "list-row"), button = node("button", "button soft-blue", "PDF ↓");
    button.setAttribute("aria-label", serverText(`Baixar recibo demonstrativo do pedido ${orderLabel(order)}`));
    button.addEventListener("click", safe(() => downloadReceipt(order)));
    row.append(orderInfo(order), button);
    $("receiptList").append(row);
  });
}

function showReceiptReminder(orders) {
  $("receiptReminderList").replaceChildren(...orders.map(order => {
    const row = node("div", "list-row"), info = orderInfo(order);
    info.append(node("p", "", `WhatsApp do cliente: ${order.phone}`));
    const button = node("button", "button soft-blue wide", server ? "Baixar recibo de confirmação manual (PDF)" : "Baixar recibo demonstrativo (PDF)");
    button.setAttribute("aria-label", `Baixar recibo do pedido ${orderLabel(order)} de ${order.name}`);
    button.addEventListener("click", safe(() => downloadReceipt(order)));
    info.append(button);
    row.append(info);
    return row;
  }));
  $("receiptReminderDialog").showModal();
}

function renderSettings() {
  $("settingPix").value = state.settings.pixKey;
  $("settingOrganizer").value = state.settings.organizer;
  $("settingPhone").value = state.settings.phone;
  $("settingRules").value = state.settings.rules;
  $("settingMessage").value = state.settings.message;
  $("settingHours").value = state.settings.hours;
}

function renderMyOrders() {
  $("myOrders").replaceChildren();
  const orders = server ? state.reservations.filter(order => state.ownOrderIds.includes(order.id)) : state.reservations;
  if (!orders.length) { empty($("myOrders"), "Nenhuma reserva criada neste navegador."); return; }
  [...orders].reverse().forEach(order => {
    const row = node("div", "list-row"), info = orderInfo(order);
    info.append(tag(order), link("Ver status", `status/${encodeURIComponent(order.id)}`, "button soft-blue wide"));
    row.append(info);
    $("myOrders").append(row);
  });
}

on("menuToggle", "click", () => {
  $("appMenu").hidden = !$("appMenu").hidden;
  $("menuToggle").setAttribute("aria-expanded", String(!$("appMenu").hidden));
});
on("continueReservation", "click", () => go("reserva", route.id));
on("reserveForm", "submit", async event => {
  event.preventDefault();
  await loadState();
  const campaign = currentCampaign();
  assertCampaignActive(campaign);
  if (!reservationOffer || reservationOffer.campaignId !== campaign.id || selectedCampaignId !== campaign.id) {
    throw new Error("Volte à seleção de números antes de confirmar a reserva.");
  }
  if (reservationOffer.price !== campaign.price || reservationOffer.hours !== state.settings.hours) {
    renderReservation();
    throw new Error("O valor ou o prazo mudou em outra aba. Confira o novo total e prazo antes de confirmar novamente.");
  }
  let record;
  if (server) {
    reservationRequestId ??= crypto.randomUUID();
    const result = await command("reserve", {
      campaignId: campaign.id, numbers: [...chosen], name: $("customerName").value,
      phone: $("customerPhone").value, expectedPrice: reservationOffer.price,
      expectedHours: reservationOffer.hours, requestId: reservationRequestId
    });
    record = result.order;
    if (!record?.id) throw new Error("O servidor não informou o pedido criado. Consulte Minhas reservas antes de tentar novamente.");
  } else {
    record = makeReservation({
      campaign, numbers: [...chosen], name: $("customerName").value, phone: $("customerPhone").value,
      records: state.reservations, hours: state.settings.hours, id: crypto.randomUUID()
    });
    persist(KEYS.reservations, [...state.reservations, record]);
  }
  reservationRequestId = null;
  chosen.clear();
  reservationOffer = null;
  $("reserveForm").reset();
  go("pagamento", record.id);
});
on("copyPix", "click", async () => {
  try { await navigator.clipboard.writeText(server ? state.settings.pixKey : `DEMO-${state.settings.pixKey}`); }
  catch (error) { throw new Error("Não foi possível copiar. Selecione o identificador de demonstração e copie manualmente.", { cause: error }); }
  notify(server ? "Chave Pix copiada. Confira o recebedor e o valor no seu banco antes de transferir." : "Identificador de teste copiado. Não é uma chave válida de pagamento.");
});
on("previewWhatsApp", "click", () => {
  const order = currentOrder();
  if (isCancelledOrder(order)) throw new Error("Montar Rifa cancelada. Não solicite pagamentos; confira a devolução manual com o organizador.");
  const values = { pedido: orderLabel(order), campanha: order.campaignName || order.campaign, rifa: order.campaignName || order.campaign, numeros: numbersLabel(order.numbers), valor: displayTotal(order) };
  const contact = `${state.settings.organizer}${state.settings.phone ? ` · ${state.settings.phone}` : server ? " · Telefone não informado" : " · Telefone de teste não informado"}`;
  $("whatsAppPreview").textContent = `${server ? "PRÉVIA — ENVIO MANUAL" : "SIMULAÇÃO — NÃO REALIZE PAGAMENTOS"}\nDestinatário: ${contact}\n\n${state.settings.message.replace(/\{(pedido|campanha|rifa|numeros|valor)\}/g, (_, key) => values[key])}`;
  $("messageDialog").showModal();
});
on("closeDialog", "click", () => $("messageDialog").close());
on("closeReceiptReminder", "click", () => $("receiptReminderDialog").close());
on("openReminderReceipts", "click", () => {
  $("receiptReminderDialog").close();
  go("recibos");
});
on("closeCancelCampaign", "click", () => $("cancelCampaignDialog").close());
on("cancelCampaignForm", "submit", async event => {
  event.preventDefault();
  $("cancelCampaignError").hidden = true;
  if (!$("refundAcknowledged").checked) throw new Error("Confirme que os valores pagos devem ser devolvidos manualmente.");
  await loadState();
  const next = cancelCampaign(state.campaigns, cancellingCampaignId, $("cancellationReason").value);
  if (server) await command("campaign-cancel", { id: cancellingCampaignId, reason: $("cancellationReason").value, refundAcknowledged: true });
  else { persist(KEYS.campaigns, next); state.campaigns = next; }
  if (selectedCampaignId === cancellingCampaignId) { chosen.clear(); selectedCampaignId = null; }
  $("cancelCampaignDialog").close();
  renderDashboard();
  notify("Montar Rifa cancelada e histórico preservado. Comunique os clientes e providencie a devolução manual dos valores pagos.");
});
on("statusReceipt", "click", () => downloadReceipt(currentOrder()));
on("showPassword", "click", () => {
  const show = $("loginPassword").type === "password";
  $("loginPassword").type = show ? "text" : "password";
  $("showPassword").setAttribute("aria-label", server ? (show ? "Ocultar senha" : "Mostrar senha") : (show ? "Ocultar senha de teste" : "Mostrar senha de teste"));
  $("showPassword").setAttribute("aria-pressed", String(show));
});
on("loginForm", "submit", async event => {
  event.preventDefault();
  if (server) {
    await command("login", { user: $("loginUser").value.trim(), password: $("loginPassword").value });
    $("loginForm").reset();
    go("painel");
    return;
  }
  if ($("loginUser").value.trim() !== "tatem" || $("loginPassword").value !== "demo") {
    throw new Error("Este login é simulado. Use o usuário tatem e a senha demo; não use credenciais reais.");
  }
  adminMode = true;
  $("loginForm").reset();
  go("painel");
});
on("logout", "click", async () => {
  if (server) await command("logout");
  if (server) clearAdminViews();
  adminMode = false;
  go("admin-login");
});
on("passwordForm", "submit", async event => {
  event.preventDefault();
  if (!server) throw new Error("A alteração de senha requer a versão instalada no servidor.");
  if ($("newPassword").value !== $("repeatPassword").value) throw new Error("As novas senhas não coincidem.");
  await command("password-change", { currentPassword: $("currentPassword").value, password: $("newPassword").value });
  $("passwordForm").reset();
  notify("Senha alterada. Entre novamente com a nova senha.");
});
on("campaignCoverFile", "change", async () => {
  const file = $("campaignCoverFile").files[0], id = editorId;
  $("clearCoverFile").hidden = !file;
  if (!file) { showCoverPreview($("removeCover").checked ? "" : state.campaigns.find(c => c.id === id)?.cover || ""); return; }
  $("removeCover").checked = false;
  const cover = await readCover(file);
  if (route.screen === "nova-campanha" && id === editorId && $("campaignCoverFile").files[0] === file) showCoverPreview(cover);
});
on("clearCoverFile", "click", () => {
  $("campaignCoverFile").value = "";
  $("clearCoverFile").hidden = true;
  showCoverPreview($("removeCover").checked ? "" : state.campaigns.find(c => c.id === editorId)?.cover || "");
  notify("Arquivo selecionado removido do formulário. A capa já salva não foi excluída.");
});
on("removeCover", "change", () => {
  if ($("removeCover").checked) {
    $("campaignCoverFile").value = "";
    $("clearCoverFile").hidden = true;
    showCoverPreview("");
  }
  else if (!$("campaignCoverFile").files.length) showCoverPreview(state.campaigns.find(c => c.id === editorId)?.cover || "");
});
on("campaignForm", "submit", async event => {
  event.preventDefault();
  if ($("campaignFields").disabled) return;
  const id = editorId || crypto.randomUUID();
  const file = $("campaignCoverFile").files[0], removing = $("removeCover").checked;
  if (file && removing) throw new Error("Desmarque a opção de remover a capa para enviar uma nova imagem.");
  const updated = {
    id, name: $("campaignName").value.trim(), prize: $("campaignPrize").value.trim(),
    desc: $("campaignDescription").value.trim(), count: $("campaignCount").valueAsNumber,
    price: $("campaignPrice").valueAsNumber, date: $("campaignDate").value,
    minimum: $("campaignMinimum").valueAsNumber
  };
  validateCampaign(updated);
  $("campaignFields").disabled = true;
  try {
    const uploaded = file ? await readCover(file) : null;
    await loadState();
    const previous = state.campaigns.find(c => c.id === id);
    if (editorId && !previous) throw new Error("Esta Montar Rifa foi excluída em outra aba. Volte ao painel; as alterações não foram salvas.");
    if (previous) assertCampaignActive(previous);
    assertCampaignPrice(previous, updated, state.reservations);
    if (previous && isCampaignPriceLocked(previous, state.reservations)) updated.priceLocked = true;
    updated.cover = removing ? "" : uploaded ?? previous?.cover ?? "";
    validateCampaign(updated);
    assertCampaignCapacity(updated, state.reservations, now());
    const next = previous ? state.campaigns.map(c => c.id === id ? updated : c) : [...state.campaigns, updated];
    if (server) await command("campaign-save", { campaign: updated, create: !editorId });
    else persist(KEYS.campaigns, next);
    if (selectedCampaignId === id) chosen.clear();
    go("painel");
    notify("Montar Rifa e capa salvas neste navegador. Use Ver Montar Rifa no menu para participar.");
  } finally { $("campaignFields").disabled = false; }
});
on("reservationSearch", "input", renderPending);
on("showPending", "click", async () => { await loadState(); expiredView = false; selectedReservations.clear(); renderPending(); });
on("showExpired", "click", async () => { await loadState(); expiredView = true; selectedReservations.clear(); renderPending(); });
on("confirmPayment", "click", async () => {
  if (server && !confirm("Você conferiu o recebimento no banco? Confirmar registra o pagamento manualmente; o aplicativo não verifica transferências.")) return;
  await loadState();
  if (state.reservations.some(order => selectedReservations.has(order.id) && isCancelledOrder(order))) {
    throw new Error("Não é possível confirmar pagamentos de uma Montar Rifa cancelada. Confira a devolução manual dos valores recebidos.");
  }
  const next = updateReservations(state.reservations, selectedReservations, "sold", now());
  if (server) await command("orders-update", { ids: [...selectedReservations], status: "sold" });
  else { persist(KEYS.reservations, next); state.reservations = next; }
  const confirmedOrders = state.reservations.filter(order => selectedReservations.has(order.id));
  selectedReservations.clear();
  renderPending();
  notify(server ? "Confirmação manual registrada. Baixe e envie o recibo ao cliente." : "Pagamento confirmado apenas na simulação local. O recibo demonstrativo está disponível em Recibos (PDF).");
  showReceiptReminder(confirmedOrders);
});
on("cancelReservation", "click", async () => {
  if (!selectedReservations.size) throw new Error("Selecione uma reserva para cancelar.");
  if (!confirm(server ? "Cancelar as reservas selecionadas e liberar os números? Confira e devolva manualmente eventuais transferências." : "Cancelar as reservas selecionadas e liberar os números? Esta ação é local.")) return;
  await loadState();
  const next = updateReservations(state.reservations, selectedReservations, "cancelled", now());
  if (server) await command("orders-update", { ids: [...selectedReservations], status: "cancelled" });
  else { persist(KEYS.reservations, next); state.reservations = next; }
  selectedReservations.clear();
  renderPending();
  notify(server ? "Reservas canceladas. Os números foram liberados; nenhuma devolução foi executada." : "Reservas de teste canceladas. Os números foram liberados.");
});
on("receiptSearch", "input", renderReceipts);
on("settingsForm", "submit", async event => {
  event.preventDefault();
  const settings = validateSettings({
    pixKey: $("settingPix").value.trim(), organizer: $("settingOrganizer").value.trim(),
    phone: $("settingPhone").value.replace(/\D/g, ""), rules: $("settingRules").value.trim(),
    message: $("settingMessage").value.trim(), hours: $("settingHours").valueAsNumber
  });
  if (server) await command("settings-save", { settings });
  else { persist(KEYS.settings, settings); state.settings = settings; }
  notify("Configurações salvas neste navegador. O novo prazo só vale para novas reservas.");
});
on("resetReservations", "click", async () => {
  if (server) throw new Error("O histórico de reservas e recibos não pode ser apagado na versão com banco de dados.");
  await loadState();
  if (state.reservations.some(order => isCancelledOrder(order))) {
    throw new Error("Não é possível limpar o histórico: há pedidos de Montar Rifa canceladas que precisam ser preservados para conferir devoluções.");
  }
  if (!confirm("Excluir TODAS as reservas e recibos locais? Montar Rifa, capas, configurações e bloqueios de valor serão mantidos.")) return;
  await loadState();
  const campaigns = preserveCampaignPriceLocks(state.campaigns, state.reservations);
  persist(KEYS.campaigns, campaigns);
  state.campaigns = campaigns;
  persist(KEYS.reservations, []);
  state.reservations = [];
  selectedReservations.clear();
  chosen.clear();
  renderDashboard();
  notify("Reservas e recibos de teste removidos. Montar Rifa, configurações e bloqueios de valor foram mantidos.");
});

window.addEventListener("hashchange", safe(render, false));
window.addEventListener("storage", safe(async event => {
  if (server) return;
  if (!Object.values(KEYS).includes(event.key) && event.key !== null) return;
  await loadState();
  if (["nova-campanha", "configuracoes", "reserva"].includes(route.screen)) {
    if (route.screen === "nova-campanha") updateCampaignPriceLock(state.campaigns.find(c => c.id === editorId));
    notify("Os dados mudaram em outra aba. O formulário foi mantido; confira as alterações antes de salvar.");
    return;
  }
  await render();
  notify("Dados atualizados a partir de outra aba deste navegador.");
}, false));
setInterval(() => {
  if (!state) return;
  if (!["numeros", "reservas", "painel", "status", "pagamento"].includes(route.screen)) return;
  safe(async () => {
    if (server?.pending) return;
    await loadState();
    if (adminScreens.has(route.screen) && !adminMode) { await render(); return; }
    if (route.screen === "numeros") renderNumbers();
    if (route.screen === "reservas") renderPending();
    if (route.screen === "painel") renderDashboard();
    if (route.screen === "status") renderStatus();
    if (route.screen === "pagamento") renderPayment();
  }, false)();
}, 30000);
if (server) {
  $("resetReservations").hidden = true;
  $("passwordSection").hidden = false;
  $("loginUser").autocomplete = "username";
  $("loginPassword").autocomplete = "current-password";
  $("loginUser").removeAttribute("placeholder");
  $("loginPassword").removeAttribute("placeholder");
}
on("customerName", "input", () => { reservationRequestId = null; });
on("customerPhone", "input", () => { reservationRequestId = null; });
safe(render)();
