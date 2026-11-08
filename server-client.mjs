export class ServerClient {
  constructor(url = "./api/index.php") {
    this.url = url;
    this.csrf = "";
    this.pending = false;
    this.sequence = 0;
  }

  async request(payload) {
    const sequence = ++this.sequence;
    let response;
    try {
      response = await fetch(this.url, {
        method: payload ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: payload ? { "Content-Type": "application/json", "X-CSRF-Token": this.csrf } : {},
        ...(payload ? { body: JSON.stringify(payload) } : {})
      });
    } catch (cause) {
      throw new Error("Falha de conexão com o servidor. Consulte o status da reserva antes de repetir uma operação; a resposta pode não ter chegado.", { cause });
    }
    let result;
    try { result = await response.json(); }
    catch (cause) {
      throw new Error("O servidor não retornou uma resposta válida. Verifique a instalação PHP e tente novamente.", { cause });
    }
    if (!response.ok) {
      const error = new Error(result.error || "Não foi possível concluir a operação no servidor.");
      error.status = response.status;
      throw error;
    }
    if (!Array.isArray(result.campaigns) || !Array.isArray(result.reservations) ||
        !Array.isArray(result.occupancy) || !Array.isArray(result.ownOrderIds) ||
        typeof result.admin !== "boolean" || typeof result.csrf !== "string" || !result.csrf ||
        !Number.isFinite(result.serverNow) || !result.settings) {
      throw new Error("Os dados recebidos do servidor estão incompletos. Nenhum dado local foi usado como substituição.");
    }
    if (sequence === this.sequence) this.csrf = result.csrf;
    return result;
  }

  async mutate(action, fields = {}) {
    if (this.pending) throw new Error("Aguarde a operação anterior terminar antes de continuar.");
    this.pending = true;
    try { return await this.request({ action, ...fields }); }
    finally { this.pending = false; }
  }
}
