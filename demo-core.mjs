export const KEYS = {
  campaigns: "rifadotatem-lab-campaigns-v1",
  reservations: "rifadotatem-lab-v1",
  settings: "rifadotatem-lab-settings-v1"
};

export const defaultCampaigns = [
  { id: "pesca", name: "Pescaria do Tatem", desc: "Uma pescaria com o Tatem. Campanha de demonstração.", prize: "Pescaria com o Tatem", price: 50, date: "", count: 100, minimum: 50, cover: "" },
  { id: "especial", name: "Campanha Especial", desc: "Segunda campanha de exemplo para testar a jornada.", prize: "Kit de pesca demonstrativo", price: 40, date: "", count: 50, minimum: 50, cover: "" }
];

export const defaultSettings = {
  pixKey: "CHAVE-DE-TESTE",
  organizer: "Tatem",
  phone: "",
  rules: "Sorteio demonstrativo, condicionado ao mínimo de vendas configurado na campanha. Nenhuma compra real é registrada.",
  message: "Olá! Esta é uma simulação de envio de comprovante do pedido {pedido}, campanha {campanha}, números {numeros}, total {valor}. Não realize pagamentos.",
  hours: 24
};

export const money = value => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const displayDate = value => value ? value.split("-").reverse().join("/") : "A definir";
export const orderLabel = record => record.orderNumber ? `#${record.orderNumber}` : `#${record.id}`;
export const displayTotal = record => Number.isFinite(record.total) ? money(record.total) : "Não registrado (reserva antiga)";
export const numbersLabel = numbers => numbers.map(n => String(n).padStart(2, "0")).join(", ");
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export function validateCoverFile(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      !Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_COVER_BYTES) {
    throw new Error("Escolha uma imagem PNG, JPEG ou WebP de até 10 MB.");
  }
}

function validDate(value) {
  return value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}

export function validateCampaign(campaign) {
  if (!campaign || typeof campaign.id !== "string" || !campaign.id ||
      typeof campaign.name !== "string" || !campaign.name.trim() || campaign.name.length > 80 ||
      typeof campaign.prize !== "string" || !campaign.prize.trim() || campaign.prize.length > 160 ||
      typeof campaign.desc !== "string" || campaign.desc.length > 300 ||
      !Number.isFinite(campaign.price) || campaign.price < 0.01 || campaign.price > 1000000 ||
      Math.abs(campaign.price * 100 - Math.round(campaign.price * 100)) > 0.000001 ||
      !Number.isInteger(campaign.count) || campaign.count < 1 || campaign.count > 1000 ||
      typeof campaign.date !== "string" || !validDate(campaign.date) ||
      (campaign.cancellation !== undefined && (!campaign.cancellation ||
        typeof campaign.cancellation.reason !== "string" || !campaign.cancellation.reason.trim() ||
        campaign.cancellation.reason.length > 1000 || !Number.isFinite(campaign.cancellation.created))) ||
      (campaign.priceLocked !== undefined && typeof campaign.priceLocked !== "boolean") ||
      (campaign.minimum !== undefined && (!Number.isInteger(campaign.minimum) || campaign.minimum < 0 || campaign.minimum > 100)) ||
      (campaign.cover !== undefined && campaign.cover !== "" &&
        (typeof campaign.cover !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(campaign.cover)))) {
    throw new Error("Campanha inválida. Informe nome, prêmio, valor com até duas casas decimais, 1 a 1000 números e uma data válida ou vazia.");
  }
  return campaign;
}

export function validateCampaigns(rows) {
  if (!Array.isArray(rows)) throw new Error("O cadastro local de campanhas está inválido.");
  rows.forEach(validateCampaign);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Existem campanhas com identificadores repetidos.");
  return rows;
}

export function validateReservations(rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string" ||
      typeof row.campaign !== "string" || typeof row.name !== "string" || typeof row.phone !== "string" ||
      !Array.isArray(row.numbers) || !row.numbers.length ||
      row.numbers.some(n => !Number.isInteger(n) || n < 1 || n > 1000) ||
      new Set(row.numbers).size !== row.numbers.length ||
      !["reserved", "sold", "cancelled"].includes(row.status) ||
      !Number.isFinite(row.created) || !Number.isFinite(row.expires) ||
      (row.total !== undefined && (!Number.isFinite(row.total) || row.total < 0)) ||
      (row.orderNumber !== undefined && !/^\d{6,}$/.test(row.orderNumber))) ||
      new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error("O cadastro local de reservas está inválido. Os dados não foram apagados.");
  }
  return rows;
}

