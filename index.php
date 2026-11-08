<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'");

$html = file_get_contents(__DIR__ . '/teste.html');
if ($html === false) {
    http_response_code(500);
    echo 'Não foi possível abrir o aplicativo.';
    exit;
}
echo strtr($html, [
    '<body>' => '<body data-server="true">',
    'Demonstração local das jornadas de participante e administrador de Pescaria com o Tatem.' => 'Pescaria com o Tatem: reservas e acompanhamento, com confirmação manual pelo organizador.',
    'Pescaria com o Tatem — demonstração' => 'Pescaria com o Tatem',
    '<strong>DEMONSTRAÇÃO LOCAL</strong> · Sem pagamentos reais · Dados somente neste navegador' => '<strong>CONFIRMAÇÃO MANUAL</strong> · Sem integração bancária · Nenhum sorteio automático',
    'Minhas reservas locais' => 'Minhas reservas',
    'Painel simulado' => 'Área administrativa',
    'Explore as Montar Rifa e experimente a jornada completa, sem compras ou pagamentos reais.' => 'Veja as Montar Rifa disponíveis, escolha seus números e acompanhe sua reserva.',
    'Área administrativa · simulação' => 'Área administrativa',
    'Escolha uma Montar Rifa para participar da simulação.' => 'Escolha uma Montar Rifa para consultar os números disponíveis.',
    'Valor total simulado' => 'Valor total',
    'Use dados fictícios. Não envie dinheiro ou comprovantes: esta é apenas uma demonstração.' => 'Seu nome e celular serão utilizados pelo organizador para acompanhar a reserva e entrar em contato. Confira as regras antes de reservar.',
    '<strong>SIMULAÇÃO — NÃO PAGUE.</strong> Não há QR Code ou chave de pagamento válida nesta demonstração.' => '<strong>PAGAMENTO MANUAL.</strong> Confira no seu banco o nome do recebedor e o valor antes de transferir. Não há consulta automática ao Pix.',
    '<strong>Instruções de teste</strong><p>Veja como será a etapa de pagamento, sem realizar uma transferência.</p>' => '<strong>Instruções de pagamento</strong><p>Use a chave abaixo no aplicativo do seu banco. Envie o comprovante ao organizador pelo canal combinado e aguarde a conferência manual.</p>',
    'Identificador Pix de demonstração' => 'Chave Pix',
    'Copiar identificador Pix de demonstração' => 'Copiar chave Pix',
    'Nome do recebedor (teste)' => 'Nome do recebedor informado pelo organizador',
    'Baixar recibo demonstrativo (PDF)' => 'Baixar recibo de confirmação manual (PDF)',
    '<strong>Login simulado, sem proteção real.</strong> Use <b>tatem</b> e <b>demo</b>. Não informe senhas reais.' => 'Acesso exclusivo do administrador. Utilize o usuário e a senha definidos na instalação.',
    'Usuário de teste' => 'Usuário',
    'Senha de teste' => 'Senha',
    'Mostrar senha de teste' => 'Mostrar senha',
    'Entrar na simulação' => 'Entrar',
    'Visão geral dos dados locais · sem autenticação real.' => 'Dados compartilhados · acesso administrativo protegido por sessão.',
    'Sair da simulação administrativa' => 'Sair da administração',
    'antes de salvar neste navegador' => 'antes de salvar no servidor',
    'Montar Rifa e imagem salvas somente neste navegador. Não há sorteio automático nem operação real.' => 'Montar Rifa e imagem salvas no banco compartilhado. Não há sorteio automático. A regularidade da operação deve ser verificada antes da divulgação e cobrança.',
    'Confirmar pagamento simulado' => 'Confirmar pagamento manualmente',
    'A confirmação é apenas uma mudança de status local. Nenhum pagamento é consultado.' => 'Confirme somente após conferir o recebimento no banco. O aplicativo registra sua decisão e não consulta transferências nem executa devoluções.',
    'PDFs demonstrativos, sem valor fiscal ou comprovação de pagamento real.' => 'PDFs de confirmação manual do organizador, sem valor fiscal e sem verificação bancária automática.',
    'Chave Pix de teste' => 'Chave Pix',
    'Identificador de demonstração' => 'Chave informada pelo organizador',
    'Sempre exibido e copiado com o prefixo DEMO- para não ser uma chave válida de pagamento.' => 'Informe a chave e o recebedor corretos. Não há integração bancária, QR Code ou confirmação automática.',
    'Telefone de teste' => 'Telefone de contato',
    'Salvar configurações locais' => 'Salvar configurações',
    'Mostra os pedidos criados neste navegador. Não há identificação de usuário.' => 'Mostra suas reservas por meio de um identificador protegido neste navegador. Para consultar em outro dispositivo, contate o organizador. Limpar os cookies remove seu acesso, mas não apaga os pedidos do banco.',
    'Pescaria com o Tatem · Protótipo do storyboard<br>Sem banco compartilhado, login real ou pagamentos.' => 'Pescaria com o Tatem<br>Confirmação e envio de recibos manuais · Sem integração bancária.<br>O aplicativo não substitui autorizações exigidas para a operação.',
    'Simulação: nenhuma mensagem ou comprovante será enviado.' => 'Nenhuma mensagem ou comprovante será enviado automaticamente.',
    'Nesta demonstração, os PDFs são de teste e não comprovam um pagamento real.' => 'Os PDFs registram a confirmação manual do organizador; não são documentos fiscais nem verificações bancárias.',
]);
