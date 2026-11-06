import {
  KEYS, defaultCampaigns, defaultSettings, money, displayDate, orderLabel, displayTotal, numbersLabel,
  validateCampaign, validateCampaigns, validateReservations, validateSettings,
  statusOf, occupiedNumbers, assertCampaignCapacity, isCampaignPriceLocked, assertCampaignPrice,
  preserveCampaignPriceLocks, makeReservation, updateReservations, receiptPDF, validateCoverFile
} from "./demo-core.mjs";

const $ = id => document.getElementById(id);
const adminScreens = new Set(["painel", "nova-campanha", "reservas", "recibos", "configuracoes"]);
const statusNames = { reserved: "Aguardando confirmação", sold: "Confirmado (simulado)", expired: "Reserva expirada", cancelled: "Reserva cancelada" };
let state, route = { screen: "inicio", id: "" }, adminMode = false, editorId = null;
let selectedCampaignId = null, chosen = new Set(), selectedReservations = new Set(), expiredView = false;
let reservationOffer = null;

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
  $("appMessage").textContent = text;
  $("appMessage").hidden = false;
}

function report(error) {
  console.error("Rifa do Tatem — demonstração:", error);
  $("appError").textContent = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
  $("appError").hidden = false;
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

function loadState() {
  state = {
    campaigns: read(KEYS.campaigns, defaultCampaigns, validateCampaigns),
    reservations: read(KEYS.reservations, [], validateReservations),
    settings: read(KEYS.settings, defaultSettings, validateSettings)
  };
}

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) {
    throw new Error("Não foi possível salvar. O armazenamento pode estar cheio ou bloqueado. Seus dados anteriores foram mantidos; tente uma capa menor ou verifique o navegador.", { cause: error });
  }
}

function go(screen, id = "") {
  const hash = `#${screen}${id ? `/${encodeURIComponent(id)}` : ""}`;
  $("appError").hidden = true;
  $("appMessage").hidden = true;
  if (location.hash === hash) render();
  else location.hash = hash;
}

function currentCampaign(id = route.id) {
  const campaign = state.campaigns.find(item => item.id === id);
  if (!campaign) throw new Error("Campanha não encontrada neste navegador. Abra o menu e escolha uma campanha disponível.");
  return campaign;
}

function currentOrder(id = route.id) {
  const order = state.reservations.find(item => item.id === id);
  if (!order) throw new Error("Reserva não encontrada neste navegador. Abra o menu e consulte suas reservas locais.");
  return order;
}

function setScreen(screen) {
  document.querySelectorAll("[data-screen]").forEach(section => { section.hidden = section.dataset.screen !== screen; });
  $("appMenu").hidden = true;
  $("menuToggle").setAttribute("aria-expanded", "false");
}

function render() {
  $("appError").hidden = true;
  loadState();
  const [screen = "inicio", id = ""] = location.hash.slice(1).split("/");
  route = { screen: screen || "inicio", id: decodeURIComponent(id) };
  if (adminScreens.has(route.screen) && !adminMode) {
    go("admin-login");
    notify("Entre com tatem / demo para abrir a simulação administrativa. Isto não é autenticação real.");
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
      $("showPassword").setAttribute("aria-label", "Mostrar senha de teste");
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
    image.alt = `Capa da campanha ${campaign.name}`;
    wrapper.append(image);
  } else {
    const image = node("img", "sample-cover");
    image.src = "assets/pescaria-campanha.png";
    image.alt = "Barco ao pôr do sol, imagem ilustrativa do storyboard";
    wrapper.append(image, node("p", "cover-note", "Imagem ilustrativa · envie a capa da campanha no painel"));
  }
  return wrapper;
}