export function validateSettings(settings) {
  if (!settings || typeof settings.organizer !== "string" || !settings.organizer.trim() ||
      typeof settings.pixKey !== "string" || !settings.pixKey.trim() ||
      typeof settings.phone !== "string" || !/^\d{0,15}$/.test(settings.phone) ||
      typeof settings.rules !== "string" || !settings.rules.trim() ||
      typeof settings.message !== "string" || !settings.message.trim() ||
      !Number.isInteger(settings.hours) || settings.hours < 1 || settings.hours > 168) {
    throw new Error("Preencha as configurações e informe um prazo inteiro de 1 a 168 horas.");
  }
  return settings;
}

export function statusOf(record, now = Date.now()) {
  if (record.status === "reserved" && record.expires <= now) return "expired";
  return record.status;
}

export function occupiedNumbers(records, campaignId, now = Date.now()) {
  const taken = new Map();
  records.filter(row => row.campaign === campaignId && ["reserved", "sold"].includes(statusOf(row, now)))
    .forEach(row => row.numbers.forEach(n => taken.set(n, row.status)));
  return taken;
}

export function campaignPaymentSummary(campaignId, records) {
  const confirmed = records.filter(record => record.campaign === campaignId && record.status === "sold");
  const knownAmounts = confirmed.filter(record => Number.isFinite(record.total));
  const amountCents = knownAmounts.reduce((sum, record) => sum + Math.round(record.total * 100), 0);
  return {
    count: confirmed.length,
    knownAmountCount: knownAmounts.length,
    amountCents,
    knownAmount: amountCents / 100,
    unknownAmountCount: confirmed.length - knownAmounts.length
  };
}

export function assertCampaignCapacity(campaign, records, now = Date.now()) {
  if ([...occupiedNumbers(records, campaign.id, now).keys()].some(n => n > campaign.count)) {
    throw new Error("Não é possível reduzir a quantidade: existem números reservados ou confirmados acima desse limite.");
  }
}

export function campaignProgress(campaign, records, now = Date.now()) {
  const taken = occupiedNumbers(records, campaign.id, now);
  const confirmed = [...taken.values()].filter(status => status === "sold").length;
  const reserved = taken.size - confirmed;
  const minimumPercent = campaign.minimum ?? 50;
  const minimum = Math.ceil(campaign.count * minimumPercent / 100);
  return {
    confirmed, reserved, available: campaign.count - taken.size,
    remaining: campaign.count - confirmed,
    percent: confirmed * 100 / campaign.count,
    minimumPercent, minimum, remainingToMinimum: Math.max(0, minimum - confirmed)
  };
}

export function isCampaignPriceLocked(campaign, records) {
  return campaign.priceLocked === true || records.some(record => record.campaign === campaign.id);
}

export function deleteCampaign(campaigns, campaignId, records) {
  const campaign = campaigns.find(item => item.id === campaignId);
  if (!campaign) throw new Error("Campanha não encontrada. Atualize o painel antes de excluir.");
  if (campaign.cancellation || isCampaignPriceLocked(campaign, records)) {
    throw new Error("Não é possível excluir: esta campanha já recebeu reservas, mesmo que tenham expirado, sido canceladas ou removidas da lista de testes.");
  }
  return campaigns.filter(item => item.id !== campaignId);
}

export function assertCampaignActive(campaign) {
  if (campaign.cancellation) throw new Error("Esta campanha foi cancelada. Não é possível reservar, cobrar ou confirmar novos pagamentos.");
}

export function cancelCampaign(campaigns, campaignId, reason, now = Date.now()) {
  const campaign = campaigns.find(item => item.id === campaignId);
  if (!campaign) throw new Error("Campanha não encontrada.");
  assertCampaignActive(campaign);
  reason = reason.trim();
  if (!reason || reason.length > 1000) throw new Error("Informe a justificativa do cancelamento, com até 1000 caracteres.");
  return campaigns.map(item => item.id === campaignId
    ? { ...item, cancellation: { reason, created: now } }
    : item);
}

