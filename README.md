# Rifa do Tatem — demonstração do storyboard

Demonstração responsiva em azul e amarelo das 12 telas definidas no storyboard fornecido. HTML, CSS e JavaScript, sem dependências de execução ou etapa de build.

**Não usar com participantes reais:** dados apenas no navegador, login simulado, sem backend, cobrança Pix, envio de WhatsApp, sorteio automático ou autenticação real. Recibos PDF são demonstrativos, sem valor fiscal ou comprovação de pagamento.

## Acessar e publicar

- Aplicativo: `https://rogerio3921.github.io/Rifadotatem/` (abre `teste.html`).
- O endereço antigo `https://rogerio3921.github.io/Rifadotatem/teste.html` continua funcionando.
- Em **Settings > Pages**, selecionar **GitHub Actions**. O workflow **Deploy to GitHub Pages** publica automaticamente alterações da `main`; também pode ser iniciado com **Run workflow**.
- Para abrir localmente: `python -m http.server 8765`, depois acessar `http://localhost:8765/`. Não abrir por `file://`, pois a aplicação usa módulos JavaScript.

## Jornada do participante

1. **Tela inicial:** apresentação e botão Ver Campanhas.
2. **Campanhas ativas:** capa, prêmio, valor, quantidade, data e regras.
3. **Seleção de números:** múltipla seleção, legenda e total.
4. **Confirmar reserva:** nome e celular fictícios; prazo configurável, inicialmente 24 horas.
5. **Pix simulado:** identificador sempre prefixado com `DEMO-`, copiar identificador e prévia de mensagem para WhatsApp. Não há QR Code, transferência ou envio de mensagens.
6. **Status:** pedido, números, total, prazo e confirmação local. Após confirmar no painel, permite baixar recibo demonstrativo.

O menu inclui **Minhas reservas locais** para consultar pedidos após recarregar. Todos os pedidos deste navegador são visíveis, sem identificação de usuário.

## Jornada administrativa

1. **Login de demonstração:** usuário `tatem`, senha `demo`. É apenas navegação simulada, não uma barreira de segurança. Ao recarregar, é necessário entrar novamente; credenciais não são armazenadas.
2. **Painel de controle:** campanhas, reservas pendentes, números confirmados e receita simulada; atalhos e edição de campanhas.
   **Excluir campanha** pede confirmação e só permite apagar campanhas que nunca receberam reservas. Reservas pendentes, confirmadas, expiradas ou canceladas impedem a exclusão, inclusive após limpar o histórico de testes. A capa é removida junto com a campanha. É possível excluir a última campanha; a lista vazia não recria os exemplos, e novas campanhas podem ser cadastradas normalmente.
   **Cancelar campanha** exige justificativa e ciência de que os valores pagos devem ser devolvidos. O cancelamento é definitivo nesta demonstração: retira a campanha da lista pública, bloqueia edição, novas reservas e confirmações de pagamento, mas preserva os pedidos, valores e recibos originais. O painel mostra a justificativa, data e clientes com pagamentos confirmados, contatos e valores para conferir e devolver manualmente. Valores de reservas antigas sem preço continuam como não registrados.
   Não há envio automático de avisos, execução de reembolsos ou registro de devolução como concluída. Também é preciso conferir transferências ainda não confirmadas no aplicativo. A tela de status informa o cancelamento e os PDFs preservados passam a indicar que a campanha foi cancelada, sem comprovar reembolso. O histórico de campanhas canceladas não pode ser apagado por **Limpar reservas de teste**. A receita geral preserva valores históricos sem presumir devoluções.
   Cada campanha mostra confirmados, números reservados aguardando pagamento, disponíveis, faltantes para vender todos e barra de progresso dos confirmados. O mínimo para o sorteio é calculado com arredondamento para cima (por exemplo, 50% de 101 exige 51 confirmações). Reservas pendentes não atingem metas; expiradas e canceladas voltam a ficar disponíveis. Atingir o mínimo ou vender todos não executa sorteio nem encerra a campanha automaticamente. Os indicadores do topo continuam sendo o resumo geral.
