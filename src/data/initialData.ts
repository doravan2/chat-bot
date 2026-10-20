import {
  AffiliateCredentials,
  AlertSettings,
  ChatRoom,
  ConnectionsState,
  DispatchHistoryItem,
  ProductVisualPreset,
  ReplicaRules,
  TrafficRoute,
} from '../types';

export const INITIAL_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  targetPhone: '',
  cooldownMinutes: 5,
  customPrefix: '⚠️ Erro de envio, verifique:',
  alertOnSendError: true,
  alertOnApiError: true,
  alertOnBrokenLink: false,
  recentAlerts: [],
};

export const INITIAL_CREDENTIALS: AffiliateCredentials = {
  amazon: {
    enabled: false,
    associateTag: '',
  },
  mercadoLivre: {
    enabled: false,
    affiliateTag: '',
    sessionCookie: '',
  },
  shopee: {
    enabled: false,
    appId: '',
    apiSecret: '',
  },
  aliExpress: {
    enabled: false,
    appKey: '',
    trackingId: '',
    appSecret: '',
  },
};

export const INITIAL_CONNECTIONS: ConnectionsState = {
  whatsapp: {
    status: 'disconnected',
    phoneNumber: '',
    deviceName: 'Sessão WebSocket',
    engine: 'Baileys v6.7 (WebSocket)',
    lastSync: 'Aguardando leitura do QR Code',
    qrSeed: 482910,
  },
  telegram: {
    status: 'offline',
    botToken: '',
    botUsername: '',
    botId: '',
    pingMs: 0,
    lastValidatedAt: 'Não configurado',
  },
};

export const INITIAL_ROOMS: ChatRoom[] = [];

export const INITIAL_ROUTES: TrafficRoute[] = [];

export const INITIAL_RULES: ReplicaRules = {
  parser: {
    amazon: true,
    mercadoLivre: true,
    shopee: true,
    aliExpress: true,
  },
  layout: {
    keepTitle: true,
    keepPrice: true,
    keepCoupons: true,
    discardCompetitorCta: true,
  },
  antiWatermark: {
    enabled: true,
    blacklistedRoomIds: [],
    strategy: 'og_image',
  },
  antiDuplicate: {
    enabled: true,
    cooldownHours: 8,
  },
  replacement: {
    footerEnabled: false,
    mandatoryFooter: '',
    sanitizeMentions: true,
    sanitizePhones: true,
    sanitizeInviteLinks: true,
  },
};

export interface CompetitorOfferSample {
  id: string;
  label: string;
  marketplace: 'mercadoLivre' | 'amazon' | 'shopee' | 'aliExpress';
  sourceRoomId: string;
  productPreset: ProductVisualPreset;
  rawMessage: string;
}

export const COMPETITOR_OFFER_SAMPLES: CompetitorOfferSample[] = [
  {
    id: 'sample-ml',
    label: 'Mercado Livre · Fone Bluetooth Sony WH-1000XM5',
    marketplace: 'mercadoLivre',
    sourceRoomId: 'room-wpp-1',
    productPreset: 'headphones',
    rawMessage: `🔥 MENOR PREÇO HISTÓRICO NO MERCADO LIVRE!
🎧 Fone de Ouvido Bluetooth Noise Canceling Sony WH-1000XM5 Preto

💰 De R$ 2.699 por apenas R$ 1.749 em 10x sem juros!
🎟️ Cupom: SOM150OFF

🛒 Compre aqui: https://meli.la/2x9KpLm

📲 Entre no grupo do João: https://chat.whatsapp.com/InviteConcorrente998
Siga @achadinhos_do_joao ou chame no (11) 99123-4567`,
  },
  {
    id: 'sample-shopee',
    label: 'Shopee · Fritadeira Air Fryer Digital Inox 5.5L',
    marketplace: 'shopee',
    sourceRoomId: 'room-tg-2',
    productPreset: 'airfryer',
    rawMessage: `⚡ CORRE QUE É BUG NA SHOPEE!
🍟 Fritadeira Elétrica Sem Óleo Air Fryer Digital Painel Touch 5.5L Inox

📉 Por apenas R$ 239,90 no PIX!
🎟️ Resgate o cupom de Frete Grátis na tela

🛒 Link da promoção: https://shope.ee/8pLmN4qR2x

Divulgue nosso canal: https://t.me/descontos_da_ana_vip
Dúvidas fale com @ana_promos_oficial`,
  },
  {
    id: 'sample-amazon',
    label: 'Amazon · Cafeteira Espresso Italiana Automática',
    marketplace: 'amazon',
    sourceRoomId: 'room-tg-1',
    productPreset: 'espresso',
    rawMessage: `☕ OFERTA RELÂMPAGO AMAZON PRIME!
Cafeteira Espresso Automática Oster PrimaLatte Touch 19 Bar Inox

💥 Por R$ 989,00 à vista (Menor preço dos últimos 90 dias)
🎟️ Cupom ativo de 10% no app

🛒 Garanta a sua: https://amzn.to/3vK9mPq

Veja mais ofertas em https://t.me/+ConcorrenteTechBR ou @promostech_br`,
  },
  {
    id: 'sample-ali',
    label: 'AliExpress · Smartwatch Titanium AMOLED GPS',
    marketplace: 'aliExpress',
    sourceRoomId: 'room-wpp-2',
    productPreset: 'smartwatch',
    rawMessage: `⌚ SUPER CHOICE DAY ALIEXPRESS (Já no Brasil / Remessa Conforme)
Smartwatch Ultra Titanium Tela AMOLED 1.96" GPS Integrado 5ATM

🔥 Saindo por R$ 164,50 com moedas!
🎟️ Cupom: BRTECH20

🛒 Link direto: https://s.click.aliexpress.com/e/_Dc9X8mL

Convite do nosso grupo: https://chat.whatsapp.com/GrupoConcorrenteVIP22
Contato ADM: +55 21 98877-6655`,
  },
];

export const INITIAL_HISTORY: DispatchHistoryItem[] = [];
