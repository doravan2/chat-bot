# Plano de Implementação: Filtro Anti-Duplicidade Inteligente de 8 Horas por Grupo Destino [CONCLUÍDO]

## Diagnóstico do Problema (Imagens 1 e 2)
Nas imagens enviadas:
- **Imagem 2 (03:13:35)**: Grupo fonte *LIPE INDICA* enviou para o destino *Teste 2*:
  - Produto: `Suporte Articulado Para 2 Monitores 13 a 32 Pistão a Gás Zinnia Nimbo 210 Branco`
  - Link: `https://s.shopee.com.br/7kxrXG52rr`
- **Imagem 1 (03:18:24)**: Grupo fonte *MARIU* enviou para o mesmo destino *Teste 2*:
  - Produto: `Suporte Articulado Para 2 Monitores 13 a 32 Pistão a Gás Zinnia Nimbo 210 Preto,ZNO-ZNNB0210-BK01-V2`
  - Link: `https://s.shopee.com.br/1qcuzVupZm`

### Causa Raiz Identificada
1. **Links Curtos Distintos**: Cada grupo gerou um link encurtado próprio (`7kxrXG52rr` vs `1qcuzVupZm`), apontando para o mesmo produto na Shopee.
2. **Variações no Título ("Branco" vs "Preto")**: Uma simples palavra de cor ou código de modelo fez com que o sistema anterior não reconhecesse a duplicidade.
3. **Escopo entre Grupos Fontes**: Faltava um escopo unificado de bloqueio por Grupo Destino (8 horas) que interceptasse ofertas vindas de origens diferentes.

---

## Implementação Concluída

### 1. Resolução Canônica do ID Real do Produto (`server.ts`)
- **Shopee**: Extração direta do `item_id` real (`shp_${item_id}`) a partir da URL descompactada (`/product/`, `-i.`, `itemid=`, universal links) e dos metadados HTML (`og:url`, `canonical`, `"itemid":`, `"itemId":`). Produtos com variações de cor/modelo compartilham o mesmo `item_id`, garantindo detecção imediata.
- **Mercado Livre**: Extração de `MLB` numérico canônico a partir do link descompactado ou tags estruturadas.
- **Amazon**: Extração do código `ASIN` de 10 dígitos.
- **AliExpress**: Extração do `productId` numérico.

### 2. Comparador Semântico de Títulos e Remoção de Variações
- **Remoção de Códigos de Modelo**: Expressões como `ZNO-ZNNB0210-BK01-V2` são removidas antes da tokenização para não gerar falsas diferenças.
- **Stopwords de Variação**: Cores (`branco`, `preto`, `azul`, etc.), voltagens (`110v`, `220v`, `bivolt`) e especificações de variação são desconsideradas na comparação de identidade.
- **Algoritmo de Similaridade**: Sobreposição $\ge 70\%$ entre os termos essenciais classifica os anúncios como o mesmo produto, bloqueando o envio repetido.

### 3. Bloqueio Estrito de 8 Horas por Grupo Destino
- **Chave de Destino Unificada**: O sistema cruza os identificadores do grupo destino (`destinationRoomId`, `destinationJid`, `roomCode`), garantindo que se o Grupo A já mandou o produto para *Teste 2*, o Grupo B não poderá mandar o mesmo produto para *Teste 2* dentro da janela de 8 horas.
- **Supressão de Envio & Alerta Limpo**: Mensagens repetidas são descartadas sem poluir o WhatsApp/Telegram e sem gerar falsos alertas de erro.
- **Monitor de Escuta**: Registra o evento como `REPETIDA (BLOQUEADA PELO ANTI-DUPLICIDADE)` exibindo o motivo e há quanto tempo o produto original foi enviado.
- **Persistência em Disco**: O cache de 8 horas é salvo em `.engine_dispatched_offers.json` e integrado com o `.engine_history.json`, resistindo a reinicializações.

---

## Verificação & Validação
- **TypeScript**: `npm run lint` validado com zero erros de tipo (`tsc --noEmit`).
- **Build**: `compile_applet` executado com sucesso total.
- **Servidor Dev**: Dev server reiniciado e operando com as novas regras ativas.
