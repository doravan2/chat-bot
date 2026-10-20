import {
  AffiliateCredentials,
  MarketplaceId,
  ParsedOfferResult,
  ProductVisualPreset,
  ReplicaRules,
} from '../types';

interface UrlMatchInfo {
  fullMatch: string;
  marketplace: MarketplaceId;
  sku: string;
  convertedUrl: string;
}

function hashCodeToSku(input: string, prefix: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const abs = Math.abs(hash).toString().slice(0, 8).padEnd(8, '4');
  return `${prefix}${abs}`;
}

export function buildConvertedUrl(
  rawUrl: string,
  marketplace: MarketplaceId,
  credentials: AffiliateCredentials
): { convertedUrl: string; sku: string } {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    // Always strip competitor hash fragments (e.g. #polycard_client=...&matt_tool_id=...)
    parsed.hash = '';

    if (marketplace === 'mercadoLivre') {
      const mlbMatch = rawUrl.match(/MLB-?\d{6,14}/i);
      const sku = mlbMatch
        ? mlbMatch[0].toUpperCase().replace('-', '')
        : hashCodeToSku(rawUrl, 'MLB');
      const rawTag =
        credentials.mercadoLivre.affiliateTag.trim() ||
        'matt_word=atacadovipofertas&matt_tool=2519981010';
      const cleanTag = rawTag.startsWith('?') ? rawTag.slice(1) : rawTag;

      // Try to extract orguseridp from sessionCookie JSON if available
      let toolId = '2519981010';
      if (credentials.mercadoLivre.sessionCookie) {
        const matchUid = credentials.mercadoLivre.sessionCookie.match(
          /"orguseridp"[\s\S]*?"value"\s*:\s*"(\d+)"/
        );
        if (matchUid && matchUid[1]) {
          toolId = matchUid[1];
        }
      }

      const formattedQuery = cleanTag.includes('=')
        ? cleanTag
        : `matt_word=${encodeURIComponent(cleanTag)}&matt_tool=${encodeURIComponent(
            toolId
          )}&forceInApp=true`;

      if (host.includes('meli.la') || parsed.pathname.startsWith('/sec/')) {
        return {
          sku,
          convertedUrl: `https://www.mercadolivre.com.br/p/${sku}?${formattedQuery}`,
        };
      }

      parsed.search = '';
      const tagParams = new URLSearchParams(formattedQuery);
      tagParams.forEach((val, key) => parsed.searchParams.set(key, val));
      return { sku, convertedUrl: parsed.toString() };
    }

    if (marketplace === 'amazon') {
      const asinMatch = rawUrl.match(/(?:\/dp\/|\/gp\/product\/|\/d\/)([A-Z0-9]{10})/i);
      const sku = asinMatch ? asinMatch[1].toUpperCase() : hashCodeToSku(rawUrl, 'B09X');
      const tag = credentials.amazon.associateTag.trim() || 'atacadovipofe-20';

      if (host.includes('amzn.to') || host.includes('a.co') || asinMatch) {
        return {
          sku,
          convertedUrl: `https://www.amazon.com.br/dp/${sku}?tag=${encodeURIComponent(
            tag
          )}&linkCode=ll1`,
        };
      }

      parsed.search = '';
      parsed.searchParams.set('tag', tag);
      parsed.searchParams.set('linkCode', 'll1');
      return { sku, convertedUrl: parsed.toString() };
    }

    if (marketplace === 'shopee') {
      const sku = hashCodeToSku(rawUrl, 'SHP');
      const appId = credentials.shopee.appId.trim() || '18321500539';

      if (
        host.includes('shope.ee') ||
        host.includes('shp.ee') ||
        host.includes('s.shopee.com.br')
      ) {
        return {
          sku,
          convertedUrl: `https://s.shopee.com.br/an_redir?origin_link=${encodeURIComponent(
            `https://shopee.com.br/product/${sku}`
          )}&affiliate_id=${encodeURIComponent(appId)}`,
        };
      }

      parsed.search = '';
      const cleanOrigin = parsed.toString();
      return {
        sku,
        convertedUrl: `https://s.shopee.com.br/an_redir?origin_link=${encodeURIComponent(
          cleanOrigin
        )}&affiliate_id=${encodeURIComponent(appId)}`,
      };
    }

    if (marketplace === 'aliExpress') {
      const itemMatch =
        rawUrl.match(/\/item\/(\d+)\.html/i) || rawUrl.match(/productIds=(\d+)/i);
      const sku = itemMatch ? itemMatch[1] : hashCodeToSku(rawUrl, '100500');
      const tracking = credentials.aliExpress.trackingId.trim() || 'Atacadovip';
      const appKey = credentials.aliExpress.appKey.trim() || '549522';

      if (host.includes('s.click.aliexpress.com') || host.includes('a.aliexpress.com')) {
        return {
          sku,
          convertedUrl: `https://pt.aliexpress.com/item/${sku}.html?aff_fcid=${encodeURIComponent(
            appKey
          )}&tt=CPS_NORMAL&aff_trace_key=${encodeURIComponent(tracking)}`,
        };
      }

      // Preserve essential product/coin parameters while removing competitor affiliate params
      const productIds = parsed.searchParams.get('productIds');
      const immersiveMode = parsed.searchParams.get('_immersiveMode');
      const fromParam = parsed.searchParams.get('from');
      const isBotDoAfiliado = fromParam?.toLowerCase().includes('bot');

      parsed.search = '';
      if (immersiveMode) parsed.searchParams.set('_immersiveMode', immersiveMode);
      if (fromParam && !isBotDoAfiliado) parsed.searchParams.set('from', fromParam);
      if (productIds) parsed.searchParams.set('productIds', productIds);

      parsed.searchParams.set('aff_fcid', appKey);
      parsed.searchParams.set('tt', 'CPS_NORMAL');
      parsed.searchParams.set('aff_trace_key', tracking);
      return { sku, convertedUrl: parsed.toString() };
    }
  } catch {
    // Fallback if URL parsing fails
  }

  return { sku: 'SKU-1001', convertedUrl: rawUrl };
}

export function detectMarketplaceFromUrl(url: string): MarketplaceId | null {
  const lowerUrl = (url || '').toLowerCase();
  if (
    lowerUrl.includes('meli.la') ||
    lowerUrl.includes('mercadolivre.com') ||
    lowerUrl.includes('mercadolivre.com.br') ||
    lowerUrl.includes('mercadolibre.com')
  ) {
    return 'mercadoLivre';
  }
  if (
    lowerUrl.includes('amzn.to') ||
    lowerUrl.includes('amazon.com') ||
    lowerUrl.includes('a.co/')
  ) {
    return 'amazon';
  }
  if (
    lowerUrl.includes('shope.ee') ||
    lowerUrl.includes('shp.ee') ||
    lowerUrl.includes('shopee.com')
  ) {
    return 'shopee';
  }
  if (lowerUrl.includes('aliexpress.com') || lowerUrl.includes('alix.live')) {
    return 'aliExpress';
  }
  return null;
}

const COMPETITOR_CTA_KEYWORDS = [
  'entre no grupo',
  'entre nos grupos',
  'entre no nosso grupo',
  'entre nos nossos grupos',
  'entre no canal',
  'entre no nosso canal',
  'convite do nosso grupo',
  'convite do grupo',
  'link de convite',
  'convide amigos',
  'convide seus amigos',
  'para o grupo',
  'para o nosso grupo',
  'para os grupos',
  'participe do grupo',
  'participe do nosso grupo',
  'participe dos grupos',
  'participe do canal',
  'acesse o grupo',
  'acesse nosso grupo',
  'acesse nossos grupos',
  'acesse o canal',
  'acesse nosso canal',
  'divulgue nosso canal',
  'divulgue nosso grupo',
  'divulgue o grupo',
  'compartilhe com os amigos',
  'compartilhe com amigos',
  'compartilhe o grupo',
  'compartilhe nosso grupo',
  'compartilhe este grupo',
  'compartilhe o link do grupo',
  'mande para um amigo',
  'envie para um amigo',
  'siga ',
  'siga-nos',
  'nos siga',
  'chame no',
  'dúvidas fale com',
  'duvidas fale com',
  'veja mais ofertas em',
  'mais ofertas em',
  'mais ofertas no grupo',
  'mais ofertas no canal',
  'outras ofertas no',
  'contato adm',
  'fale com o adm',
  'link do grupo',
  'link dos grupos',
  'links dos grupos',
  'link do canal',
  'nossos grupos',
  'nosso grupo vip',
  'grupos de ofertas',
  'grupo de ofertas',
  'garimpeiros',
];

export function isCompetitorCtaLine(line: string): boolean {
  const lowerLine = (line || '').trim().toLowerCase();
  if (!lowerLine) return false;
  return COMPETITOR_CTA_KEYWORDS.some((kw) => lowerLine.includes(kw));
}

export function isCompetitorOrInviteUrl(url: string): boolean {
  if (!url) return false;
  // Never classify an official supported marketplace URL as a competitor invite link
  if (detectMarketplaceFromUrl(url) !== null) {
    return false;
  }

  const lower = url.toLowerCase();

  const knownCompetitorOrSocialPatterns = [
    'chat.whatsapp.com',
    'whatsapp.com/channel',
    'wa.me/',
    'api.whatsapp.com',
    't.me/',
    'telegram.me/',
    'telegram.org',
    'telegram.dog',
    'discord.gg',
    'discord.com',
    'instagram.com',
    'instagr.am',
    'facebook.com',
    'fb.com',
    'youtube.com',
    'youtu.be',
    'tiktok.com',
    'kwai.com',
    'twitter.com',
    'x.com/',
    'threads.net',
    'pinterest.com',
    'linktr.ee',
    'biolink.info',
    'beacons.ai',
    'solo.to',
    'msha.ke',
    'carrd.co',
    'taplink.cc',
    'campsite.bio',
    'direct.me',
    'lnk.bio',
    'bio.site',
    'linkr.bio',
    'allmylinks.com',
    'milkshake.app',
    'stan.store',
    'bento.me',
    'heylink.me',
    'hey.link',
    'mez.ink',
    'linkbio.co',
    'shor.by',
    'garimpeiros',
    'pelando.com.br',
    'promobit.com.br',
    'meugrupo.vip',
    'meugrupo',
    'devzapp',
    'joinzap',
    'gruposwhats',
    'zapgrupos',
    'sendflow',
    'grupozap',
    'clickzap',
    'linkzap',
    'redirecionamento',
  ];

  if (knownCompetitorOrSocialPatterns.some((p) => lower.includes(p))) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();

    if (
      host.startsWith('grupo.') ||
      host.startsWith('grupos.') ||
      host.startsWith('canal.') ||
      host.startsWith('canais.') ||
      host.startsWith('convite.') ||
      host.startsWith('vip.') ||
      host.includes('.grupo.') ||
      host.includes('.grupos.')
    ) {
      return true;
    }

    if (
      /\/(grupo|grupos|convite|convites|canal|canais|whatsapp|telegram|vip|comunidade)(\/|$|\?)/i.test(
        pathAndQuery
      )
    ) {
      return true;
    }
  } catch {
    // ignore URL parse error
  }

  return false;
}

export function detectProductPreset(text: string): ProductVisualPreset {
  const lower = text.toLowerCase();
  if (
    lower.includes('fone') ||
    lower.includes('headphone') ||
    lower.includes('sony') ||
    lower.includes('jbl')
  ) {
    return 'headphones';
  }
  if (
    lower.includes('air fryer') ||
    lower.includes('fritadeira') ||
    lower.includes('cozinha')
  ) {
    return 'airfryer';
  }
  if (
    lower.includes('smartwatch') ||
    lower.includes('relógio') ||
    lower.includes('watch') ||
    lower.includes('xiaomi')
  ) {
    return 'smartwatch';
  }
  return 'espresso';
}

export function parseAndConvertOffer(
  rawText: string,
  credentials: AffiliateCredentials,
  rules: ReplicaRules,
  sourceRoomId?: string,
  preconvertedUrlMap?: Record<string, { convertedUrl: string; marketplace: MarketplaceId; sku?: string }>
): ParsedOfferResult {
  let workingText = rawText || '';
  const originalUrls: string[] = [];
  const convertedUrls: string[] = [];
  const removedElements: string[] = [];
  let detectedMarketplace: MarketplaceId | null = null;
  let primarySku = 'MLB29481029';

  const urlRegex = /https?:\/\/[^\s)]+/gi;

  // 1. Sanitize external competitor invite/group/site links
  if (rules.replacement.sanitizeInviteLinks) {
    const initialUrls = workingText.match(urlRegex) || [];
    const hasAnyKnownMarketplaceUrl = initialUrls.some(
      (u) => Boolean(preconvertedUrlMap?.[u]) || detectMarketplaceFromUrl(u) !== null
    );

    for (const u of initialUrls) {
      const isPreconvertedProduct = Boolean(preconvertedUrlMap && preconvertedUrlMap[u]);
      const isMarketplaceProduct = detectMarketplaceFromUrl(u) !== null;

      if (isPreconvertedProduct || isMarketplaceProduct) {
        continue;
      }

      // If it matches a competitor/invite pattern OR if this message already has a product URL
      // (or preconvertedUrlMap was supplied by the backend and this URL was not a product URL), strip it!
      if (
        isCompetitorOrInviteUrl(u) ||
        hasAnyKnownMarketplaceUrl ||
        preconvertedUrlMap !== undefined
      ) {
        removedElements.push(`Link de Concorrente/Grupo removido: ${u}`);
        workingText = workingText.split(u).join('');
      }
    }
  }

  // 2. Parse & replace marketplace affiliate links
  const allUrls = workingText.match(urlRegex) || [];

  const replacements: UrlMatchInfo[] = [];

  for (const url of allUrls) {
    // Check if backend already resolved this URL via official API (Mercado Livre / Shopee / AliExpress / Amazon)
    if (preconvertedUrlMap && preconvertedUrlMap[url]) {
      const pre = preconvertedUrlMap[url];
      detectedMarketplace = pre.marketplace;
      if (pre.sku) primarySku = pre.sku;
      replacements.push({
        fullMatch: url,
        marketplace: pre.marketplace,
        sku: pre.sku || primarySku,
        convertedUrl: pre.convertedUrl,
      });
      continue;
    }

    const mp = detectMarketplaceFromUrl(url);
    if (!mp) continue;

    detectedMarketplace = mp;

    if (mp === 'mercadoLivre' && rules.parser.mercadoLivre && credentials.mercadoLivre.enabled) {
      const { convertedUrl, sku } = buildConvertedUrl(url, 'mercadoLivre', credentials);
      primarySku = sku;
      replacements.push({ fullMatch: url, marketplace: 'mercadoLivre', sku, convertedUrl });
    } else if (mp === 'amazon' && rules.parser.amazon && credentials.amazon.enabled) {
      const { convertedUrl, sku } = buildConvertedUrl(url, 'amazon', credentials);
      primarySku = sku;
      replacements.push({ fullMatch: url, marketplace: 'amazon', sku, convertedUrl });
    } else if (mp === 'shopee' && rules.parser.shopee && credentials.shopee.enabled) {
      const { convertedUrl, sku } = buildConvertedUrl(url, 'shopee', credentials);
      primarySku = sku;
      replacements.push({ fullMatch: url, marketplace: 'shopee', sku, convertedUrl });
    } else if (mp === 'aliExpress' && rules.parser.aliExpress && credentials.aliExpress.enabled) {
      const { convertedUrl, sku } = buildConvertedUrl(url, 'aliExpress', credentials);
      primarySku = sku;
      replacements.push({ fullMatch: url, marketplace: 'aliExpress', sku, convertedUrl });
    }
  }

  for (const rep of replacements) {
    originalUrls.push(rep.fullMatch);
    convertedUrls.push(rep.convertedUrl);
    workingText = workingText.split(rep.fullMatch).join(rep.convertedUrl);
  }

  // 3. Sanitize @mentions
  if (rules.replacement.sanitizeMentions) {
    const mentionRegex = /@[a-zA-Z0-9_.-]{3,}/g;
    const mentions = workingText.match(mentionRegex);
    if (mentions) {
      mentions.forEach((m) => removedElements.push(`Menção removida: ${m}`));
      workingText = workingText.replace(mentionRegex, '');
    }
  }

  // 4. Sanitize phone numbers
  if (rules.replacement.sanitizePhones) {
    const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-\d{4}/g;
    const phones = workingText.match(phoneRegex);
    if (phones) {
      phones.forEach((p) => removedElements.push(`Telefone removido: ${p.trim()}`));
      workingText = workingText.replace(phoneRegex, '');
    }
  }

  // 5. Line-by-line layout standardization
  const rawLines = workingText.split('\n');
  const cleanedLines: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    const lowerLine = trimmed.toLowerCase();

    if (!trimmed) {
      cleanedLines.push('');
      continue;
    }

    if (rules.layout.discardCompetitorCta) {
      if (isCompetitorCtaLine(trimmed)) {
        removedElements.push(`CTA Concorrente descartado: "${trimmed.slice(0, 38)}..."`);
        continue;
      }
    }

    if (!rules.layout.keepPrice && (lowerLine.includes('r$') || lowerLine.includes('por apenas'))) {
      removedElements.push('Linha de preço ocultada pela regra de layout');
      continue;
    }

    if (!rules.layout.keepCoupons && lowerLine.includes('cupom')) {
      removedElements.push('Linha de cupom ocultada pela regra de layout');
      continue;
    }

    cleanedLines.push(trimmed);
  }

  let assembled = cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 6. Append Mandatory Footer (prevent duplicate footer if already present)
  const footerText = rules.replacement.mandatoryFooter.trim();
  if (
    rules.replacement.footerEnabled &&
    footerText &&
    !assembled.includes(footerText)
  ) {
    assembled = assembled ? `${assembled}\n\n${footerText}` : footerText;
  }

  // 7. Determine Anti-Watermark & OG:Image status
  const isSourceBlacklisted = sourceRoomId
    ? rules.antiWatermark.blacklistedRoomIds.includes(sourceRoomId) ||
      rules.antiWatermark.blacklistedRoomIds.includes(`wa-${sourceRoomId}`)
    : true;

  const watermarkIntercepted = rules.antiWatermark.enabled && isSourceBlacklisted;

  let imageActionLabel = 'Imagem original mantida (Grupo fora da Lista Negra)';
  if (watermarkIntercepted) {
    if (rules.antiWatermark.strategy === 'og_image') {
      imageActionLabel = 'Substituída via OG:Image Oficial do Marketplace (Sem Marca d’Água)';
    } else if (rules.antiWatermark.strategy === 'strip_image') {
      imageActionLabel = 'Imagem do concorrente bloqueada (Disparo somente texto)';
    } else {
      imageActionLabel = 'Imagem original mantida por configuração manual';
    }
  }

  const productPreset = detectProductPreset(rawText);

  const marketplaceDomainMap: Record<MarketplaceId, string> = {
    mercadoLivre: 'http2.mlstatic.com (OG:Image Oficial)',
    amazon: 'm.media-amazon.com (OG:Image Oficial)',
    shopee: 'down-br.img.susercontent.com (OG:Image Oficial)',
    aliExpress: 'ae01.alicdn.com (OG:Image Oficial)',
  };

  return {
    originalText: rawText,
    convertedText: assembled,
    detectedMarketplace,
    originalUrls,
    convertedUrls,
    removedElements,
    watermarkIntercepted,
    imageActionLabel,
    productPreset,
    productSku: primarySku,
    ogImageMetadata: {
      title: `Foto de Estúdio Oficial · ${primarySku}`,
      resolution: '1200 × 1200 px (Alta Resolução)',
      sourceDomain: detectedMarketplace
        ? marketplaceDomainMap[detectedMarketplace]
        : 'cdn.marketplace.com (OG:Image)',
    },
  };
}