export function assertCampaignPrice(previous, updated, records) {
  if (previous && isCampaignPriceLocked(previous, records) && previous.price !== updated.price) {
    throw new Error("O valor por número está bloqueado desde a primeira reserva, mesmo que ela expire ou seja cancelada. Para usar outro valor, cadastre uma nova campanha.");
  }
}

export function preserveCampaignPriceLocks(campaigns, records) {
  return campaigns.map(campaign => isCampaignPriceLocked(campaign, records) ? { ...campaign, priceLocked: true } : campaign);
}

export function makeReservation({ campaign, numbers, name, phone, records, hours, id, now = Date.now() }) {
  validateCampaign(campaign);
  assertCampaignActive(campaign);
  name = name.trim();
  phone = phone.replace(/\D/g, "");
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (!name || name.length > 80 || phone.length < 10 || phone.length > 15 ||
      !unique.length || unique.some(n => !Number.isInteger(n) || n < 1 || n > campaign.count) ||
      !Number.isInteger(hours) || hours < 1 || hours > 168 || typeof id !== "string" || !id) {
    throw new Error("Selecione números válidos e informe nome e celular válidos para o teste.");
  }
  const taken = occupiedNumbers(records, campaign.id, now);
  if (unique.some(n => taken.has(n))) throw new Error("Alguns números não estão mais disponíveis. Volte à seleção e escolha outros.");
  const sequence = records.reduce((max, row) => Math.max(max, Number(row.orderNumber) || 0), 0) + 1;
  return {
    id, orderNumber: String(sequence).padStart(6, "0"),
    campaign: campaign.id, campaignName: campaign.name, prize: campaign.prize,
    unitPrice: campaign.price, total: Math.round(unique.length * campaign.price * 100) / 100,
    numbers: unique, name, phone, status: "reserved", created: now, expires: now + hours * 3600000
  };
}

export function updateReservations(records, ids, action, now = Date.now()) {
  if (!ids.size || !["sold", "cancelled"].includes(action)) throw new Error("Selecione pelo menos uma reserva.");
  const selected = records.filter(record => ids.has(record.id));
  if (selected.length !== ids.size || selected.some(record =>
    action === "sold" ? statusOf(record, now) !== "reserved" : !["reserved", "expired"].includes(statusOf(record, now)))) {
    throw new Error("A seleção contém reservas expiradas ou já processadas. Atualize a seleção antes de continuar.");
  }
  return records.map(record => ids.has(record.id) ? {
    ...record, status: action, ...(action === "sold" ? { confirmed: now } : {})
  } : record);
}

export function receiptPDF(record, organizer) {
  if (record.status !== "sold") throw new Error("O recibo demonstrativo só está disponível após a confirmação simulada.");
  const plain = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const wrap = value => {
    const text = plain(value);
    return text.match(/.{1,78}/g) || [""];
  };
  const lines = [
    "RIFA DO TATEM - RECIBO DEMONSTRATIVO",
    "SEM VALOR FISCAL OU COMPROVACAO DE PAGAMENTO REAL",
    `Pedido: ${orderLabel(record)}`, `Organizador: ${organizer}`,
    `Participante: ${record.name}`, `Celular: ${record.phone}`,
    `Campanha: ${record.campaignName || record.campaign}`, `Premio: ${record.prize || "Nao registrado"}`,
    `Numeros: ${numbersLabel(record.numbers)}`, `Total simulado: ${displayTotal(record)}`,
    `Data: ${new Date(record.confirmed || record.created).toLocaleString("pt-BR")}`,
    "Dados locais deste navegador. Nenhuma compra real foi registrada."
  ].flatMap(wrap);
  if (record.campaignCancellation) {
    lines.unshift(...[
      "CAMPANHA CANCELADA - NAO VALIDO PARA PARTICIPACAO",
      `Justificativa: ${record.campaignCancellation.reason}`,
      "Devolucao manual dos valores pagos deve ser providenciada.",
      "Este documento NAO comprova que houve reembolso."
    ].flatMap(wrap));
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += 38) pages.push(lines.slice(i, i + 38));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const kids = [];
  pages.forEach(page => {
    const pageId = objects.length + 1, contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const escape = value => value.replace(/([\\()])/g, "\\$1");
    const stream = `BT /F1 11 Tf 45 795 Td 18 TL ${page.map(line => `(${escape(line)}) Tj T*`).join("\n")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