3. **Nova campanha / edição:** título, prêmio, descrição, 1 a 1000 números, valor, data opcional, percentual mínimo para o sorteio e capa. Não há execução de sorteio.
4. **Reservas pendentes:** busca por nome, celular ou pedido, seleção múltipla, confirmação simulada, cancelamento e lista de expiradas.
   Após salvar a confirmação, um pop-up lembra o administrador de enviar o recibo manualmente. Mostra todos os pedidos confirmados nessa ação, nome e telefone dos clientes, download individual do PDF e acesso à tela de recibos. Baixar ou fechar o aviso não significa que houve envio; não existe envio automático ou registro de entrega.
5. **Recibos:** busca e download de PDF demonstrativo para reservas confirmadas.
6. **Configurações:** identificador Pix de teste, organizador, telefone de teste, regras, mensagem e prazo de 1 a 168 horas.

### Capas

Enviar PNG, JPEG ou WebP de até 10 MB (10 × 1024 × 1024 bytes) por arquivo. Antes de salvar, a capa é otimizada: até 1600 pixels no maior lado, compressão WebP e redução adicional se necessário, limitando a representação armazenada a 700.000 caracteres. O arquivo original não é preservado. Essa otimização não aumenta a quota total do navegador; muitas capas ainda podem esgotar o armazenamento local, com aviso explícito de falha.

Na edição, deixar o arquivo vazio mantém a capa; escolher outro arquivo substitui a imagem; **Remover a capa atual** exclui a capa enviada. Sem capa, aparece uma imagem ilustrativa identificada como exemplo. Capas já salvas permanecem inalteradas; a otimização ocorre ao enviar uma imagem.

**Cancelar arquivo selecionado** limpa o arquivo escolhido antes de salvar e restaura a prévia da capa já cadastrada, se existir. Para excluir uma capa já salva, marcar **Remover a capa atual** e salvar a campanha.

A tela inicial usa `assets/foto-tatem.jpeg`, imagem fornecida pelo usuário, exibida inteira e sem recorte. A capa de exemplo das campanhas (`assets/pescaria-campanha.png`) é um recorte ilustrativo do storyboard. Capas cadastradas nas campanhas não são alteradas pela atualização da foto inicial.

### Persistência e compatibilidade

- Campanhas e capas: `rifadotatem-lab-campaigns-v1`.
- Reservas: `rifadotatem-lab-v1`.
- Configurações: `rifadotatem-lab-settings-v1`.
- Campanhas e reservas das versões anteriores são preservadas. Reservas antigas sem preço gravado mostram **Não registrado**, não são incluídas na receita e não recebem valores históricos inventados.
- Novos pedidos guardam nome da campanha, prêmio, preço e total do momento da reserva. Editar a campanha não muda esses dados nos pedidos existentes.
- O valor por número só pode ser editado antes da primeira reserva. Depois, o campo fica bloqueado, inclusive se a reserva expirar ou for cancelada; demais campos continuam editáveis conforme suas validações. Para cobrar outro valor, cadastre uma nova campanha. A regra também se aplica a campanhas com reservas antigas, sem recalcular pedidos ou quantidades.
- Se preço ou prazo mudar em outra aba durante a confirmação, a tela exige conferir os novos dados antes de reservar.
- O novo prazo só vale para reservas futuras. Reservas expiradas permanecem no histórico, liberam os números e não podem ser confirmadas. Cancelamentos também liberam os números.
- Não é possível reduzir a quantidade abaixo de números com reservas ativas ou confirmações. A condição mínima é informativa, sem sorteio automático.
- Outras abas da mesma origem podem ver os mesmos dados. Outros celulares, navegadores ou perfis não podem. Limpar os dados do site remove os cadastros.
- **Limpar reservas de teste** apaga reservas e recibos, mas mantém campanhas, capas, configurações e bloqueios de valor. Antes de excluir o histórico, o bloqueio é preservado no cadastro da campanha.
- Falhas de leitura ou gravação são exibidas, sem apagar dados ou anunciar sucesso. Falta de espaço pode exigir uma imagem menor; formulários são preservados na falha.

## Verificação

Executar os testes de regras de negócio com `node --test tests/demo-core.test.mjs`. O workflow também executa esses testes e verifica a sintaxe antes de publicar. As jornadas visuais devem ser abertas pelo servidor HTTP local.
