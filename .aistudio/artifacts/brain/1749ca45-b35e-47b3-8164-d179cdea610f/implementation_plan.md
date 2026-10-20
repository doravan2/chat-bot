# Plano de Correção: Eliminação de Erros Intermitentes em Envios com Origem Telegram

## Diagnóstico da Causa Raiz
Quando a fonte é um grupo ou canal do **Telegram**, o polling do Telegram frequentemente recebe múltiplos posts simultâneos (`data.result`). O servidor tentava disparar todas as mensagens quase no mesmo milissegundo para o grupo de destino no WhatsApp via Baileys socket.
Isso causava:
1. **Sobrecarga no Socket do WhatsApp**: Envio concorrente de mídias/mensagens fazia o WhatsApp disparar erro de rede/timeout momentâneo (`Falha ao entregar no grupo destino`).
2. **Ausência de Retry Automático**: O sistema gravava o erro imediatamente no Histórico em vez de tentar novamente após 1 segundo. Ao clicar em "Tentar Novamente", como o canal estava desobstruído, o envio funcionava de primeira.
3. **Bloqueio por Timeout em APIs de Afiliados**: Quando o Mercado Livre ou outra API demorava mais de 3-4 segundos para encurtar o link, o sistema abortava em vez de usar imediatamente o link comissionado direto (`fallback.convertedUrl` com a tag de afiliado do usuário).
4. **Links Ocultos em Entidades do Telegram**: Posts com links no formato `[Compre Aqui](url)` ou em botões inline não tinham a URL concatenada no texto principal.

---

## Modificações Propostas

### 1. Fila de Despacho com Intervalo Seguro (Anti-Sobrecarga)
- Em `server.ts`, implementar fila sequencial (`dispatchQueue`) com intervalo mínimo de 1,2 a 1,8 segundos entre envios para o WhatsApp.
- Evita que uma rajada de posts do Telegram sature o socket do WhatsApp ou provoque desconexão temporária.

### 2. Fallback Imediato para Link Comissionado Direto
- Se a API de encurtamento do Mercado Livre, Shopee ou AliExpress oscilar ou demorar mais de 3 segundos, utilizar imediatamente o link comissionado oficial direto gerado localmente com as credenciais do usuário (`fallback.convertedUrl` contendo a tag de afiliado).
- Garante que a comissão do usuário seja sempre preservada sem travar o disparo do produto.

### 3. Retry Automático Transparente no Servidor
- Se o WhatsApp ou a rede falhar na primeira tentativa de entrega, o servidor executará automaticamente até 2 tentativas com intervalo de 1,5s antes de registrar qualquer falha no Histórico.
- O produto será entregue sozinho sem necessidade de o usuário precisar clicar manualmente em "Tentar Novamente".

### 4. Extração Completa de Links e Mídias do Telegram
- Em `pollTelegramUpdates`, extrair URLs contidas em `post.entities` (`type: "text_link"`), `post.caption_entities` e botões de `reply_markup.inline_keyboard`.
- Concatenar as URLs encontradas ao texto para garantir que nenhuma oferta fique sem o link de afiliado.

---

## Verificação e Testes
1. Validar via `lint_applet` e `compile_applet`.
2. Simular disparo de mensagens rápidas com link de afiliado para garantir entrega sequencial contínua sem erro.
3. Testar a geração de link com fallback comissionado direto em caso de latência de API.