function renderCampaigns() {
  const list = $("campaignList");
  list.replaceChildren();
  state.campaigns.forEach(campaign => {
    const card = node("article", "campaign-card"), body = node("div", "card-body");
    const sold = [...occupiedNumbers(state.reservations, campaign.id).values()].filter(status => status === "sold").length;
    body.append(node("h2", "", campaign.name), node("p", "small", campaign.desc), node("p", "small", `Prêmio: ${campaign.prize}`));
    const facts = node("div", "facts");
    facts.append(node("strong", "", `▧ ${campaign.count} números`), node("strong", "", `Sorteio: ${displayDate(campaign.date)}`));
    facts.append(node("span", "", `${campaign.count - occupiedNumbers(state.reservations, campaign.id).size} disponíveis · ${sold} confirmados`));
    body.append(facts, node("strong", "price", `${money(campaign.price)} por número`), link("Participar", `numeros/${encodeURIComponent(campaign.id)}`));
    const rules = node("details", "rules");
    rules.append(node("summary", "", "Regras e condições da demonstração"), node("p", "", `Condição mínima de vendas: ${campaign.minimum ?? 50}%. ${state.settings.rules}`));
    body.append(rules);
    card.append(campaignCover(campaign), body);
    list.append(card);
  });
}

function renderNumbers() {
  const campaign = currentCampaign();
  if (selectedCampaignId !== campaign.id) { chosen.clear(); selectedCampaignId = campaign.id; }
  const taken = occupiedNumbers(state.reservations, campaign.id);
  chosen = new Set([...chosen].filter(n => n <= campaign.count && !taken.has(n)));
  $("numberCampaign").textContent = campaign.name;
  $("numbers").replaceChildren();
  for (let n = 1; n <= campaign.count; n++) {
    const status = taken.get(n) || (chosen.has(n) ? "selected" : "available");
    const button = node("button", `number ${status}`, String(n).padStart(2, "0"));
    button.type = "button";
    button.disabled = taken.has(n);
    button.setAttribute("aria-label", `Número ${n}, ${status === "selected" ? "selecionado" : status === "available" ? "disponível" : status === "sold" ? "vendido (simulado)" : "reservado"}`);
    button.setAttribute("aria-pressed", String(chosen.has(n)));
    button.addEventListener("click", safe(() => {
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
  if (selectedCampaignId !== campaign.id || !chosen.size) {
    go("numeros", campaign.id);
    notify("Selecione os números antes de confirmar a reserva.");
    return;
  }
  $("reservationDeadline").textContent = `Seus números ficarão reservados por ${state.settings.hours} hora(s), aguardando confirmação simulada do Tatem.`;
  $("chosenNumbers").replaceChildren(...[...chosen].sort((a, b) => a - b).map(n => node("span", "chip", String(n).padStart(2, "0"))));
  $("reservationTotal").textContent = money(Math.round(chosen.size * campaign.price * 100) / 100);
  reservationOffer = { campaignId: campaign.id, price: campaign.price, hours: state.settings.hours };
}

function renderPayment() {
  const order = currentOrder();
  if (statusOf(order) !== "reserved") { go("status", order.id); return; }
  $("pixKey").textContent = `DEMO-${state.settings.pixKey}`;
  $("pixReceiver").textContent = state.settings.organizer;
  $("paymentTotal").textContent = displayTotal(order);
  $("paymentOrder").textContent = `Pedido ${orderLabel(order)} · Teste local`;
  $("openStatus").href = `#status/${encodeURIComponent(order.id)}`;
}

function tag(order) {
  const status = statusOf(order);
  return node("span", `status-tag ${status}`, statusNames[status]);
}

function renderStatus() {
  const order = currentOrder(), status = statusOf(order);
  const root = $("statusContent"), hero = node("div", "status-hero");
  const titles = { reserved: "Reserva concluída!", sold: "Participação confirmada!", expired: "Prazo da reserva encerrado", cancelled: "Reserva cancelada" };
  hero.append(node("span", "status-icon", status === "sold" || status === "reserved" ? "✓" : "◷"), node("h2", "", titles[status]), node("strong", "", `Pedido ${orderLabel(order)}`));
  const details = node("dl", "status-details");
  const fields = [
    ["Campanha", order.campaignName || state.campaigns.find(c => c.id === order.campaign)?.name || order.campaign],
    ["Participante de teste", order.name], ["Números", numbersLabel(order.numbers)],
    ["Valor total simulado", displayTotal(order)], ["Prazo", new Date(order.expires).toLocaleString("pt-BR")]
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
  root.replaceChildren(hero, details, tag(order), node("p", `notice ${status === "sold" ? "success" : "warning"}`, notes[status]));
  if (status === "reserved") root.append(link("Ver instruções de Pix simulado", `pagamento/${encodeURIComponent(order.id)}`, "button soft-blue wide"));
  $("statusReceipt").hidden = status !== "sold";
}

function renderDashboard() {
  const pending = state.reservations.filter(r => statusOf(r) === "reserved");
  const sales = state.reservations.filter(r => r.status === "sold");
  const revenue = sales.reduce((sum, r) => sum + (r.total ?? 0), 0);
  const stats = [
    ["▧", "Campanhas", `${state.campaigns.length} ativas`],
    ["♧", "Reservas", `${pending.length} pendentes`],
    ["✓", "Vendas simuladas", `${sales.reduce((sum, r) => sum + r.numbers.length, 0)} números`],
    ["＄", "Receita simulada", money(revenue)]
  ];
  $("dashboardStats").replaceChildren(...stats.map(([icon, label, value]) => {
    const stat = node("div", "stat");
    stat.append(node("span", "stat-icon", icon), node("span", "", label), node("strong", "", value));
    if (label === "Receita simulada" && sales.some(r => r.total === undefined)) stat.append(node("small", "", "Não inclui reservas antigas sem valor registrado."));
    return stat;
  }));
  $("pendingBadge").textContent = String(pending.length);
  $("adminCampaigns").replaceChildren(...state.campaigns.map(campaign => {
    const row = node("div", "list-row"), info = node("div", "row-info");
    info.append(node("strong", "", campaign.name), node("p", "", `${campaign.prize} · ${money(campaign.price)} · ${campaign.count} números`));
    if (isCampaignPriceLocked(campaign, state.reservations)) info.append(node("p", "muted", "Valor bloqueado: esta campanha já recebeu uma reserva."));
    row.append(info, link("Editar", `nova-campanha/${encodeURIComponent(campaign.id)}`, "button secondary"));
    return row;
  }));
}

function renderCampaignForm() {
  editorId = route.id || null;
  const campaign = editorId ? currentCampaign(editorId) : null;
  $("campaignForm").reset();
  $("campaignFields").disabled = false;
  $("campaignFormTitle").textContent = campaign ? "Editar Campanha" : "Nova Campanha";
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
    ? "Valor bloqueado desde a primeira reserva, mesmo após expiração ou cancelamento. Para outro valor, crie uma nova campanha."
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
  return info;
}

function renderPending() {
  const status = expiredView ? "expired" : "reserved";
  const all = state.reservations.filter(r => statusOf(r) === status);
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

function downloadReceipt(order) {
  const url = URL.createObjectURL(new Blob([receiptPDF(order, state.settings.organizer)], { type: "application/pdf" }));
  const anchor = node("a");
  anchor.href = url;
  anchor.download = `recibo-demonstrativo-${order.orderNumber || order.id.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderReceipts() {
  const rows = state.reservations.filter(r => r.status === "sold" && matchesSearch(r, $("receiptSearch").value));
  $("receiptList").replaceChildren();
  if (!rows.length) { empty($("receiptList"), "Nenhum recibo. Confirme uma reserva de teste no painel para gerar um PDF demonstrativo."); return; }
  rows.forEach(order => {
    const row = node("div", "list-row"), button = node("button", "button soft-blue", "PDF ↓");
    button.setAttribute("aria-label", `Baixar recibo demonstrativo do pedido ${orderLabel(order)}`);
    button.addEventListener("click", safe(() => downloadReceipt(order)));
    row.append(orderInfo(order), button);
    $("receiptList").append(row);
  });
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
  if (!state.reservations.length) { empty($("myOrders"), "Nenhuma reserva criada neste navegador."); return; }
  [...state.reservations].reverse().forEach(order => {
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
on("reserveForm", "submit", event => {
  event.preventDefault();
  loadState();
  const campaign = currentCampaign();
  if (!reservationOffer || reservationOffer.campaignId !== campaign.id || selectedCampaignId !== campaign.id) {
    throw new Error("Volte à seleção de números antes de confirmar a reserva.");
  }
  if (reservationOffer.price !== campaign.price || reservationOffer.hours !== state.settings.hours) {
    renderReservation();
    throw new Error("O valor ou o prazo mudou em outra aba. Confira o novo total e prazo antes de confirmar novamente.");
  }
  const record = makeReservation({
    campaign, numbers: [...chosen], name: $("customerName").value, phone: $("customerPhone").value,
    records: state.reservations, hours: state.settings.hours, id: crypto.randomUUID()
  });
  persist(KEYS.reservations, [...state.reservations, record]);
  chosen.clear();
  reservationOffer = null;
  $("reserveForm").reset();
  go("pagamento", record.id);
});
on("copyPix", "click", async () => {
  try { await navigator.clipboard.writeText(`DEMO-${state.settings.pixKey}`); }
  catch (error) { throw new Error("Não foi possível copiar. Selecione o identificador de demonstração e copie manualmente.", { cause: error }); }
  notify("Identificador de teste copiado. Não é uma chave válida de pagamento.");
});
on("previewWhatsApp", "click", () => {
  const order = currentOrder();
  const values = { pedido: orderLabel(order), campanha: order.campaignName || order.campaign, numeros: numbersLabel(order.numbers), valor: displayTotal(order) };
  const contact = `${state.settings.organizer}${state.settings.phone ? ` · ${state.settings.phone}` : " · Telefone de teste não informado"}`;
  $("whatsAppPreview").textContent = `SIMULAÇÃO — NÃO REALIZE PAGAMENTOS\nDestinatário de teste: ${contact}\n\n${state.settings.message.replace(/\{(pedido|campanha|numeros|valor)\}/g, (_, key) => values[key])}`;
  $("messageDialog").showModal();
});
on("closeDialog", "click", () => $("messageDialog").close());
on("statusReceipt", "click", () => downloadReceipt(currentOrder()));
on("showPassword", "click", () => {
  const show = $("loginPassword").type === "password";
  $("loginPassword").type = show ? "text" : "password";
  $("showPassword").setAttribute("aria-label", show ? "Ocultar senha de teste" : "Mostrar senha de teste");
  $("showPassword").setAttribute("aria-pressed", String(show));
});
on("loginForm", "submit", event => {
  event.preventDefault();
  if ($("loginUser").value.trim() !== "tatem" || $("loginPassword").value !== "demo") {
    throw new Error("Este login é simulado. Use o usuário tatem e a senha demo; não use credenciais reais.");
  }
  adminMode = true;
  $("loginForm").reset();
  go("painel");
});
on("logout", "click", () => { adminMode = false; go("admin-login"); });
on("campaignCoverFile", "change", async () => {
  const file = $("campaignCoverFile").files[0], id = editorId;
  if (!file) { showCoverPreview(state.campaigns.find(c => c.id === id)?.cover || ""); return; }
  const cover = await readCover(file);
  if (route.screen === "nova-campanha" && id === editorId && $("campaignCoverFile").files[0] === file) showCoverPreview(cover);
});
on("removeCover", "change", () => {
  if ($("removeCover").checked) showCoverPreview("");
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
    loadState();
    const previous = state.campaigns.find(c => c.id === id);
    assertCampaignPrice(previous, updated, state.reservations);
    if (previous && isCampaignPriceLocked(previous, state.reservations)) updated.priceLocked = true;
    updated.cover = removing ? "" : uploaded ?? previous?.cover ?? "";
    validateCampaign(updated);
    assertCampaignCapacity(updated, state.reservations);
    const next = previous ? state.campaigns.map(c => c.id === id ? updated : c) : [...state.campaigns, updated];
    persist(KEYS.campaigns, next);
    if (selectedCampaignId === id) chosen.clear();
    go("painel");
    notify("Campanha e capa salvas neste navegador. Use Ver campanhas no menu para participar.");
  } finally { $("campaignFields").disabled = false; }
});
on("reservationSearch", "input", renderPending);
on("showPending", "click", () => { loadState(); expiredView = false; selectedReservations.clear(); renderPending(); });
on("showExpired", "click", () => { loadState(); expiredView = true; selectedReservations.clear(); renderPending(); });
on("confirmPayment", "click", () => {
  loadState();
  const next = updateReservations(state.reservations, selectedReservations, "sold");
  persist(KEYS.reservations, next);
  state.reservations = next;
  selectedReservations.clear();
  renderPending();
  notify("Pagamento confirmado apenas na simulação local. O recibo demonstrativo está disponível em Recibos (PDF).");
});
on("cancelReservation", "click", () => {
  if (!selectedReservations.size) throw new Error("Selecione uma reserva para cancelar.");
  if (!confirm("Cancelar as reservas selecionadas e liberar os números? Esta ação é local.")) return;
  loadState();
  const next = updateReservations(state.reservations, selectedReservations, "cancelled");
  persist(KEYS.reservations, next);
  state.reservations = next;
  selectedReservations.clear();
  renderPending();
  notify("Reservas de teste canceladas. Os números foram liberados.");
});
on("receiptSearch", "input", renderReceipts);
on("settingsForm", "submit", event => {
  event.preventDefault();
  const settings = validateSettings({
    pixKey: $("settingPix").value.trim(), organizer: $("settingOrganizer").value.trim(),
    phone: $("settingPhone").value.replace(/\D/g, ""), rules: $("settingRules").value.trim(),
    message: $("settingMessage").value.trim(), hours: $("settingHours").valueAsNumber
  });
  persist(KEYS.settings, settings);
  state.settings = settings;
  notify("Configurações salvas neste navegador. O novo prazo só vale para novas reservas.");
});
on("resetReservations", "click", () => {
  if (!confirm("Excluir TODAS as reservas e recibos locais? Campanhas, capas, configurações e bloqueios de valor serão mantidos.")) return;
  loadState();
  const campaigns = preserveCampaignPriceLocks(state.campaigns, state.reservations);
  persist(KEYS.campaigns, campaigns);
  state.campaigns = campaigns;
  persist(KEYS.reservations, []);
  state.reservations = [];
  selectedReservations.clear();
  chosen.clear();
  renderDashboard();
  notify("Reservas e recibos de teste removidos. Campanhas, configurações e bloqueios de valor foram mantidos.");
});

window.addEventListener("hashchange", safe(render, false));
window.addEventListener("storage", safe(event => {
  if (!Object.values(KEYS).includes(event.key) && event.key !== null) return;
  loadState();
  if (["nova-campanha", "configuracoes", "reserva"].includes(route.screen)) {
    if (route.screen === "nova-campanha") updateCampaignPriceLock(state.campaigns.find(c => c.id === editorId));
    notify("Os dados mudaram em outra aba. O formulário foi mantido; confira as alterações antes de salvar.");
    return;
  }
  render();
  notify("Dados atualizados a partir de outra aba deste navegador.");
}, false));
setInterval(() => {
  if (!state) return;
  if (!["numeros", "reservas", "painel", "status", "pagamento"].includes(route.screen)) return;
  safe(() => {
    loadState();
    if (route.screen === "numeros") renderNumbers();
    if (route.screen === "reservas") renderPending();
    if (route.screen === "painel") renderDashboard();
    if (route.screen === "status") renderStatus();
    if (route.screen === "pagamento") renderPayment();
  }, false)();
}, 30000);
safe(render)();
