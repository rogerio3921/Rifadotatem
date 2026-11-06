# Rifa do Tatem — demonstração

Projeto de testes do aplicativo Rifa do Tatem.

## Publicação

1. Em Settings > Pages, selecionar **GitHub Actions** como fonte da publicação.
2. Em Actions > Deploy to GitHub Pages, selecionar **Run workflow** na branch `main`. Alterações enviadas à `main` também iniciam a publicação automaticamente.
3. Aguardar o deploy e acessar `https://rogerio3921.github.io/Rifadotatem/` para a página informativa ou `https://rogerio3921.github.io/Rifadotatem/teste.html` para a demonstração interativa.

## Painel de demonstração

Em `teste.html`, clicar em **Painel simulado**:

- Em **Nova campanha**, informar nome, prêmio, descrição opcional, valor por número, quantidade de números (1 a 1000) e data opcional do sorteio. É possível enviar uma **imagem de capa** PNG, JPEG ou WebP de até 1 MB por campanha.
- Clicar em **Cadastrar campanha** e em **Voltar para participante** para selecionar a campanha e testar reservas.
- Usar **Editar campanha** para alterar os dados. A quantidade não pode ser reduzida abaixo de números com reservas ativas ou confirmações.
- A capa aparece na visão do participante e permanece após recarregar. Na edição, manter o campo de arquivo vazio preserva a capa; selecionar outra imagem a substitui, e **Remover a capa atual** a exclui.
- Confirmar ou excluir reservas na seção **Reservas no navegador**. **Limpar reservas de teste** mantém as campanhas cadastradas.

Campanhas e reservas permanecem após recarregar a página no mesmo navegador. Não aparecem em outros celulares ou navegadores e podem ser perdidas ao limpar os dados do site. As campanhas de exemplo e as reservas antigas são preservadas ao atualizar a demonstração.

Imagens usam o espaço limitado do armazenamento local. Se não houver espaço ou o navegador bloquear o armazenamento, o painel informa a falha e mantém o formulário para tentar novamente com uma imagem menor.

**Atenção:** demonstração apenas, dados no armazenamento local do navegador; sem autenticação, pagamentos reais ou banco de dados compartilhado.
