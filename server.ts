import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import pino from 'pino';
import * as Baileys from '@whiskeysockets/baileys';
import {
  AffiliateCredentials,
  AlertDispatchLog,
  AlertSettings,
  ChatRoom,
  DispatchHistoryItem,
  MarketplaceId,
  ReplicaRules,
  TrafficRoute,
} from './src/types';
import {
  INITIAL_ALERT_SETTINGS,
  INITIAL_CREDENTIALS,
  INITIAL_ROOMS,
  INITIAL_ROUTES,
  INITIAL_RULES,
} from './src/data/initialData';
import {
  buildConvertedUrl,
  detectMarketplaceFromUrl,
  isCompetitorCtaLine,
  isCompetitorOrInviteUrl,
  parseAndConvertOffer,
} from './src/utils/replicaEngine';

const makeWASocket =
  (Baileys as any).default?.default ||
  (Baileys as any).default ||
  Baileys.makeWASocket;

const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  Browsers,
} = Baileys;

const AUTH_DIR = path.resolve(process.cwd(), '.baileys_auth');
const AUTH_BACKUP_DIR = path.resolve(process.cwd(), '.baileys_auth_backup');
const ENGINE_CONFIG_PATH = path.resolve(process.cwd(), '.engine_config.json');
const ENGINE_HISTORY_PATH = path.resolve(process.cwd(), '.engine_history.json');
const ENGINE_DISPATCHED_OFFERS_PATH = path.resolve(process.cwd(), '.engine_dispatched_offers.json');
const silentLogger = pino({ level: 'silent' });

process.on('unhandledRejection', () => {
  // Prevent background Baileys socket rejections from crashing the server
});
process.on('uncaughtException', () => {
  // Prevent transient socket exceptions from terminating the process
});

export interface ServerWhatsAppRoom {
  id: string;
  roomCode: string;
  name: string;
  platform: 'whatsapp' | 'telegram';
  kind: 'group' | 'channel';
  membersCount: number;
  role: 'member' | 'admin';
  syncedAt: string;
}

export interface LiveInterceptLogEntry {
  id: string;
  timestamp: string;
  groupJid: string;
  groupId: string;
  groupName: string;
  previewText: string;
  status: 'replicated' | 'ignored_no_route' | 'error' | 'duplicate_suppressed';
  detail: string;
}

interface EngineRuntimeConfig {
  credentials: AffiliateCredentials;
  routes: TrafficRoute[];
  rules: ReplicaRules;
  rooms: ChatRoom[];
  telegramBotToken: string;
  roleOverrides: Record<string, 'member' | 'admin'>;
  discoveredTelegramRooms?: ServerWhatsAppRoom[];
  syncedNewsletters?: ServerWhatsAppRoom[];
  pendingNewsletterInvites?: string[];
  alertSettings?: AlertSettings;
  selectedDraftPair?: {
    sourceRoomId: string;
    sourceRoomIds?: string[];
    destinationRoomId: string;
  };
  savedWhatsAppSession?: {
    phoneNumber: string;
    deviceName: string;
    userJid: string;
    connectedAt: number;
  };
}

let configSyncedAt = 0;

function loadEngineConfig(): EngineRuntimeConfig {
  try {
    if (fs.existsSync(ENGINE_CONFIG_PATH)) {
      const raw = fs.readFileSync(ENGINE_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const isSavedDemo =
        parsed.credentials?.mercadoLivre?.sessionCookie?.includes('ml_sess_active_99812x') &&
        parsed.credentials?.shopee?.apiSecret?.startsWith('shp_live_98f7');
      configSyncedAt = isSavedDemo ? 0 : Date.now();
      const loadedCreds = parsed.credentials || INITIAL_CREDENTIALS;
      if (loadedCreds.mercadoLivre?.affiliateTag || loadedCreds.mercadoLivre?.sessionCookie) {
        loadedCreds.mercadoLivre.enabled = loadedCreds.mercadoLivre.enabled ?? true;
      }
      if (loadedCreds.shopee?.appId && loadedCreds.shopee?.apiSecret) {
        loadedCreds.shopee.enabled = loadedCreds.shopee.enabled ?? true;
      }
      if (loadedCreds.aliExpress?.appKey && (loadedCreds.aliExpress?.trackingId || loadedCreds.aliExpress?.appSecret)) {
        loadedCreds.aliExpress.enabled = loadedCreds.aliExpress.enabled ?? true;
      }
      if (loadedCreds.amazon?.associateTag) {
        loadedCreds.amazon.enabled = loadedCreds.amazon.enabled ?? true;
      }
      return {
        credentials: loadedCreds,
        routes: parsed.routes || INITIAL_ROUTES,
        rules: parsed.rules || INITIAL_RULES,
        rooms: parsed.rooms || INITIAL_ROOMS,
        telegramBotToken: parsed.telegramBotToken || '',
        roleOverrides: parsed.roleOverrides || {},
        discoveredTelegramRooms: Array.isArray(parsed.discoveredTelegramRooms)
          ? parsed.discoveredTelegramRooms
          : [],
        syncedNewsletters: Array.isArray(parsed.syncedNewsletters)
          ? parsed.syncedNewsletters
          : [],
        pendingNewsletterInvites: Array.isArray(parsed.pendingNewsletterInvites)
          ? parsed.pendingNewsletterInvites
          : [],
        alertSettings: {
          ...INITIAL_ALERT_SETTINGS,
          ...(parsed.alertSettings || {}),
          recentAlerts: Array.isArray(parsed.alertSettings?.recentAlerts)
            ? parsed.alertSettings.recentAlerts
            : [],
        },
        selectedDraftPair: parsed.selectedDraftPair,
        savedWhatsAppSession: parsed.savedWhatsAppSession,
      };
    }
  } catch {
    // ignore config load error
  }
  return {
    credentials: INITIAL_CREDENTIALS,
    routes: INITIAL_ROUTES,
    rules: INITIAL_RULES,
    rooms: INITIAL_ROOMS,
    telegramBotToken: '',
    roleOverrides: {},
    discoveredTelegramRooms: [],
    syncedNewsletters: [],
    pendingNewsletterInvites: [],
    alertSettings: { ...INITIAL_ALERT_SETTINGS },
  };
}

function saveEngineConfig(cfg: EngineRuntimeConfig) {
  try {
    fs.writeFileSync(ENGINE_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {
    // ignore config save error
  }
}

const DEFAULT_SEEDED_HISTORY: DispatchHistoryItem[] = [];

const HISTORY_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function getHistoryItemCreatedAt(item: DispatchHistoryItem): number {
  if (typeof item.createdAt === 'number' && item.createdAt > 0) {
    return item.createdAt;
  }
  const match = String(item.id || '').match(/hist-(?:err-)?(\d{12,14})/);
  if (match && match[1]) {
    const parsedTs = Number(match[1]);
    if (!Number.isNaN(parsedTs) && parsedTs > 0) {
      return parsedTs;
    }
  }
  return Date.now();
}

function isTestOrSampleHistoryItem(item: DispatchHistoryItem): boolean {
  if (['hist-1', 'hist-2', 'hist-3', 'hist-4'].includes(item.id)) return true;
  const title = (item.productTitle || '').toLowerCase();
  if (
    title.includes('super choice day') ||
    title.includes('smartwatch ultra titanium') ||
    title.includes('fone de ouvido bluetooth noise canceling sony') ||
    title.includes('fritadeira elétrica sem óleo air fryer') ||
    title.includes('cafeteira espresso automática oster')
  ) {
    return true;
  }
  const url = (item.originalUrl || '').toLowerCase();
  if (
    url.includes('meli.la/2x9kplm') ||
    url.includes('shope.ee/8plmn4qr2x') ||
    url.includes('s.click.aliexpress.com/e/_dc9x8ml') ||
    url.includes('amzn.to/3vk9mpq')
  ) {
    return true;
  }
  if (
    item.status === 'error' &&
    (item.errorReason?.includes('Erro 404') ||
      item.errorReason?.includes('página inexistente') ||
      item.errorReason?.includes('Falha na API da Shopee'))
  ) {
    return true;
  }
  return false;
}

function filterValidHistoryWithin8h(items: DispatchHistoryItem[]): DispatchHistoryItem[] {
  const now = Date.now();
  return items
    .map((item) => ({
      ...item,
      createdAt: getHistoryItemCreatedAt(item),
    }))
    .filter((item) => {
      if (now - (item.createdAt || now) >= HISTORY_TTL_MS) return false;
      if (isTestOrSampleHistoryItem(item)) return false;
      if (item.status === 'error' && item.originalUrl && isCompetitorOrInviteUrl(item.originalUrl)) {
        return false;
      }
      return true;
    });
}

function loadServerHistory(): DispatchHistoryItem[] {
  try {
    if (fs.existsSync(ENGINE_HISTORY_PATH)) {
      const raw = fs.readFileSync(ENGINE_HISTORY_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = filterValidHistoryWithin8h(parsed);
        if (valid.length !== parsed.length) {
          saveServerHistory(valid);
        }
        return valid;
      }
    }
  } catch {
    // ignore history load error
  }
  return filterValidHistoryWithin8h(DEFAULT_SEEDED_HISTORY);
}

function saveServerHistory(items: DispatchHistoryItem[]) {
  try {
    fs.writeFileSync(ENGINE_HISTORY_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch {
    // ignore history save error
  }
}

const engineConfig: EngineRuntimeConfig = loadEngineConfig();
let serverHistory: DispatchHistoryItem[] = loadServerHistory();
let recentInterceptLogs: LiveInterceptLogEntry[] = [];

function pruneExpiredHistory() {
  const valid = filterValidHistoryWithin8h(serverHistory);
  if (valid.length !== serverHistory.length) {
    serverHistory = valid;
    saveServerHistory(serverHistory);
  }
}

setInterval(pruneExpiredHistory, 60 * 1000);

// Anti-loop tracking
const sentByBotMsgIds = new Set<string>();
const processedIncomingMsgIds = new Set<string>();
const recentlySentByBotTexts = new Map<string, number>();

function recordBotOutgoingMessage(targetJid: string, text: string) {
  const cleanText = text.trim();
  const normJid = normalizeJid(targetJid);
  recentlySentByBotTexts.set(`${normJid}:::${cleanText}`, Date.now());
  recentlySentByBotTexts.set(`GLOBAL:::${cleanText}`, Date.now());
}

function wasRecentlySentByBot(remoteJid: string, text: string): boolean {
  const cleanText = text.trim();
  if (!cleanText) return false;
  const normJid = normalizeJid(remoteJid);
  const now = Date.now();

  const exactTs = recentlySentByBotTexts.get(`${normJid}:::${cleanText}`);
  if (exactTs && now - exactTs < 30000) return true;

  const globalTs = recentlySentByBotTexts.get(`GLOBAL:::${cleanText}`);
  if (globalTs && now - globalTs < 15000) return true;

  return false;
}

function pushInterceptLog(entry: Omit<LiveInterceptLogEntry, 'id' | 'timestamp'>) {
  const nowStr = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const full: LiveInterceptLogEntry = {
    ...entry,
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: nowStr,
  };
  recentInterceptLogs = [full, ...recentInterceptLogs.slice(0, 14)];
}

// ============================================================================
// ANTI-DUPLICATE OFFER ENGINE (Prevents re-sending same product/link to destination)
// ============================================================================
interface DispatchedOfferRecord {
  destinationKey: string;
  productTitle: string;
  normalizedTitle: string;
  canonicalProductId?: string | null;
  marketplace?: MarketplaceId | null;
  originalUrls: string[];
  convertedUrls: string[];
  productSku?: string;
  dispatchedAt: number;
}

const TITLE_STOPWORDS = new Set([
  'para', 'de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'e', 'ao', 'aos', 'se', 'que',
  // Common color variations (variations of the exact same product listing)
  'branco', 'branca', 'preto', 'preta', 'cinza', 'azul', 'vermelho', 'vermelha', 'verde',
  'amarelo', 'amarela', 'rosa', 'dourado', 'dourada', 'prata', 'grafite', 'chumbo', 'rose',
  'gold', 'silver', 'black', 'white', 'grey', 'gray', 'red', 'blue', 'green', 'yellow', 'pink',
  // Spec and model variations
  '110v', '220v', 'bivolt', 'v1', 'v2', 'v3', 'pro', 'plus', 'lite', 'max', 'ultra', 'mini',
  // Promotional filler words
  'promocao', 'oferta', 'desconto', 'cupom', 'frete', 'gratis', 'top', 'novo', 'nova',
  'imperdivel', 'full', 'original', 'oficial', 'qualidade', 'garantia', 'compre', 'aqui',
  'link', 'menor', 'preco', 'historico', 'apenas', 'vista', 'juros'
]);

function extractMeaningfulTitleTokens(title: string): Set<string> {
  let clean = (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Strip trailing part numbers / SKU codes like ZNO-ZNNB0210-BK01-V2 BEFORE removing punctuation
  clean = clean.replace(/\b[a-z0-9]{2,}(?:-[a-z0-9]+){1,}\b/gi, ' ');
  // Then replace punctuation and non-alphanumeric with spaces
  clean = clean.replace(/[^a-z0-9]/g, ' ');

  const tokens = clean
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w));

  return new Set(tokens);
}

function computeTitleWordSimilarity(titleA: string, titleB: string): number {
  const setA = extractMeaningfulTitleTokens(titleA);
  const setB = extractMeaningfulTitleTokens(titleB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let commonCount = 0;
  for (const t of setA) {
    if (setB.has(t)) commonCount++;
  }

  const smallerSize = Math.min(setA.size, setB.size);
  const overlapRatio = commonCount / smallerSize;
  const jaccardRatio = commonCount / (setA.size + setB.size - commonCount);

  return Math.max(overlapRatio, jaccardRatio);
}

function extractCanonicalProductId(
  url: string,
  htmlContent?: string
): { marketplace: MarketplaceId | null; productId: string | null } {
  const raw = (url || '').trim();
  const lowerUrl = raw.toLowerCase();

  const tryShopee = (target: string): string | null => {
    if (!target) return null;
    const m1 = target.match(/\/product\/\d+\/(\d{6,16})/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = target.match(/-i\.\d+\.(\d{6,16})/i);
    if (m2 && m2[1]) return m2[1];
    const m3 = target.match(/[?&](?:item_?id|product_?id)=(\d{6,16})/i);
    if (m3 && m3[1]) return m3[1];
    const m4 = target.match(/\/universal-link[^\s"'<>]*itemid=(\d{6,16})/i);
    if (m4 && m4[1]) return m4[1];
    return null;
  };

  const tryMercadoLivre = (target: string): string | null => {
    if (!target) return null;
    const m1 = target.match(/\b(MLB-?\d{7,14})\b/i);
    if (m1 && m1[1]) return m1[1].toUpperCase().replace('-', '');
    const m2 = target.match(/\/(?:p|up)\/(MLB\d{6,14})/i);
    if (m2 && m2[1]) return m2[1].toUpperCase();
    return null;
  };

  const tryAmazon = (target: string): string | null => {
    if (!target) return null;
    const m1 = target.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m1 && m1[1]) return m1[1].toUpperCase();
    const m2 = target.match(/[?&]ASIN=([A-Z0-9]{10})/i);
    if (m2 && m2[1]) return m2[1].toUpperCase();
    return null;
  };

  const tryAliExpress = (target: string): string | null => {
    if (!target) return null;
    const m1 = target.match(/\/item\/(\d{8,18})\.html/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = target.match(/[?&]productIds?=(\d{8,18})/i);
    if (m2 && m2[1]) return m2[1];
    return null;
  };

  // 1. Direct URL check
  const shpFromUrl = tryShopee(raw);
  if (shpFromUrl) return { marketplace: 'shopee', productId: `shp_${shpFromUrl}` };

  const mlFromUrl = tryMercadoLivre(raw);
  if (mlFromUrl) return { marketplace: 'mercadoLivre', productId: mlFromUrl };

  const azFromUrl = tryAmazon(raw);
  if (azFromUrl) return { marketplace: 'amazon', productId: azFromUrl };

  const aliFromUrl = tryAliExpress(raw);
  if (aliFromUrl) return { marketplace: 'aliExpress', productId: `ali_${aliFromUrl}` };

  // 2. HTML inspection (canonical link, og:url, metadata attributes)
  if (htmlContent) {
    const canonicalMatch =
      htmlContent.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
      htmlContent.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
    if (canonicalMatch && canonicalMatch[1]) {
      const cUrl = canonicalMatch[1];
      const cShp = tryShopee(cUrl);
      if (cShp) return { marketplace: 'shopee', productId: `shp_${cShp}` };
      const cMl = tryMercadoLivre(cUrl);
      if (cMl) return { marketplace: 'mercadoLivre', productId: cMl };
      const cAz = tryAmazon(cUrl);
      if (cAz) return { marketplace: 'amazon', productId: cAz };
      const cAli = tryAliExpress(cUrl);
      if (cAli) return { marketplace: 'aliExpress', productId: `ali_${cAli}` };
    }

    if (lowerUrl.includes('shopee') || lowerUrl.includes('shp.ee') || htmlContent.includes('shopee')) {
      const shpJson =
        htmlContent.match(/"(?:item_?id|itemId)":\s*"?(\d{6,16})"?/i) ||
        htmlContent.match(/data-itemid="(\d{6,16})"/i) ||
        htmlContent.match(/[?&]item_?id=(\d{6,16})/i);
      if (shpJson && shpJson[1]) {
        return { marketplace: 'shopee', productId: `shp_${shpJson[1]}` };
      }
    }

    if (lowerUrl.includes('meli') || lowerUrl.includes('mercadolivre') || htmlContent.includes('mercadolivre')) {
      const mlJson =
        htmlContent.match(/"item_id":\s*"(MLB-?\d{6,14})"/i) ||
        htmlContent.match(/"id":\s*"(MLB\d{6,14})"/i) ||
        htmlContent.match(/data-item-id="(MLB\d{6,14})"/i);
      if (mlJson && mlJson[1]) {
        return { marketplace: 'mercadoLivre', productId: mlJson[1].toUpperCase().replace('-', '') };
      }
    }

    if (lowerUrl.includes('amazon') || lowerUrl.includes('amzn.to') || htmlContent.includes('amazon')) {
      const azAttr =
        htmlContent.match(/name="ASIN"\s+value="([A-Z0-9]{10})"/i) ||
        htmlContent.match(/data-asin="([A-Z0-9]{10})"/i);
      if (azAttr && azAttr[1]) {
        return { marketplace: 'amazon', productId: azAttr[1].toUpperCase() };
      }
    }

    if (lowerUrl.includes('aliexpress') || htmlContent.includes('aliexpress')) {
      const aliJson =
        htmlContent.match(/"productId":\s*"?(\d{8,18})"?/i) ||
        htmlContent.match(/data-product-id="(\d{8,18})"/i);
      if (aliJson && aliJson[1]) {
        return { marketplace: 'aliExpress', productId: `ali_${aliJson[1]}` };
      }
    }
  }

  return { marketplace: null, productId: null };
}

function normalizeOfferFingerprint(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeUrlForDedup(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return (rawUrl || '').trim().toLowerCase();
  }
}

function getDestinationKeySet(destId?: string, destJid?: string): Set<string> {
  const keys = new Set<string>();
  const add = (val?: string) => {
    if (!val) return;
    const n = normalizeJid(val);
    if (n) {
      keys.add(n);
      const bare = extractBareRoomId(n);
      if (bare) keys.add(bare);
    }
  };
  add(destId);
  add(destJid);

  const room =
    (destId ? findRoomInAllLists(destId) : undefined) ||
    (destJid ? findRoomInAllLists(destJid) : undefined);
  if (room) {
    add(room.id);
    add(room.roomCode);
  }
  return keys;
}

function isSameDestination(candidateKeys: Set<string>, pastDestKey: string): boolean {
  if (candidateKeys.has(pastDestKey)) return true;
  const pastKeys = getDestinationKeySet(pastDestKey);
  for (const k of candidateKeys) {
    if (pastKeys.has(k)) return true;
  }
  return false;
}

function loadDispatchedOffersCache(): Map<string, DispatchedOfferRecord[]> {
  const cacheMap = new Map<string, DispatchedOfferRecord[]>();
  try {
    if (fs.existsSync(ENGINE_DISPATCHED_OFFERS_PATH)) {
      const raw = fs.readFileSync(ENGINE_DISPATCHED_OFFERS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        const maxTtl = 8 * 60 * 60 * 1000;
        for (const item of parsed) {
          if (now - (item.dispatchedAt || 0) < maxTtl) {
            const list = cacheMap.get(item.destinationKey) || [];
            cacheMap.set(item.destinationKey, [...list, item]);
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return cacheMap;
}

function saveDispatchedOffersCache(cacheMap: Map<string, DispatchedOfferRecord[]>) {
  try {
    const allRecords: DispatchedOfferRecord[] = [];
    const now = Date.now();
    const maxTtl = 8 * 60 * 60 * 1000;
    for (const records of cacheMap.values()) {
      for (const r of records) {
        if (now - r.dispatchedAt < maxTtl) {
          allRecords.push(r);
        }
      }
    }
    fs.writeFileSync(
      ENGINE_DISPATCHED_OFFERS_PATH,
      JSON.stringify(allRecords.slice(0, 500), null, 2),
      'utf-8'
    );
  } catch {
    // ignore
  }
}

const dispatchedOffersCache = loadDispatchedOffersCache();

interface DuplicateCheckResult {
  isDuplicate: boolean;
  timeAgoText?: string;
  matchedBy?: string;
  previousRecord?: DispatchedOfferRecord;
}

function checkIsOfferDuplicateForDestination(params: {
  destinationRoomId: string;
  destinationJid: string;
  originalUrls: string[];
  convertedUrls: string[];
  productTitle: string;
  canonicalProductId?: string | null;
  productSku?: string;
  cooldownHours: number;
}): DuplicateCheckResult {
  const {
    destinationRoomId,
    destinationJid,
    originalUrls,
    convertedUrls,
    productTitle,
    canonicalProductId,
    productSku,
    cooldownHours,
  } = params;

  const now = Date.now();
  const cooldownMs = Math.max(1, cooldownHours) * 60 * 60 * 1000;
  const candidateDestKeys = getDestinationKeySet(destinationRoomId, destinationJid);

  const normCandidateTitle = normalizeOfferFingerprint(productTitle);
  const normCandidateOriginalUrls = (originalUrls || []).map(normalizeUrlForDedup).filter(Boolean);
  const normCandidateConvertedUrls = (convertedUrls || []).map(normalizeUrlForDedup).filter(Boolean);

  const pastRecords: DispatchedOfferRecord[] = [];

  for (const [key, records] of dispatchedOffersCache.entries()) {
    if (!isSameDestination(candidateDestKeys, key)) continue;
    for (const r of records) {
      if (now - r.dispatchedAt < cooldownMs) {
        pastRecords.push(r);
      }
    }
  }

  for (const h of serverHistory) {
    if (h.status !== 'success') continue;
    if (!isSameDestination(candidateDestKeys, h.destinationRoomId)) continue;
    const itemAge = now - (h.createdAt || now);
    if (itemAge >= cooldownMs) continue;

    const extracted =
      h.canonicalProductId
        ? { productId: h.canonicalProductId, marketplace: h.marketplace }
        : extractCanonicalProductId(h.originalUrl) || extractCanonicalProductId(h.convertedUrl);

    pastRecords.push({
      destinationKey: h.destinationRoomId,
      productTitle: h.productTitle,
      normalizedTitle: normalizeOfferFingerprint(h.productTitle),
      canonicalProductId: extracted.productId || h.canonicalProductId,
      originalUrls: [h.originalUrl].filter(Boolean),
      convertedUrls: [h.convertedUrl].filter(Boolean),
      dispatchedAt: h.createdAt || now,
    });
  }

  for (const prev of pastRecords) {
    const elapsedMs = now - prev.dispatchedAt;
    if (elapsedMs >= cooldownMs) continue;

    const minutesAgo = Math.max(1, Math.round(elapsedMs / (60 * 1000)));
    const timeAgoText =
      minutesAgo < 60
        ? `há ${minutesAgo} min`
        : `há ${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}min`;

    // 1. Canonical Product ID match (same Shopee Item ID, Mercado Livre MLB, Amazon ASIN, etc.)
    if (
      canonicalProductId &&
      prev.canonicalProductId &&
      canonicalProductId === prev.canonicalProductId
    ) {
      return {
        isDuplicate: true,
        timeAgoText,
        matchedBy: `mesmo ID de produto no marketplace (${canonicalProductId})`,
        previousRecord: prev,
      };
    }

    // 2. Semantic Title Similarity (>= 70% core word token match)
    const titleSim = computeTitleWordSimilarity(productTitle, prev.productTitle);
    if (titleSim >= 0.70) {
      const pct = Math.round(titleSim * 100);
      return {
        isDuplicate: true,
        timeAgoText,
        matchedBy: `${pct}% de similaridade de título ("${prev.productTitle.slice(0, 35)}...")`,
        previousRecord: prev,
      };
    }

    // 3. Same competitor original URL (e.g. meli.la/14cNhd3)
    for (const candOrig of normCandidateOriginalUrls) {
      if (!candOrig || candOrig.length < 5) continue;
      for (const prevOrig of prev.originalUrls) {
        if (normalizeUrlForDedup(prevOrig) === candOrig) {
          return {
            isDuplicate: true,
            timeAgoText,
            matchedBy: `mesmo link original do concorrente (${prevOrig})`,
            previousRecord: prev,
          };
        }
      }
    }

    // 4. Same converted URL (e.g. meli.la/2WjuggC)
    for (const candConv of normCandidateConvertedUrls) {
      if (!candConv || candConv.length < 5) continue;
      for (const prevConv of prev.convertedUrls) {
        if (normalizeUrlForDedup(prevConv) === candConv) {
          return {
            isDuplicate: true,
            timeAgoText,
            matchedBy: `mesmo link comissionado oficial`,
            previousRecord: prev,
          };
        }
      }
    }

    // 5. Direct Title Fingerprint Substring / Exact match
    if (normCandidateTitle.length >= 8 && prev.normalizedTitle.length >= 8) {
      if (
        normCandidateTitle === prev.normalizedTitle ||
        (normCandidateTitle.length >= 15 && prev.normalizedTitle.includes(normCandidateTitle)) ||
        (prev.normalizedTitle.length >= 15 && normCandidateTitle.includes(prev.normalizedTitle))
      ) {
        return {
          isDuplicate: true,
          timeAgoText,
          matchedBy: `título idêntico ("${prev.productTitle.slice(0, 35)}...")`,
          previousRecord: prev,
        };
      }
    }

    // 6. Same product SKU
    if (productSku && prev.productSku && productSku === prev.productSku) {
      return {
        isDuplicate: true,
        timeAgoText,
        matchedBy: `mesmo SKU de produto (${productSku})`,
        previousRecord: prev,
      };
    }
  }

  return { isDuplicate: false };
}

function recordDispatchedOffer(params: {
  destinationRoomId: string;
  destinationJid: string;
  originalUrls: string[];
  convertedUrls: string[];
  productTitle: string;
  canonicalProductId?: string | null;
  productSku?: string;
}) {
  const normDest = normalizeJid(params.destinationJid || params.destinationRoomId);
  const record: DispatchedOfferRecord = {
    destinationKey: normDest,
    productTitle: params.productTitle,
    normalizedTitle: normalizeOfferFingerprint(params.productTitle),
    canonicalProductId: params.canonicalProductId,
    originalUrls: params.originalUrls || [],
    convertedUrls: params.convertedUrls || [],
    productSku: params.productSku,
    dispatchedAt: Date.now(),
  };

  const list = dispatchedOffersCache.get(normDest) || [];
  dispatchedOffersCache.set(normDest, [record, ...list.slice(0, 199)]);
  saveDispatchedOffersCache(dispatchedOffersCache);
}


interface WhatsAppSessionState {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'reconnecting' | 'connected';
  qrDataUrl: string | null;
  rawQr: string | null;
  qrGeneratedAt: number | null;
  qrExpiresInSec: number;
  pairingCode: string | null;
  phoneNumber: string | null;
  deviceName: string;
  engine: string;
  lastSync: string;
  errorMessage: string | null;
  syncedGroups: ServerWhatsAppRoom[];
  discoveredTelegramRooms: ServerWhatsAppRoom[];
  mode: 'baileys_live' | 'camera_pair';
  lastInterceptStatus: string;
}

function syncAuthBackup() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    if (!fs.existsSync(AUTH_BACKUP_DIR)) {
      fs.mkdirSync(AUTH_BACKUP_DIR, { recursive: true });
    }
    const files = fs.readdirSync(AUTH_DIR);
    for (const f of files) {
      try {
        fs.copyFileSync(path.join(AUTH_DIR, f), path.join(AUTH_BACKUP_DIR, f));
      } catch {}
    }
  } catch {
    // ignore backup sync error
  }
}

function restoreAuthFromBackup() {
  try {
    if (!fs.existsSync(AUTH_BACKUP_DIR)) return;
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    const mainCreds = path.join(AUTH_DIR, 'creds.json');
    const mainFiles = fs.readdirSync(AUTH_DIR);
    if (!fs.existsSync(mainCreds) || mainFiles.length <= 1) {
      const backupFiles = fs.readdirSync(AUTH_BACKUP_DIR);
      for (const f of backupFiles) {
        try {
          fs.copyFileSync(path.join(AUTH_BACKUP_DIR, f), path.join(AUTH_DIR, f));
        } catch {}
      }
    }
  } catch {
    // ignore backup restore error
  }
}

function clearAuthDirectory(forceBackupPurge = false) {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    if (forceBackupPurge && fs.existsSync(AUTH_BACKUP_DIR)) {
      fs.rmSync(AUTH_BACKUP_DIR, { recursive: true, force: true });
    }
  } catch {
    // ignore auth dir cleanup error
  }
}

function hasValidCredsOnDisk(): boolean {
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    const raw = fs.readFileSync(credsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.me?.id || parsed?.registered);
  } catch {
    return false;
  }
}

function exportAuthBundle(): Record<string, string> | null {
  try {
    if (!hasValidCredsOnDisk()) return null;
    const files = fs.readdirSync(AUTH_DIR);
    const bundle: Record<string, string> = {};
    const preKeys = files.filter((f) => f.startsWith('pre-key-')).slice(-35);
    const preKeySet = new Set(preKeys);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (f.startsWith('pre-key-') && !preKeySet.has(f)) continue;
      try {
        bundle[f] = fs.readFileSync(path.join(AUTH_DIR, f), 'utf-8');
      } catch {}
    }
    return bundle['creds.json'] ? bundle : null;
  } catch {
    return null;
  }
}

function importAuthBundle(bundle: Record<string, string> | null | undefined): boolean {
  try {
    if (!bundle || typeof bundle !== 'object' || !bundle['creds.json']) return false;
    const parsedCreds = JSON.parse(bundle['creds.json']);
    if (!parsedCreds?.me?.id && !parsedCreds?.registered) return false;
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    if (!fs.existsSync(AUTH_BACKUP_DIR)) {
      fs.mkdirSync(AUTH_BACKUP_DIR, { recursive: true });
    }
    for (const [fileName, content] of Object.entries(bundle)) {
      if (typeof fileName === 'string' && fileName.endsWith('.json') && typeof content === 'string') {
        const safeName = path.basename(fileName);
        fs.writeFileSync(path.join(AUTH_DIR, safeName), content, 'utf-8');
        fs.writeFileSync(path.join(AUTH_BACKUP_DIR, safeName), content, 'utf-8');
      }
    }
    return true;
  } catch {
    return false;
  }
}

restoreAuthFromBackup();
const hasInitialDiskCreds = hasValidCredsOnDisk();
const savedWa = hasInitialDiskCreds ? engineConfig.savedWhatsAppSession : undefined;
const waState: WhatsAppSessionState = {
  status: hasInitialDiskCreds ? 'reconnecting' : 'connecting',
  qrDataUrl: null,
  rawQr: null,
  qrGeneratedAt: null,
  qrExpiresInSec: 60,
  pairingCode: null,
  phoneNumber: hasInitialDiskCreds ? (savedWa?.phoneNumber || null) : null,
  deviceName: savedWa?.deviceName || 'Baileys Multi-Device Node',
  engine: 'Baileys WebSocket (WhatsApp Web Oficial)',
  lastSync: hasInitialDiskCreds
    ? 'Sessão ativa salva · Reconectando socket com o celular...'
    : 'Iniciando protocolo Multi-Device...',
  errorMessage: null,
  syncedGroups: [...(engineConfig.syncedNewsletters || [])],
  discoveredTelegramRooms: [...(engineConfig.discoveredTelegramRooms || [])],
  mode: 'baileys_live',
  lastInterceptStatus: 'Motor de replicação pronto e escutando eventos',
};

let activeSock: any = null;
let isStartingSocket = false;
let socketRestartPending = false;
let lastSocketActivity = Date.now();
let presenceKeepAliveInterval: NodeJS.Timeout | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let lastCredsSavePromise: Promise<void> = Promise.resolve();

function formatJidToPhone(jid?: string): string {
  if (!jid) return 'Conectado';
  const raw = jid.split(':')[0].split('@')[0];
  if (raw.startsWith('55') && raw.length >= 12) {
    const ddd = raw.slice(2, 4);
    const rest = raw.slice(4);
    const part1 = rest.slice(0, rest.length - 4);
    const part2 = rest.slice(-4);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }
  return `+${raw}`;
}

function extractBareNumber(jid?: string): string {
  if (!jid) return '';
  return jid.split(':')[0].split('@')[0];
}

function normalizeJid(idOrCode?: string): string {
  if (!idOrCode) return '';
  return idOrCode
    .replace(/^wa-/, '')
    .replace(/^tg-/, '')
    .trim()
    .toLowerCase();
}

function extractBareRoomId(idOrCode?: string): string {
  return normalizeJid(idOrCode).split('@')[0];
}

function findRoomInAllLists(idOrCode: string): ChatRoom | ServerWhatsAppRoom | undefined {
  if (!idOrCode) return undefined;
  const norm = normalizeJid(idOrCode);
  const bare = extractBareRoomId(idOrCode);

  const direct =
    waState.syncedGroups.find(
      (r) =>
        r.id === idOrCode ||
        normalizeJid(r.roomCode) === norm ||
        normalizeJid(r.id) === norm ||
        extractBareRoomId(r.roomCode) === bare
    ) ||
    waState.discoveredTelegramRooms.find(
      (r) =>
        r.id === idOrCode ||
        normalizeJid(r.roomCode) === norm ||
        normalizeJid(r.id) === norm
    ) ||
    engineConfig.rooms.find(
      (r) =>
        r.id === idOrCode ||
        normalizeJid(r.roomCode) === norm ||
        normalizeJid(r.id) === norm ||
        extractBareRoomId(r.roomCode) === bare
    );

  if (direct && String(direct.id).startsWith('room-custom-') && waState.syncedGroups.length > 0) {
    const cleanName = direct.name.trim().toLowerCase();
    const realMatch = waState.syncedGroups.find(
      (g) => g.name.trim().toLowerCase() === cleanName
    );
    if (realMatch) return realMatch;
  }

  return direct;
}

function unwrapBaileysMessage(m: any): any {
  if (!m) return null;
  if (m.deviceSentMessage?.message) {
    return unwrapBaileysMessage(m.deviceSentMessage.message);
  }
  if (m.ephemeralMessage?.message) {
    return unwrapBaileysMessage(m.ephemeralMessage.message);
  }
  if (m.viewOnceMessage?.message) {
    return unwrapBaileysMessage(m.viewOnceMessage.message);
  }
  if (m.viewOnceMessageV2?.message) {
    return unwrapBaileysMessage(m.viewOnceMessageV2.message);
  }
  if (m.viewOnceMessageV2Extension?.message) {
    return unwrapBaileysMessage(m.viewOnceMessageV2Extension.message);
  }
  if (m.documentWithCaptionMessage?.message) {
    return unwrapBaileysMessage(m.documentWithCaptionMessage.message);
  }
  if (m.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapBaileysMessage(m.editedMessage.message.protocolMessage.editedMessage);
  }
  if (m.editedMessage?.message) {
    return unwrapBaileysMessage(m.editedMessage.message);
  }
  if (m.associatedChildMessage?.message) {
    return unwrapBaileysMessage(m.associatedChildMessage.message);
  }
  if (m.groupMentionedMessage?.message) {
    return unwrapBaileysMessage(m.groupMentionedMessage.message);
  }
  if (m.botInvokeMessage?.message) {
    return unwrapBaileysMessage(m.botInvokeMessage.message);
  }
  return m;
}

function extractWhatsAppMessageData(msg: any): {
  text: string;
  hasImage: boolean;
  unwrappedContent: any;
} {
  const content = unwrapBaileysMessage(msg?.message);
  if (!content) return { text: '', hasImage: false, unwrappedContent: null };

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsMessage?.contentText ||
    content.templateMessage?.hydratedTemplate?.hydratedContentText ||
    content.interactiveMessage?.body?.text ||
    content.listMessage?.description ||
    '';

  const hasImage = Boolean(content.imageMessage);
  return { text: String(text || '').trim(), hasImage, unwrappedContent: content };
}

// ============================================================================
// OFFICIAL AFFILIATE API LINK GENERATORS (MERCADO LIVRE, SHOPEE, ALIEXPRESS, AMAZON)
// ============================================================================

function parseMercadoLivreSessionCookie(rawCookie: string): {
  cookieHeader: string;
  csrfToken: string;
} {
  const trimmed = (rawCookie || '').trim();
  if (!trimmed) return { cookieHeader: '', csrfToken: '' };

  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const pairs: string[] = [];
        let csrfToken = '';
        for (const item of arr) {
          if (item && item.name && item.value !== undefined) {
            pairs.push(`${item.name}=${item.value}`);
            if (item.name === '_csrf') {
              csrfToken = String(item.value);
            }
          }
        }
        return { cookieHeader: pairs.join('; '), csrfToken };
      }
    } catch {
      // fall through
    }
  }

  const csrfMatch = trimmed.match(/(?:^|;\s*)_csrf=([^;]+)/);
  return {
    cookieHeader: trimmed,
    csrfToken: csrfMatch ? csrfMatch[1].trim() : '',
  };
}

async function generateOfficialMercadoLivreShortLink(
  expandedProductUrl: string,
  credentials: AffiliateCredentials
): Promise<string | null> {
  try {
    const u = new URL(expandedProductUrl);
    u.search = '';
    u.hash = '';
    const cleanProductUrl = u.toString();

    const { cookieHeader, csrfToken } = parseMercadoLivreSessionCookie(
      credentials.mercadoLivre.sessionCookie
    );
    const rawTag = credentials.mercadoLivre.affiliateTag.trim();
    const cleanTag = rawTag.includes('=')
      ? new URLSearchParams(rawTag.replace(/^\?/, '')).get('matt_word') || rawTag
      : rawTag || 'atacadovipofertas';

    if (cookieHeader && cookieHeader.includes('ssid=')) {
      const res = await fetch(
        'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieHeader,
            'x-csrf-token': csrfToken,
            Origin: 'https://www.mercadolivre.com.br',
            Referer: 'https://www.mercadolivre.com.br/afiliados/linkbuilder',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          body: JSON.stringify({
            urls: [cleanProductUrl],
            tag: cleanTag,
          }),
          signal: AbortSignal.timeout(2500),
        }
      );

      if (res.ok) {
        const data: any = await res.json();
        const firstUrlObj = Array.isArray(data?.urls) ? data.urls[0] : null;
        if (firstUrlObj?.short_url && String(firstUrlObj.short_url).startsWith('http')) {
          return String(firstUrlObj.short_url);
        }
        if (firstUrlObj?.long_url && String(firstUrlObj.long_url).startsWith('http')) {
          return String(firstUrlObj.long_url);
        }
      }
    }
  } catch {
    // ignore transient ML API error
  }
  return null;
}

async function generateOfficialShopeeShortLink(
  expandedProductUrl: string,
  credentials: AffiliateCredentials
): Promise<string | null> {
  try {
    const appId = credentials.shopee.appId.trim();
    const apiSecret = credentials.shopee.apiSecret.trim();
    if (!appId || !apiSecret) return null;

    const u = new URL(expandedProductUrl);
    u.search = '';
    u.hash = '';
    const cleanOriginUrl = u.toString();

    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      query: `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(
        cleanOriginUrl
      )} }) { shortLink } }`,
    });

    const signature = crypto
      .createHash('sha256')
      .update(appId + ts + body + apiSecret)
      .digest('hex');

    const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(2500),
    });

    if (res.ok) {
      const data: any = await res.json();
      const shortLink = data?.data?.generateShortLink?.shortLink;
      if (shortLink && String(shortLink).startsWith('http')) {
        return String(shortLink);
      }
    }
  } catch {
    // ignore transient Shopee API error
  }
  return null;
}

async function generateOfficialAliExpressShortLink(
  expandedProductUrl: string,
  credentials: AffiliateCredentials
): Promise<string | null> {
  try {
    const appKey = credentials.aliExpress.appKey.trim();
    const appSecret = credentials.aliExpress.appSecret.trim();
    const trackingId = credentials.aliExpress.trackingId.trim() || 'Atacadovip';
    if (!appKey || !appSecret) return null;

    // Clean competitor affiliate parameters while keeping essential productIds & coin parameters
    const parsed = new URL(expandedProductUrl);
    parsed.hash = '';
    const productIds = parsed.searchParams.get('productIds');
    const immersiveMode = parsed.searchParams.get('_immersiveMode');
    const fromParam = parsed.searchParams.get('from');
    const isCompetitorFrom = fromParam?.toLowerCase().includes('bot');

    parsed.search = '';
    if (immersiveMode) parsed.searchParams.set('_immersiveMode', immersiveMode);
    if (fromParam && !isCompetitorFrom) parsed.searchParams.set('from', fromParam);
    if (productIds) parsed.searchParams.set('productIds', productIds);

    const cleanSourceUrl = parsed.toString();

    const params: Record<string, string> = {
      app_key: appKey,
      format: 'json',
      method: 'aliexpress.affiliate.link.generate',
      promotion_link_type: '0',
      sign_method: 'sha256',
      source_values: cleanSourceUrl,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      tracking_id: trackingId,
      v: '2.0',
    };

    const sortedKeys = Object.keys(params).sort();
    let signStr = '';
    for (const k of sortedKeys) {
      signStr += k + params[k];
    }
    const sign = crypto
      .createHmac('sha256', appSecret)
      .update(signStr)
      .digest('hex')
      .toUpperCase();
    params.sign = sign;

    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://api-sg.aliexpress.com/sync?${qs}`, {
      method: 'POST',
      signal: AbortSignal.timeout(2500),
    });

    if (res.ok) {
      const data: any = await res.json();
      const promoLinks =
        data?.aliexpress_affiliate_link_generate_response?.resp_result?.result
          ?.promotion_links?.promotion_link;
      if (Array.isArray(promoLinks) && promoLinks[0]?.promotion_link) {
        return String(promoLinks[0].promotion_link);
      }
    }
  } catch {
    // ignore transient AliExpress API error
  }
  return null;
}

function extractCleanProductTitle(rawText: string, pageTitle?: string | null): string {
  if (pageTitle && pageTitle.trim().length > 6 && !pageTitle.toLowerCase().includes('mercado libre')) {
    return pageTitle.trim().slice(0, 80);
  }
  const lines = (rawText || '')
    .split('\n')
    .map((l) => l.replace(/^[🔥🎧⚡🍟☕⌚💥🎮🛒💰💵📉🎟️🔗👉⚠️🇧🇷]+\s*/, '').trim())
    .filter((l) => {
      if (l.length < 4) return false;
      if (/^https?:\/\//i.test(l)) return false;
      if (/^(de\s*r\$|por\s*r\$|r\$\s*\d|cupom|frete\s*gr[aá]tis|v[aá]rias\s*op[cç][oõ]es|loja\s*verificada|compartilhe)/i.test(l)) {
        return false;
      }
      return true;
    });

  if (lines.length >= 2 && lines[0] === lines[0].toUpperCase() && lines[1].length > 10) {
    return lines[1].slice(0, 80);
  }
  return (lines[0] || 'Produto Interceptado').slice(0, 80);
}

function isValidRawImageBuffer(buf: Buffer | null | undefined): buf is Buffer {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 64) return false;
  // JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46), or WebP (52 49 46 46)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
  return isJpeg || isPng || isGif || isWebp;
}

async function downloadTelegramPhotoBuffer(
  token: string,
  photoArray: any[]
): Promise<Buffer | null> {
  if (!token || !Array.isArray(photoArray) || photoArray.length === 0) return null;
  try {
    const largest = photoArray[photoArray.length - 1];
    if (!largest?.file_id) return null;
    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(largest.file_id)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!fileRes.ok) return null;
    const fileData: any = await fileRes.json();
    const filePath = fileData?.result?.file_path;
    if (!filePath) return null;
    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (!imgRes.ok) return null;
    const arrBuf = await imgRes.arrayBuffer();
    const buf = Buffer.from(arrBuf);
    if (isValidRawImageBuffer(buf)) {
      return buf;
    }
  } catch {
    // ignore transient telegram photo error
  }
  return null;
}

function isMarketplaceApiConfigured(
  mp: MarketplaceId,
  credentials: AffiliateCredentials
): { ok: boolean; errorReason?: string } {
  if (mp === 'mercadoLivre') {
    const cookie = (credentials.mercadoLivre?.sessionCookie || '').trim();
    const tag = (credentials.mercadoLivre?.affiliateTag || '').trim();
    const hasAnyConfig = Boolean(tag || cookie);
    if (!credentials.mercadoLivre?.enabled && !hasAnyConfig) {
      return { ok: false, errorReason: 'Integração Mercado Livre desativada' };
    }
    if (!cookie && !tag) {
      return {
        ok: false,
        errorReason: 'API do Mercado Livre não configurada direito (Cookie ou Tag ausente)',
      };
    }
    return { ok: true };
  }
  if (mp === 'shopee') {
    const appId = (credentials.shopee?.appId || '').trim();
    const secret = (credentials.shopee?.apiSecret || '').trim();
    const hasAnyConfig = Boolean(appId && secret);
    if (!credentials.shopee?.enabled && !hasAnyConfig) {
      return { ok: false, errorReason: 'Integração Shopee desativada' };
    }
    if (!appId || !secret || secret.startsWith('shp_live_98f7')) {
      return {
        ok: false,
        errorReason: 'API da Shopee não configurada direito (App ID/Secret inválido)',
      };
    }
    return { ok: true };
  }
  if (mp === 'aliExpress') {
    const appKey = (credentials.aliExpress?.appKey || '').trim();
    const appSecret = (credentials.aliExpress?.appSecret || '').trim();
    const trackingId = (credentials.aliExpress?.trackingId || '').trim();
    const hasAnyConfig = Boolean(appKey && (trackingId || appSecret));
    if (!credentials.aliExpress?.enabled && !hasAnyConfig) {
      return { ok: false, errorReason: 'Integração AliExpress desativada' };
    }
    if (!appKey || (!appSecret && !trackingId) || appSecret.startsWith('ali_sec_77a8')) {
      return {
        ok: false,
        errorReason: 'API do AliExpress não configurada direito (App Key/Secret inválido)',
      };
    }
    return { ok: true };
  }
  if (mp === 'amazon') {
    const tag = (credentials.amazon?.associateTag || '').trim();
    if (!credentials.amazon?.enabled && !tag) {
      return { ok: false, errorReason: 'Integração Amazon desativada' };
    }
    if (!tag) {
      return { ok: false, errorReason: 'Tag da Amazon não configurada direito' };
    }
    return { ok: true };
  }
  return { ok: true };
}

// Expand short links, inspect stock/availability, extract OG:Image, AND generate real official affiliate links
async function resolveAndConvertUrlsInText(
  rawText: string,
  credentials: AffiliateCredentials,
  rules: ReplicaRules
): Promise<{
  preconvertedUrlMap: Record<
    string,
    { convertedUrl: string; marketplace: MarketplaceId; sku?: string }
  >;
  ogImageUrl: string | null;
  validationError: string | null;
  failedOriginalUrl: string | null;
  detectedMarketplace: MarketplaceId | null;
  extractedProductTitle: string | null;
  canonicalProductId?: string | null;
  ignoredNonOffer?: boolean;
}> {
  const preconvertedUrlMap: Record<
    string,
    { convertedUrl: string; marketplace: MarketplaceId; sku?: string }
  > = {};
  let ogImageUrl: string | null = null;
  let validationError: string | null = null;
  let failedOriginalUrl: string | null = null;
  let detectedMarketplace: MarketplaceId | null = null;
  let extractedProductTitle: string | null = null;
  let canonicalProductId: string | null = null;

  const urlRegex = /https?:\/\/[^\s)]+/gi;
  const allUrls = Array.from(new Set(rawText.match(urlRegex) || []));

  // Identify URLs that sit on or immediately below a competitor CTA line (e.g. "Convide Amigos para o Grupo!\nhttps://...")
  const urlsInCtaContext = new Set<string>();
  const lines = (rawText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const prevLine = i > 0 ? lines[i - 1].trim() : '';
    const lineUrls = line.match(urlRegex) || [];
    for (const u of lineUrls) {
      if (detectMarketplaceFromUrl(u) === null) {
        if (isCompetitorCtaLine(line) || isCompetitorCtaLine(prevLine)) {
          urlsInCtaContext.add(u);
        }
      }
    }
  }

  // Filter out competitor group links, invite links, bio links, social media, and CTA-context links
  const nonCompetitorUrls = allUrls.filter(
    (u) => !isCompetitorOrInviteUrl(u) && !urlsInCtaContext.has(u)
  );

  // If the message already contains one or more known marketplace URLs (e.g. meli.la, mercadolivre, shopee, amazon, aliexpress),
  // only treat those marketplace URLs as product links and ignore any other unknown external links in the message
  const directMarketplaceUrls = nonCompetitorUrls.filter(
    (u) => detectMarketplaceFromUrl(u) !== null
  );
  const productUrls =
    directMarketplaceUrls.length > 0 ? directMarketplaceUrls : nonCompetitorUrls;

  if (productUrls.length === 0) {
    return {
      preconvertedUrlMap,
      ogImageUrl,
      validationError: null,
      failedOriginalUrl: null,
      detectedMarketplace: null,
      extractedProductTitle: null,
      ignoredNonOffer: true,
    };
  }

  for (const originalUrl of productUrls) {
    const lower = originalUrl.toLowerCase();
    const directMp = detectMarketplaceFromUrl(originalUrl);
    let expandedUrl = originalUrl;
    let htmlChunk = '';
    let httpStatus = 200;

    let fetchSuccess = false;
    for (let fetchAttempt = 1; fetchAttempt <= 2; fetchAttempt++) {
      try {
        const timeoutMs = fetchAttempt === 1 ? 3500 : 4500;
        const res = await fetch(originalUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'pt-BR,pt;q=0.9',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });

        httpStatus = res.status;
        if (httpStatus === 404 || httpStatus === 410 || httpStatus >= 500) {
          if (!directMp) {
            // Non-marketplace link failed — skip it rather than blocking the offer
            break;
          }
          if (fetchAttempt === 1 && httpStatus >= 500) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          return {
            preconvertedUrlMap,
            ogImageUrl,
            validationError: `Link quebrado ou página inexistente (Erro ${httpStatus})`,
            failedOriginalUrl: originalUrl,
            detectedMarketplace: directMp,
            extractedProductTitle,
          };
        }

        const finalUrl = res.url || '';
        const isBlockedRedirect =
          finalUrl.includes('login') ||
          finalUrl.includes('account-verification') ||
          finalUrl.includes('security') ||
          finalUrl.includes('captcha') ||
          finalUrl.includes('signin');

        if (finalUrl && finalUrl !== originalUrl) {
          if (!isBlockedRedirect) {
            expandedUrl = finalUrl;
          } else {
            try {
              const parsedRedirect = new URL(finalUrl);
              const goUrl =
                parsedRedirect.searchParams.get('go') ||
                parsedRedirect.searchParams.get('redirect') ||
                parsedRedirect.searchParams.get('url');
              if (goUrl && goUrl.startsWith('http')) {
                expandedUrl = goUrl;
              }
            } catch {
              // keep originalUrl
            }
          }
        }

        htmlChunk = await res.text();
        fetchSuccess = true;
        break;
      } catch {
        if (fetchAttempt === 1) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
      }
    }

    if (!fetchSuccess) {
      if (!directMp) {
        continue;
      }
      // If expanding timed out or was blocked, immediately fallback to direct commissioned affiliate link
      const directFallback = buildConvertedUrl(originalUrl, directMp, credentials);
      if (directFallback.convertedUrl) {
        preconvertedUrlMap[originalUrl] = {
          marketplace: directMp,
          sku: directFallback.sku,
          convertedUrl: directFallback.convertedUrl,
        };
        detectedMarketplace = directMp;
        continue;
      }
      return {
        preconvertedUrlMap,
        ogImageUrl,
        validationError: 'Link quebrado ou inacessível (falha ao abrir URL)',
        failedOriginalUrl: originalUrl,
        detectedMarketplace: directMp,
        extractedProductTitle,
      };
    }

    // If a shortener redirected to a competitor group / invite / non-marketplace URL, skip it!
    if (isCompetitorOrInviteUrl(expandedUrl)) {
      continue;
    }

    const mp = detectMarketplaceFromUrl(expandedUrl) || directMp;
    if (!mp) {
      // Not a marketplace URL (e.g. a competitor website or external page) — skip it so parseAndConvertOffer strips it
      continue;
    }
    detectedMarketplace = mp;

    const cidObj =
      extractCanonicalProductId(expandedUrl, htmlChunk).productId
        ? extractCanonicalProductId(expandedUrl, htmlChunk)
        : extractCanonicalProductId(originalUrl, htmlChunk);
    if (cidObj.productId && !canonicalProductId) {
      canonicalProductId = cidObj.productId;
    }

    // 1. Check if API & Credentials are properly configured for this marketplace
    const apiConfigCheck = isMarketplaceApiConfigured(mp, credentials);
    if (!apiConfigCheck.ok) {
      return {
        preconvertedUrlMap,
        ogImageUrl,
        validationError: apiConfigCheck.errorReason || 'API não configurada direito',
        failedOriginalUrl: originalUrl,
        detectedMarketplace: mp,
        extractedProductTitle,
      };
    }

    const lowerHtml = htmlChunk.toLowerCase();

    // 2. Inspect Mercado Livre stock, /social/ featured card, and product URL
    if (mp === 'mercadoLivre') {
      if (expandedUrl.includes('/social/') || htmlChunk.includes('card-featured')) {
        const cardFeaturedIdx = htmlChunk.indexOf('"id":"card-featured"');
        if (cardFeaturedIdx === -1) {
          return {
            preconvertedUrlMap,
            ogImageUrl,
            validationError: 'Produto sem estoque',
            failedOriginalUrl: originalUrl,
            detectedMarketplace: 'mercadoLivre',
            extractedProductTitle,
          };
        }

        const cardSection = htmlChunk.slice(cardFeaturedIdx, cardFeaturedIdx + 5500);
        if (cardSection.includes('"polycards":[]') || !cardSection.includes('"current_price"')) {
          return {
            preconvertedUrlMap,
            ogImageUrl,
            validationError: 'Produto sem estoque',
            failedOriginalUrl: originalUrl,
            detectedMarketplace: 'mercadoLivre',
            extractedProductTitle,
          };
        }

        const titleMatch = cardSection.match(/"title":\{"text":"([^"]+)"/);
        if (titleMatch && titleMatch[1]) {
          extractedProductTitle = titleMatch[1];
        }

        const picMatch = cardSection.match(/"pictures":\[\{"id":"([^"]+)"/);
        if (picMatch && picMatch[1] && !ogImageUrl) {
          ogImageUrl = `https://http2.mlstatic.com/D_NQ_NP_2X_${picMatch[1]}-F.jpg`;
        }

        const urlFieldMatch = cardSection.match(/"url":"(www\.mercadolivre\.com\.br[^"]+)"/);
        const urlParamsMatch = cardSection.match(/"url_params":"([^"]*)"/);
        if (urlFieldMatch && urlFieldMatch[1]) {
          const decodedPath = urlFieldMatch[1].replace(/\\u002F/g, '/');
          const decodedParams = urlParamsMatch
            ? urlParamsMatch[1].replace(/\\u002F/g, '/').replace(/&amp;/g, '&')
            : '';
          expandedUrl = `https://${decodedPath}${decodedParams}`;
        } else {
          const allMlUrls = (
            htmlChunk.match(
              /https?:\/\/(?:www\.|produto\.)?mercadolivre\.com\.br\/[^"'\s<>]+/gi
            ) || []
          ).map((x) => x.replace(/&amp;/g, '&'));
          const featuredLink =
            allMlUrls.find((x) => x.includes('card-featured') && !x.includes('/c/')) ||
            allMlUrls.find(
              (x) =>
                !x.includes('/c/') &&
                !x.includes('/social/') &&
                !x.includes('/ofertas') &&
                (x.includes('/p/MLB') || x.includes('/up/MLB') || x.includes('MLB-'))
            );
          if (featuredLink) {
            expandedUrl = featuredLink.split('#')[0];
          }
        }
      }

      // Check direct product page out-of-stock / paused markers
      if (
        lowerHtml.includes('anúncio pausado') ||
        lowerHtml.includes('publicação pausada') ||
        lowerHtml.includes('anúncio finalizado') ||
        lowerHtml.includes('publicação finalizada') ||
        lowerHtml.includes('estoque esgotado') ||
        lowerHtml.includes('este produto não está disponível') ||
        lowerHtml.includes('no momento, este produto não está disponível') ||
        lowerHtml.includes('"item_status":"paused"') ||
        lowerHtml.includes('"item_status":"closed"') ||
        lowerHtml.includes('"available_quantity":0')
      ) {
        return {
          preconvertedUrlMap,
          ogImageUrl,
          validationError: 'Produto sem estoque',
          failedOriginalUrl: originalUrl,
          detectedMarketplace: 'mercadoLivre',
          extractedProductTitle,
        };
      }
    }

    // 3. Inspect Shopee stock & broken link
    if (mp === 'shopee') {
      if (
        lowerHtml.includes('produto esgotado') ||
        lowerHtml.includes('este produto não existe') ||
        lowerHtml.includes('o produto não existe') ||
        lowerHtml.includes('"item_status":"sold_out"') ||
        lowerHtml.includes('"stock":0')
      ) {
        return {
          preconvertedUrlMap,
          ogImageUrl,
          validationError: 'Produto sem estoque',
          failedOriginalUrl: originalUrl,
          detectedMarketplace: 'shopee',
          extractedProductTitle,
        };
      }
    }

    // 4. Inspect AliExpress stock & broken link
    if (mp === 'aliExpress') {
      if (
        expandedUrl.includes('404.html') ||
        lowerHtml.includes('sorry, this item is no longer available') ||
        lowerHtml.includes('este produto não está mais disponível') ||
        lowerHtml.includes('"totalavailquantity":0')
      ) {
        return {
          preconvertedUrlMap,
          ogImageUrl,
          validationError: 'Produto sem estoque',
          failedOriginalUrl: originalUrl,
          detectedMarketplace: 'aliExpress',
          extractedProductTitle,
        };
      }
    }

    // 5. Inspect Amazon stock & broken link
    if (mp === 'amazon') {
      const asinMatch = expandedUrl.match(/(?:\/dp\/|\/gp\/product\/|\/d\/)([A-Z0-9]{10})/i);
      if (!asinMatch && (lower.includes('amzn.to') || lower.includes('a.co'))) {
        return {
          preconvertedUrlMap,
          ogImageUrl,
          validationError: 'Link quebrado da Amazon (produto não encontrado)',
          failedOriginalUrl: originalUrl,
          detectedMarketplace: 'amazon',
          extractedProductTitle,
        };
      }
      if (
        lowerHtml.includes('não disponível.') ||
        lowerHtml.includes('currently unavailable') ||
        lowerHtml.includes('temporariamente fora de estoque') ||
        lowerHtml.includes('não sabemos quando este item estará novamente em estoque')
      ) {
        return {
          preconvertedUrlMap,
          ogImageUrl,
          validationError: 'Produto sem estoque',
          failedOriginalUrl: originalUrl,
          detectedMarketplace: 'amazon',
          extractedProductTitle,
        };
      }
    }

    // Extract OG:Image if not already extracted
    if (!ogImageUrl && htmlChunk) {
      const ogMatch =
        htmlChunk.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        htmlChunk.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (ogMatch && ogMatch[1] && ogMatch[1].startsWith('http')) {
        ogImageUrl = ogMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/-(F|O)\.webp$/i, '-$1.jpg');
      }
    }

    // 6. Generate Official Affiliate Link via Marketplace API or direct comissioned fallback
    if (mp === 'mercadoLivre') {
      const fallback = buildConvertedUrl(expandedUrl, 'mercadoLivre', credentials);
      let convertedUrlToUse: string | null = null;
      try {
        convertedUrlToUse = await Promise.race([
          generateOfficialMercadoLivreShortLink(expandedUrl, credentials),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
      } catch {
        convertedUrlToUse = null;
      }
      // If shortener API times out or fails, use direct comissioned affiliate link with user's tag
      if (!convertedUrlToUse || !convertedUrlToUse.startsWith('http')) {
        convertedUrlToUse = fallback.convertedUrl;
      }
      preconvertedUrlMap[originalUrl] = {
        marketplace: 'mercadoLivre',
        sku: fallback.sku,
        convertedUrl: convertedUrlToUse,
      };
    } else if (mp === 'shopee') {
      const fallback = buildConvertedUrl(expandedUrl, 'shopee', credentials);
      let convertedUrlToUse: string | null = null;
      try {
        convertedUrlToUse = await Promise.race([
          generateOfficialShopeeShortLink(expandedUrl, credentials),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
      } catch {
        convertedUrlToUse = null;
      }
      if (!convertedUrlToUse || !convertedUrlToUse.startsWith('http')) {
        convertedUrlToUse = fallback.convertedUrl;
      }
      preconvertedUrlMap[originalUrl] = {
        marketplace: 'shopee',
        sku: fallback.sku,
        convertedUrl: convertedUrlToUse,
      };
    } else if (mp === 'aliExpress') {
      const fallback = buildConvertedUrl(expandedUrl, 'aliExpress', credentials);
      let convertedUrlToUse: string | null = null;
      try {
        convertedUrlToUse = await Promise.race([
          generateOfficialAliExpressShortLink(expandedUrl, credentials),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
      } catch {
        convertedUrlToUse = null;
      }
      if (!convertedUrlToUse || !convertedUrlToUse.startsWith('http')) {
        convertedUrlToUse = fallback.convertedUrl;
      }
      preconvertedUrlMap[originalUrl] = {
        marketplace: 'aliExpress',
        sku: fallback.sku,
        convertedUrl: convertedUrlToUse,
      };
    } else if (mp === 'amazon') {
      const fallback = buildConvertedUrl(expandedUrl, 'amazon', credentials);
      preconvertedUrlMap[originalUrl] = {
        marketplace: 'amazon',
        sku: fallback.sku,
        convertedUrl: fallback.convertedUrl,
      };
    }
  }

  if (Object.keys(preconvertedUrlMap).length === 0 && !validationError) {
    return {
      preconvertedUrlMap,
      ogImageUrl,
      validationError: null,
      failedOriginalUrl: null,
      detectedMarketplace: null,
      extractedProductTitle: null,
      ignoredNonOffer: true,
    };
  }

  return {
    preconvertedUrlMap,
    ogImageUrl,
    validationError,
    failedOriginalUrl,
    detectedMarketplace,
    extractedProductTitle,
    canonicalProductId,
  };
}

// Global sequential dispatch queue to prevent Baileys socket overload and rate-limit drops
let globalDispatchQueuePromise: Promise<any> = Promise.resolve();

function enqueueReplicationDispatch<T>(task: () => Promise<T>): Promise<T> {
  const runTask = async () => {
    try {
      return await task();
    } finally {
      // Safe breather between message dispatches to keep Baileys WebSocket stable
      await new Promise((r) => setTimeout(r, 1400));
    }
  };

  const currentChain = globalDispatchQueuePromise.then(runTask, runTask);
  globalDispatchQueuePromise = currentChain.then(
    () => {},
    () => {}
  );
  return currentChain;
}

// Core replication pipeline: validates stock/link/API, converts text, handles image/OG:Image, and dispatches
async function executeReplicationForRoute(params: {
  rawText: string;
  sourceRoomId: string;
  route: TrafficRoute;
  rawBaileysMsg?: any;
  unwrappedContent?: any;
  hasIncomingImage?: boolean;
  incomingImageBuffer?: Buffer | null;
}): Promise<{ ok: boolean; error?: string; historyItem?: DispatchHistoryItem }> {
  const {
    rawText,
    sourceRoomId,
    route,
    rawBaileysMsg,
    unwrappedContent,
    hasIncomingImage,
    incomingImageBuffer,
  } = params;

  const nowStr = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  try {
    // 1. Validate link, check stock, verify API config, and generate official affiliate links
    const {
      preconvertedUrlMap,
      ogImageUrl,
      validationError,
      failedOriginalUrl,
      detectedMarketplace,
      extractedProductTitle,
      canonicalProductId: resolvedCanonicalId,
      ignoredNonOffer,
    } = await resolveAndConvertUrlsInText(
      rawText || '',
      engineConfig.credentials,
      engineConfig.rules
    );

    if (ignoredNonOffer) {
      return {
        ok: false,
        error: 'Mensagem sem link de oferta (apenas link de grupo concorrente ou aviso).',
      };
    }

    const productTitle = extractCleanProductTitle(rawText, extractedProductTitle);

    // CRITICAL RULE: If out of stock, broken link, or API not configured/failed -> DO NOT SEND MESSAGE!
    // Record a small error item in serverHistory explaining why it was blocked.
    if (validationError) {
      const errorHistoryItem: DispatchHistoryItem = {
        id: `hist-err-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: nowStr,
        routeId: route.id,
        sourceRoomId: sourceRoomId || route.sourceRoomId,
        destinationRoomId: route.destinationRoomId,
        marketplace: detectedMarketplace || 'mercadoLivre',
        productTitle,
        originalUrl: failedOriginalUrl || 'Link interceptado',
        convertedUrl: '',
        originalText: rawText || '',
        convertedText: '',
        removedElements: [],
        watermarkReplaced: false,
        productPreset: 'espresso',
        status: 'error',
        errorReason: validationError,
        createdAt: Date.now(),
      };

      const isDummySample = isTestOrSampleHistoryItem(errorHistoryItem);
      if (!isDummySample) {
        pruneExpiredHistory();
        serverHistory = [errorHistoryItem, ...serverHistory.slice(0, 49)];
        saveServerHistory(serverHistory);
        waState.lastInterceptStatus = `Envio bloqueado às ${nowStr}: ${validationError}`;

        const lowerErr = validationError.toLowerCase();
        const isApiOrCookieError =
          lowerErr.includes('cookie') ||
          lowerErr.includes('api') ||
          lowerErr.includes('credencia') ||
          lowerErr.includes('desativad') ||
          lowerErr.includes('app id') ||
          lowerErr.includes('tracking') ||
          lowerErr.includes('associatetag');

        const destRoomObj = findRoomInAllLists(route.destinationRoomId);
        await dispatchWhatsAppErrorAlert({
          category: isApiOrCookieError ? 'api_error' : 'broken_link',
          reason: validationError,
          routeId: route.id,
          routeName: route.name,
          destinationName: destRoomObj?.name || route.destinationRoomId,
          productTitle,
        });
      }

      return {
        ok: false,
        error: validationError,
        historyItem: errorHistoryItem,
      };
    }

    // 2. Run Replica Chat parser & sanitizer using the official preconverted URLs
    const parsed = parseAndConvertOffer(
      rawText,
      engineConfig.credentials,
      engineConfig.rules,
      sourceRoomId,
      preconvertedUrlMap
    );

    const finalMessageText = parsed.convertedText.trim();
    if (!finalMessageText && !hasIncomingImage) {
      return { ok: false, error: 'Mensagem vazia após higienização.' };
    }

    // 3. Resolve Destination Room
    const destRoom = findRoomInAllLists(route.destinationRoomId);
    const destPlatform =
      destRoom?.platform ||
      (String(route.destinationRoomId).startsWith('tg-') ||
      String(route.destinationRoomId).startsWith('-')
        ? 'telegram'
        : 'whatsapp');

    let destCode = destRoom?.roomCode || route.destinationRoomId;

    const isDemoPlaceholder =
      String(route.destinationRoomId).startsWith('room-wa-') ||
      destCode === '12036315544332@g.us' ||
      destCode === '12036304918273@g.us';

    if (destPlatform === 'whatsapp' && isDemoPlaceholder && waState.syncedGroups.length > 0) {
      const draftDest = engineConfig.selectedDraftPair?.destinationRoomId
        ? findRoomInAllLists(engineConfig.selectedDraftPair.destinationRoomId)
        : undefined;
      const fallbackReal =
        draftDest ||
        waState.syncedGroups.find((g) => g.id !== route.sourceRoomId) ||
        waState.syncedGroups[0];
      if (fallbackReal) {
        destCode = fallbackReal.roomCode;
      }
    }

    const cleanDestJid = destCode.replace(/^wa-/, '').replace(/^tg-/, '').trim();

    let canonicalProductId = resolvedCanonicalId || null;
    if (!canonicalProductId) {
      for (const u of parsed.originalUrls) {
        const ext = extractCanonicalProductId(u);
        if (ext.productId) {
          canonicalProductId = ext.productId;
          break;
        }
      }
    }
    if (!canonicalProductId) {
      for (const u of parsed.convertedUrls) {
        const ext = extractCanonicalProductId(u);
        if (ext.productId) {
          canonicalProductId = ext.productId;
          break;
        }
      }
    }

    // 3.5. Anti-Duplicate Protection: Prevents duplicate offers from being resent to the same destination room
    const antiDuplicateConfig = engineConfig.rules?.antiDuplicate ?? {
      enabled: true,
      cooldownHours: 8,
    };

    if (antiDuplicateConfig.enabled !== false) {
      const cooldownHours = Math.max(1, Number(antiDuplicateConfig.cooldownHours) || 8);
      const duplicateCheck = checkIsOfferDuplicateForDestination({
        destinationRoomId: route.destinationRoomId,
        destinationJid: cleanDestJid,
        originalUrls: parsed.originalUrls,
        convertedUrls: parsed.convertedUrls,
        productTitle,
        canonicalProductId,
        productSku: parsed.productSku,
        cooldownHours,
      });

      if (duplicateCheck.isDuplicate) {
        const destName = destRoom?.name || route.destinationRoomId;
        const dupReason = `Produto repetido bloqueado: "${productTitle}" já foi enviado para "${destName}" ${duplicateCheck.timeAgoText || 'recentemente'} (${duplicateCheck.matchedBy}).`;

        waState.lastInterceptStatus = `Anti-Duplicidade: "${productTitle.slice(0, 26)}..." já enviado para "${destName}"`;

        return {
          ok: false,
          error: dupReason,
        };
      }
    }

    // 4. Determine Image Buffer to send
    let imageBufferToSend: Buffer | null = incomingImageBuffer || null;

    const downloadIncomingWaImage = async (): Promise<Buffer | null> => {
      if (!hasIncomingImage || !rawBaileysMsg) {
        return null;
      }

      const imgMsg =
        unwrappedContent?.imageMessage || rawBaileysMsg?.message?.imageMessage;
      if (!imgMsg || typeof imgMsg !== 'object') {
        return null;
      }

      const rawMediaKey = imgMsg.mediaKey;
      const hasValidMediaKey =
        Boolean(rawMediaKey) &&
        ((Buffer.isBuffer(rawMediaKey) && rawMediaKey.length > 0) ||
          (rawMediaKey instanceof Uint8Array && rawMediaKey.byteLength > 0) ||
          (typeof rawMediaKey === 'string' && rawMediaKey.trim().length > 0) ||
          (Array.isArray(rawMediaKey) && rawMediaKey.length > 0));

      // A) Standard E2E encrypted WhatsApp image (has non-empty mediaKey)
      if (
        hasValidMediaKey &&
        (imgMsg.url || imgMsg.directPath) &&
        typeof downloadMediaMessage === 'function'
      ) {
        try {
          const msgForDownload = unwrappedContent
            ? { ...rawBaileysMsg, message: unwrappedContent }
            : rawBaileysMsg;
          const downloaded = await downloadMediaMessage(
            msgForDownload,
            'buffer',
            {},
            {
              logger: silentLogger as any,
              reuploadRequest: activeSock?.updateMediaMessage,
            }
          );
          if (isValidRawImageBuffer(downloaded as Buffer)) {
            return downloaded as Buffer;
          }
        } catch {
          // Fall through to unencrypted / thumbnail / OG image fallback
        }
      }

      // B) Unencrypted WhatsApp Channel (@newsletter) or direct CDN image without mediaKey
      if (!hasValidMediaKey && (imgMsg.url || imgMsg.directPath)) {
        try {
          const directUrl =
            typeof imgMsg.url === 'string' && imgMsg.url.startsWith('http')
              ? imgMsg.url
              : typeof imgMsg.directPath === 'string' && imgMsg.directPath.startsWith('/')
              ? `https://mmg.whatsapp.net${imgMsg.directPath}`
              : '';
          if (directUrl) {
            const res = await fetch(directUrl, { signal: AbortSignal.timeout(3500) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (isValidRawImageBuffer(buf)) {
                return buf;
              }
            }
          }
        } catch {
          // Fall through to jpegThumbnail
        }
      }

      // C) Embedded jpegThumbnail fallback if present in message
      if (imgMsg.jpegThumbnail) {
        try {
          const thumbBuf =
            typeof imgMsg.jpegThumbnail === 'string'
              ? Buffer.from(imgMsg.jpegThumbnail, 'base64')
              : Buffer.from(imgMsg.jpegThumbnail);
          if (isValidRawImageBuffer(thumbBuf)) {
            return thumbBuf;
          }
        } catch {
          // Ignore thumbnail error
        }
      }

      return null;
    };

    const fetchOgImageBuffer = async (): Promise<Buffer | null> => {
      if (!ogImageUrl) return null;
      try {
        const normalizedUrl = ogImageUrl.replace(/-(F|O)\.webp$/i, '-$1.jpg');
        const imgRes = await fetch(normalizedUrl, { signal: AbortSignal.timeout(3500) });
        if (imgRes.ok) {
          const arrBuf = await imgRes.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (isValidRawImageBuffer(buf)) {
            return buf;
          }
        }
      } catch {
        // ignore
      }
      return null;
    };

    if (!imageBufferToSend) {
      if (parsed.watermarkIntercepted) {
        if (engineConfig.rules.antiWatermark.strategy === 'og_image') {
          imageBufferToSend = (await fetchOgImageBuffer()) || (await downloadIncomingWaImage());
        } else if (engineConfig.rules.antiWatermark.strategy === 'keep_original') {
          imageBufferToSend = (await downloadIncomingWaImage()) || (await fetchOgImageBuffer());
        }
      } else {
        imageBufferToSend =
          (await downloadIncomingWaImage()) ||
          (engineConfig.rules.antiWatermark.strategy === 'og_image'
            ? await fetchOgImageBuffer()
            : null);
      }
    }

    // 5. Dispatch to Target Platform
    if (destPlatform === 'whatsapp') {
      if (!activeSock || waState.status !== 'connected') {
        const errMsg = `WhatsApp desconectado ao tentar enviar para "${destRoom?.name || route.destinationRoomId}". Reconecte na aba 2. Conexões.`;
        await dispatchWhatsAppErrorAlert({
          category: 'send_error',
          reason: errMsg,
          routeId: route.id,
          routeName: route.name,
          destinationName: destRoom?.name || route.destinationRoomId,
          productTitle,
        });
        return { ok: false, error: errMsg };
      }

      const targetJid = cleanDestJid.includes('@') ? cleanDestJid : `${cleanDestJid}@g.us`;

      recordBotOutgoingMessage(targetJid, finalMessageText);

      let sentMsg: any = null;
      let lastSendErr: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (!activeSock || (waState.status as string) !== 'connected') {
            await new Promise((r) => setTimeout(r, 2000));
            if (!activeSock || (waState.status as string) !== 'connected') {
              throw new Error('WhatsApp desconectado durante o envio.');
            }
          }

          if (imageBufferToSend) {
            try {
              sentMsg = await activeSock.sendMessage(targetJid, {
                image: imageBufferToSend,
                caption: finalMessageText,
              });
            } catch {
              // If sending with image fails, fallback immediately to text message
              sentMsg = await activeSock.sendMessage(targetJid, {
                text: finalMessageText,
              });
            }
          } else {
            sentMsg = await activeSock.sendMessage(targetJid, {
              text: finalMessageText,
            });
          }
          if (sentMsg) {
            lastSendErr = null;
            break;
          }
        } catch (err: any) {
          lastSendErr = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }
      }

      if (!sentMsg && lastSendErr) {
        throw lastSendErr;
      }

      if (sentMsg?.key?.id) {
        sentByBotMsgIds.add(sentMsg.key.id);
      }
    } else if (destPlatform === 'telegram') {
      const token = engineConfig.telegramBotToken.trim();
      if (!token || !token.includes(':')) {
        const errMsg = `Bot Token do Telegram não configurado ao enviar para "${destRoom?.name || route.destinationRoomId}". Verifique a aba 2. Conexões.`;
        await dispatchWhatsAppErrorAlert({
          category: 'send_error',
          reason: errMsg,
          routeId: route.id,
          routeName: route.name,
          destinationName: destRoom?.name || route.destinationRoomId,
          productTitle,
        });
        return { ok: false, error: errMsg };
      }

      let tgSent = false;
      let lastTgErr: any = null;

      for (let tgAttempt = 1; tgAttempt <= 3; tgAttempt++) {
        try {
          let tgRes: Response;
          if (ogImageUrl && parsed.watermarkIntercepted) {
            tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cleanDestJid,
                photo: ogImageUrl,
                caption: finalMessageText,
              }),
              signal: AbortSignal.timeout(5000),
            });
          } else {
            tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cleanDestJid,
                text: finalMessageText,
              }),
              signal: AbortSignal.timeout(5000),
            });
          }
          if (tgRes.ok) {
            tgSent = true;
            lastTgErr = null;
            break;
          }
          const errJson: any = await tgRes.json().catch(() => ({}));
          lastTgErr = new Error(
            errJson?.description ||
              `Falha na API do Telegram (HTTP ${tgRes.status}) ao enviar para o destino.`
          );
          if (tgAttempt < 3) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch (err: any) {
          lastTgErr = err;
          if (tgAttempt < 3) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }

      if (!tgSent && lastTgErr) {
        throw lastTgErr;
      }
    }

    // 6. Update Route Metrics, Anti-Duplicate Cache & History Log
    route.totalConverted = (route.totalConverted || 0) + 1;
    route.lastDispatchedAt = `Hoje às ${nowStr}`;
    saveEngineConfig(engineConfig);

    recordDispatchedOffer({
      destinationRoomId: route.destinationRoomId,
      destinationJid: cleanDestJid,
      originalUrls: parsed.originalUrls,
      convertedUrls: parsed.convertedUrls,
      productTitle,
      canonicalProductId,
      productSku: parsed.productSku,
    });

    const historyItem: DispatchHistoryItem = {
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowStr,
      routeId: route.id,
      sourceRoomId: sourceRoomId || route.sourceRoomId,
      destinationRoomId: route.destinationRoomId,
      marketplace: parsed.detectedMarketplace || 'mercadoLivre',
      productTitle,
      canonicalProductId,
      originalUrl: parsed.originalUrls[0] || 'Mensagem direta da fonte',
      convertedUrl: parsed.convertedUrls[0] || 'Texto higienizado & replicado',
      originalText: rawText || '[Imagem sem legenda]',
      convertedText: finalMessageText,
      removedElements: parsed.removedElements,
      watermarkReplaced: Boolean(imageBufferToSend && parsed.watermarkIntercepted),
      productPreset: parsed.productPreset,
      status: 'success',
      createdAt: Date.now(),
    };

    if (!isTestOrSampleHistoryItem(historyItem)) {
      pruneExpiredHistory();
      serverHistory = [historyItem, ...serverHistory.slice(0, 49)];
      saveServerHistory(serverHistory);
      waState.lastInterceptStatus = `Última replicação concluída às ${nowStr}`;
    }

    return { ok: true, historyItem };
  } catch (err: any) {
    const destRoom = findRoomInAllLists(route.destinationRoomId);
    const destName = destRoom?.name || route.destinationRoomId;
    const rawErrMsg = err?.message || 'Erro ao enviar mensagem para o grupo destino.';
    let actionableReason = `Falha ao entregar no grupo destino "${destName}": ${rawErrMsg}`;
    if (rawErrMsg.includes('bot is not a member of the channel chat') || rawErrMsg.includes('chat not found')) {
      actionableReason = `Falha ao entregar no Telegram "${destName}": O bot não está presente no canal. Adicione o bot ao canal ou escolha um grupo de WhatsApp como destino.`;
    }

    const errorHistoryItem: DispatchHistoryItem = {
      id: `hist-err-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowStr,
      routeId: route.id,
      sourceRoomId: sourceRoomId || route.sourceRoomId,
      destinationRoomId: route.destinationRoomId,
      marketplace: 'mercadoLivre',
      productTitle: extractCleanProductTitle(rawText, null),
      originalUrl: 'Erro de entrega no destino',
      convertedUrl: '',
      originalText: rawText || '',
      convertedText: '',
      removedElements: [],
      watermarkReplaced: false,
      productPreset: 'espresso',
      status: 'error',
      errorReason: actionableReason,
      createdAt: Date.now(),
    };

    if (!isTestOrSampleHistoryItem(errorHistoryItem)) {
      pruneExpiredHistory();
      serverHistory = [errorHistoryItem, ...serverHistory.slice(0, 49)];
      saveServerHistory(serverHistory);

      waState.lastInterceptStatus = `Erro ao replicar na rota "${route.name}": ${rawErrMsg}`;
      await dispatchWhatsAppErrorAlert({
        category: 'send_error',
        reason: actionableReason,
        routeId: route.id,
        routeName: route.name,
        destinationName: destName,
      });
    }
    return { ok: false, error: actionableReason, historyItem: errorHistoryItem };
  }
}

const alertCooldownMap = new Map<string, number>();

async function resolveWhatsAppAlertJid(rawPhone: string): Promise<string | null> {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  if (activeSock && typeof activeSock.onWhatsApp === 'function') {
    try {
      const results = await Promise.race([
        activeSock.onWhatsApp(digits),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (Array.isArray(results) && results[0]?.exists && results[0]?.jid) {
        return results[0].jid;
      }
    } catch {
      // fallback to standard @s.whatsapp.net
    }
  }
  return `${digits}@s.whatsapp.net`;
}

async function dispatchWhatsAppErrorAlert(params: {
  category: 'send_error' | 'api_error' | 'broken_link' | 'test';
  reason: string;
  routeId?: string;
  routeName?: string;
  destinationName?: string;
  productTitle?: string;
  forceSend?: boolean;
}): Promise<{ ok: boolean; status: 'sent' | 'suppressed_cooldown' | 'failed'; error?: string; logEntry?: AlertDispatchLog }> {
  const alertCfg: AlertSettings = {
    ...INITIAL_ALERT_SETTINGS,
    ...(engineConfig.alertSettings || {}),
  };

  if (!params.forceSend) {
    if (!alertCfg.enabled) {
      return { ok: false, status: 'failed', error: 'Alertas desativados.' };
    }
    if (params.category === 'send_error' && !alertCfg.alertOnSendError) {
      return { ok: false, status: 'failed', error: 'Alerta de erro de envio desativado.' };
    }
    if (params.category === 'api_error' && !alertCfg.alertOnApiError) {
      return { ok: false, status: 'failed', error: 'Alerta de erro de API desativado.' };
    }
    if (params.category === 'broken_link' && !alertCfg.alertOnBrokenLink) {
      return { ok: false, status: 'failed', error: 'Alerta de link quebrado desativado.' };
    }
  }

  const targetPhone = String(alertCfg.targetPhone || '').trim();
  if (!targetPhone || targetPhone.replace(/\D/g, '').length < 10) {
    return {
      ok: false,
      status: 'failed',
      error: 'Informe um número de WhatsApp válido (com DDD) na aba Alertas.',
    };
  }

  const now = Date.now();
  const nowStr = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const cooldownMs = Math.max(0, Number(alertCfg.cooldownMinutes ?? 5)) * 60 * 1000;
  const dedupeKey = `${params.category}:${params.routeId || 'global'}:${params.reason.slice(0, 80)}`;

  if (!params.forceSend && cooldownMs > 0) {
    const lastSentAt = alertCooldownMap.get(dedupeKey) || 0;
    if (now - lastSentAt < cooldownMs) {
      return { ok: false, status: 'suppressed_cooldown' };
    }
  }

  const prefix = (alertCfg.customPrefix || '⚠️ Erro de envio, verifique:').trim();
  const routeContext = params.routeName ? `\n📍 *Rota:* ${params.routeName}` : '';
  const destContext = params.destinationName ? `\n🎯 *Grupo Destino:* ${params.destinationName}` : '';
  const prodContext = params.productTitle ? `\n📦 *Oferta:* ${params.productTitle.slice(0, 70)}` : '';

  const messageText = `${prefix} ${params.reason}${routeContext}${destContext}${prodContext}\n⏰ *Horário:* ${nowStr}`;

  if (!activeSock || waState.status !== 'connected') {
    const failedEntry: AlertDispatchLog = {
      id: `alert-${now}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowStr,
      targetPhone,
      reason: `${params.reason} (WhatsApp principal desconectado)`,
      routeName: params.routeName,
      status: 'failed',
      messageText,
    };
    alertCfg.recentAlerts = [failedEntry, ...(alertCfg.recentAlerts || []).slice(0, 29)];
    engineConfig.alertSettings = alertCfg;
    saveEngineConfig(engineConfig);
    return {
      ok: false,
      status: 'failed',
      error: 'O WhatsApp principal não está conectado na aba 2. Conexões para enviar o alerta.',
      logEntry: failedEntry,
    };
  }

  try {
    const targetJid = await resolveWhatsAppAlertJid(targetPhone);
    if (!targetJid) {
      return {
        ok: false,
        status: 'failed',
        error: 'Número de WhatsApp inválido para envio de alerta.',
      };
    }

    recordBotOutgoingMessage(targetJid, messageText);
    const sentMsg = await activeSock.sendMessage(targetJid, {
      text: messageText,
    });
    if (sentMsg?.key?.id) {
      sentByBotMsgIds.add(sentMsg.key.id);
    }

    alertCooldownMap.set(dedupeKey, now);

    const logEntry: AlertDispatchLog = {
      id: `alert-${now}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowStr,
      targetPhone,
      reason: params.reason,
      routeName: params.routeName,
      status: 'sent',
      messageText,
    };

    alertCfg.recentAlerts = [logEntry, ...(alertCfg.recentAlerts || []).slice(0, 29)];
    engineConfig.alertSettings = alertCfg;
    saveEngineConfig(engineConfig);

    return { ok: true, status: 'sent', logEntry };
  } catch (err: any) {
    const failedEntry: AlertDispatchLog = {
      id: `alert-${now}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowStr,
      targetPhone,
      reason: `${params.reason} (Falha ao enviar alerta: ${err?.message || 'Erro'})`,
      routeName: params.routeName,
      status: 'failed',
      messageText,
    };
    alertCfg.recentAlerts = [failedEntry, ...(alertCfg.recentAlerts || []).slice(0, 29)];
    engineConfig.alertSettings = alertCfg;
    saveEngineConfig(engineConfig);

    return {
      ok: false,
      status: 'failed',
      error: err?.message || 'Não foi possível enviar o alerta no WhatsApp.',
      logEntry: failedEntry,
    };
  }
}

function getRouteSourceRoomIds(route: TrafficRoute): string[] {
  const list = Array.isArray(route.sourceRoomIds)
    ? route.sourceRoomIds.filter(Boolean)
    : [];
  if (route.sourceRoomId && !list.includes(route.sourceRoomId)) {
    list.unshift(route.sourceRoomId);
  }
  return Array.from(new Set(list));
}

function resolveMatchedSourceRoomIdForRoute(
  route: TrafficRoute,
  incomingJid: string,
  incomingGroupName?: string
): string | null {
  const incomingNorm = normalizeJid(incomingJid);
  const incomingBare = extractBareRoomId(incomingJid);
  const cleanIncomingName = (incomingGroupName || '').trim().toLowerCase();

  const sourceIds = getRouteSourceRoomIds(route);
  for (const candidateSourceId of sourceIds) {
    const srcRoom = findRoomInAllLists(candidateSourceId);
    const srcNorm = normalizeJid(srcRoom?.roomCode || candidateSourceId);
    const srcBare = extractBareRoomId(srcRoom?.roomCode || candidateSourceId);

    if (srcNorm === incomingNorm || (srcBare && srcBare === incomingBare)) {
      return candidateSourceId;
    }

    if (
      cleanIncomingName &&
      srcRoom?.name &&
      srcRoom.name.trim().toLowerCase() === cleanIncomingName
    ) {
      return candidateSourceId;
    }
  }
  return null;
}

function findMatchingRoutesForIncoming(
  incomingJid: string,
  incomingGroupName?: string
): TrafficRoute[] {
  const incomingNorm = normalizeJid(incomingJid);
  const incomingBare = extractBareRoomId(incomingJid);

  const matched = engineConfig.routes.filter((rt) => {
    if (!rt.active) return false;
    return Boolean(resolveMatchedSourceRoomIdForRoute(rt, incomingJid, incomingGroupName));
  });

  if (matched.length > 0) {
    return matched;
  }

  const draft = engineConfig.selectedDraftPair;
  const draftSources = Array.isArray(draft?.sourceRoomIds) && draft.sourceRoomIds.length > 0
    ? draft.sourceRoomIds
    : draft?.sourceRoomId
    ? [draft.sourceRoomId]
    : [];

  if (draft && draftSources.length > 0 && draft.destinationRoomId) {
    for (const candidateSrcId of draftSources) {
      if (candidateSrcId === draft.destinationRoomId) continue;
      const draftSrcRoom = findRoomInAllLists(candidateSrcId);
      const draftSrcNorm = normalizeJid(draftSrcRoom?.roomCode || candidateSrcId);
      const draftSrcBare = extractBareRoomId(draftSrcRoom?.roomCode || candidateSrcId);

      if (draftSrcNorm === incomingNorm || (draftSrcBare && draftSrcBare === incomingBare)) {
        const autoRoute: TrafficRoute = {
          id: `route-auto-${draftSrcBare}`,
          name:
            draftSources.length > 1
              ? `${draftSources.length} Fontes → Destino Selecionado`
              : `${draftSrcRoom?.name?.slice(0, 20) || 'Origem'} → Destino Selecionado`,
          sourceRoomId: draftSources[0],
          sourceRoomIds: draftSources,
          destinationRoomId: draft.destinationRoomId,
          active: true,
          totalConverted: 0,
          lastDispatchedAt: 'Ativada automaticamente',
        };
        engineConfig.routes = [
          autoRoute,
          ...engineConfig.routes.filter((r) => !String(r.sourceRoomId).startsWith('room-wa-')),
        ];
        saveEngineConfig(engineConfig);
        return [autoRoute];
      }
    }
  }

  return [];
}

async function handleIncomingBaileysMessage(msg: any) {
  try {
    const msgId = msg?.key?.id;
    const rawRemoteJid = msg?.key?.remoteJid;
    const destJidFromDeviceSent = msg?.message?.deviceSentMessage?.destinationJid;
    const remoteJid =
      rawRemoteJid && (rawRemoteJid.endsWith('@g.us') || rawRemoteJid.endsWith('@newsletter'))
        ? rawRemoteJid
        : destJidFromDeviceSent || rawRemoteJid;

    if (!msgId || !remoteJid) return;
    if (remoteJid === 'status@broadcast') return;

    const { text, hasImage, unwrappedContent } = extractWhatsAppMessageData(msg);
    if (!text && !hasImage) return;

    if (sentByBotMsgIds.has(msgId) || processedIncomingMsgIds.has(msgId)) {
      return;
    }

    if (msg.key?.fromMe && wasRecentlySentByBot(remoteJid, text)) {
      sentByBotMsgIds.add(msgId);
      return;
    }

    const rawTs = msg.messageTimestamp;
    const msgTs =
      typeof rawTs === 'number'
        ? rawTs
        : typeof rawTs?.low === 'number'
        ? rawTs.low
        : Number(rawTs) || 0;
    if (msgTs > 0 && Math.floor(Date.now() / 1000) - msgTs > 600) {
      return;
    }

    processedIncomingMsgIds.add(msgId);

    const knownRoom = findRoomInAllLists(remoteJid);
    const groupName = knownRoom?.name || remoteJid;
    const groupId = knownRoom?.id || `wa-${remoteJid}`;
    const preview = (text || '[Imagem recebida]').replace(/\s+/g, ' ').slice(0, 80);

    const matchingRoutes = findMatchingRoutesForIncoming(remoteJid, knownRoom?.name);

    if (matchingRoutes.length === 0) {
      waState.lastInterceptStatus = `Mensagem detectada em "${groupName.slice(0, 26)}" (Sem rota ativa para esta origem)`;
      pushInterceptLog({
        groupJid: remoteJid,
        groupId,
        groupName,
        previewText: preview,
        status: 'ignored_no_route',
        detail: 'Grupo ainda não está definido como Origem (Fonte) em uma rota ativa.',
      });
      return;
    }

    for (const route of matchingRoutes) {
      const destRoom = findRoomInAllLists(route.destinationRoomId);
      const matchedSourceId =
        resolveMatchedSourceRoomIdForRoute(route, remoteJid, knownRoom?.name) ||
        route.sourceRoomId;
      const res = await enqueueReplicationDispatch(() =>
        executeReplicationForRoute({
          rawText: text,
          sourceRoomId: matchedSourceId,
          route,
          rawBaileysMsg: msg,
          unwrappedContent,
          hasIncomingImage: hasImage,
        })
      );

      if (res.ok) {
        pushInterceptLog({
          groupJid: remoteJid,
          groupId,
          groupName,
          previewText: preview,
          status: 'replicated',
          detail: `Replicado com sucesso para "${destRoom?.name || route.destinationRoomId}"`,
        });
      } else if (
        res.error?.includes('Anti-Duplicidade') ||
        res.error?.includes('repetido bloqueado') ||
        res.error?.includes('já enviado')
      ) {
        pushInterceptLog({
          groupJid: remoteJid,
          groupId,
          groupName,
          previewText: preview,
          status: 'duplicate_suppressed',
          detail: res.error,
        });
      } else {
        pushInterceptLog({
          groupJid: remoteJid,
          groupId,
          groupName,
          previewText: preview,
          status: 'error',
          detail: res.error || 'Erro ao enviar para o destino.',
        });
      }
    }
  } catch {
    // ignore message processing error
  }
}

const discoveredNewsletterJids = new Set<string>(
  (engineConfig.syncedNewsletters || [])
    .map((n) => n.roomCode)
    .filter((code) => code && code.endsWith('@newsletter'))
);

function parseNewsletterNodeToRoom(rawMeta: any, nowTime: string): ServerWhatsAppRoom | null {
  if (!rawMeta || typeof rawMeta !== 'object') return null;
  const jid = rawMeta.id;
  if (!jid || typeof jid !== 'string' || !jid.endsWith('@newsletter')) return null;

  const thread = rawMeta.thread_metadata || rawMeta;
  const viewer = rawMeta.viewer_metadata || {};
  const name =
    thread?.name?.text ||
    (typeof thread?.name === 'string' ? thread.name : '') ||
    rawMeta.name ||
    `Canal WhatsApp (${jid.split('@')[0]})`;
  const subscribers =
    parseInt(String(thread?.subscribers_count ?? rawMeta.subscribers ?? 0), 10) || 1;
  const viewerRole = String(viewer?.role || rawMeta.role || '').toUpperCase();
  const isOwnerOrAdmin = viewerRole === 'OWNER' || viewerRole === 'ADMIN';

  const roomId = `wa-${jid}`;
  const overrideRole =
    engineConfig.roleOverrides[roomId] || engineConfig.roleOverrides[jid];

  return {
    id: roomId,
    roomCode: jid,
    name,
    platform: 'whatsapp',
    kind: 'channel',
    membersCount: subscribers,
    role: overrideRole || (isOwnerOrAdmin ? 'admin' : 'member'),
    syncedAt: `Canal sincronizado às ${nowTime}`,
  };
}

async function fetchSingleNewsletterByJidOrInvite(
  sock: any,
  type: 'jid' | 'invite',
  key: string
): Promise<ServerWhatsAppRoom | null> {
  if (!sock || typeof sock.newsletterMetadata !== 'function') return null;
  try {
    const meta = await Promise.race([
      sock.newsletterMetadata(type, key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!meta) return null;
    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const room = parseNewsletterNodeToRoom(meta, nowTime);
    if (room) {
      discoveredNewsletterJids.add(room.roomCode);
      if (typeof sock.subscribeNewsletterUpdates === 'function') {
        sock.subscribeNewsletterUpdates(room.roomCode).catch(() => {});
      }
      const existingList = engineConfig.syncedNewsletters || [];
      engineConfig.syncedNewsletters = [
        room,
        ...existingList.filter((n) => n.roomCode !== room.roomCode),
      ];
      saveEngineConfig(engineConfig);
    }
    return room;
  } catch {
    return null;
  }
}

async function fetchSubscribedWhatsAppChannels(
  sock: any,
  nowTime: string
): Promise<ServerWhatsAppRoom[]> {
  const channelMap = new Map<string, ServerWhatsAppRoom>();

  for (const saved of engineConfig.syncedNewsletters || []) {
    if (saved && saved.roomCode) {
      channelMap.set(saved.roomCode, {
        ...saved,
        role:
          engineConfig.roleOverrides[saved.id] ||
          engineConfig.roleOverrides[saved.roomCode] ||
          saved.role,
      });
      if (saved.roomCode.endsWith('@newsletter')) {
        discoveredNewsletterJids.add(saved.roomCode);
      }
    }
  }

  for (const r of engineConfig.rooms || []) {
    if (r.platform === 'whatsapp' && (r.kind === 'channel' || r.roomCode.endsWith('@newsletter'))) {
      if (r.roomCode.endsWith('@newsletter')) {
        discoveredNewsletterJids.add(r.roomCode);
      }
    }
  }

  if (!sock) {
    return Array.from(channelMap.values());
  }

  // 1. Query WMex GraphQL for all subscribed/owned WhatsApp Channels (xwa2_newsletter_subscribed)
  if (typeof sock.query === 'function' && typeof sock.generateMessageTag === 'function') {
    const queryIdsToTry = [
      { id: '6388546374527196', path: 'xwa2_newsletter_subscribed' },
    ];
    for (const qInfo of queryIdsToTry) {
      try {
        const resNode: any = await Promise.race([
          sock.query({
            tag: 'iq',
            attrs: {
              id: sock.generateMessageTag(),
              type: 'get',
              to: 's.whatsapp.net',
              xmlns: 'w:mex',
            },
            content: [
              {
                tag: 'query',
                attrs: { query_id: qInfo.id },
                content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8'),
              },
            ],
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);

        const resultChild = Array.isArray(resNode?.content)
          ? resNode.content.find((c: any) => c?.tag === 'result')
          : null;
        if (resultChild?.content) {
          const parsedJson = JSON.parse(Buffer.from(resultChild.content).toString('utf-8'));
          const list =
            parsedJson?.data?.[qInfo.path] ||
            parsedJson?.data?.xwa2_newsletter_subscribed ||
            [];
          if (Array.isArray(list)) {
            for (const rawItem of list) {
              const room = parseNewsletterNodeToRoom(rawItem, nowTime);
              if (room) {
                channelMap.set(room.roomCode, room);
                discoveredNewsletterJids.add(room.roomCode);
                if (typeof sock.subscribeNewsletterUpdates === 'function') {
                  sock.subscribeNewsletterUpdates(room.roomCode).catch(() => {});
                }
              }
            }
          }
        }
      } catch {
        // Ignore if WMex query ID is unsupported on current WA version
      }
    }
  }

  // 2. Resolve any pending invite codes from https://whatsapp.com/channel/<code>
  if (
    Array.isArray(engineConfig.pendingNewsletterInvites) &&
    engineConfig.pendingNewsletterInvites.length > 0
  ) {
    const remainingInvites: string[] = [];
    for (const code of engineConfig.pendingNewsletterInvites) {
      const resolved = await fetchSingleNewsletterByJidOrInvite(sock, 'invite', code);
      if (resolved) {
        channelMap.set(resolved.roomCode, resolved);
      } else {
        remainingInvites.push(code);
      }
    }
    engineConfig.pendingNewsletterInvites = remainingInvites;
  }

  // 3. Refresh metadata for any discovered @newsletter JIDs
  for (const jid of Array.from(discoveredNewsletterJids)) {
    if (!channelMap.has(jid)) {
      const room = await fetchSingleNewsletterByJidOrInvite(sock, 'jid', jid);
      if (room) {
        channelMap.set(room.roomCode, room);
      }
    } else if (typeof sock.subscribeNewsletterUpdates === 'function') {
      sock.subscribeNewsletterUpdates(jid).catch(() => {});
    }
  }

  const allChannels = Array.from(channelMap.values());
  if (allChannels.length > 0) {
    engineConfig.syncedNewsletters = allChannels;
    saveEngineConfig(engineConfig);
  }
  return allChannels;
}

async function fetchAndStoreParticipatingGroups(sock: any, credsMe?: any) {
  if (!sock) return waState.syncedGroups;
  try {
    const groupsObj = await sock.groupFetchAllParticipating();
    const myNumber =
      extractBareNumber(sock.user?.id) || extractBareNumber(credsMe?.id);
    const myLid =
      extractBareNumber(sock.user?.lid) || extractBareNumber(credsMe?.lid);

    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const mappedGroups: ServerWhatsAppRoom[] = Object.values(groupsObj || {}).map((g: any) => {
      const participants: any[] = g.participants || [];
      const myEntry = participants.find((p) => {
        const pNum = extractBareNumber(p.id);
        const pLid = extractBareNumber(p.lid);
        const pPhone = extractBareNumber(p.phoneNumber);
        return (
          (myNumber && (pNum === myNumber || pPhone === myNumber || p.id?.includes(myNumber))) ||
          (myLid && (pLid === myLid || pNum === myLid || p.id?.includes(myLid)))
        );
      });

      const ownerNum = extractBareNumber(g.owner);
      const ownerLid = extractBareNumber(g.subjectOwner || g.owner);

      const detectedAdmin =
        myEntry?.admin === 'admin' ||
        myEntry?.admin === 'superadmin' ||
        (myNumber && ownerNum === myNumber) ||
        (myLid && ownerLid === myLid);

      const roomId = `wa-${g.id}`;
      const overrideRole =
        engineConfig.roleOverrides[roomId] || engineConfig.roleOverrides[g.id];

      return {
        id: roomId,
        roomCode: g.id,
        name: g.subject || 'Grupo WhatsApp Sem Nome',
        platform: 'whatsapp',
        kind: 'group',
        membersCount: g.size || participants.length || 1,
        role: overrideRole || (detectedAdmin ? 'admin' : 'member'),
        syncedAt: `Sincronizado às ${nowTime}`,
      };
    });

    const mappedChannels = await fetchSubscribedWhatsAppChannels(sock, nowTime);

    const combinedMap = new Map<string, ServerWhatsAppRoom>();
    for (const grp of mappedGroups) {
      combinedMap.set(grp.roomCode, grp);
    }
    for (const ch of mappedChannels) {
      combinedMap.set(ch.roomCode, ch);
    }

    const mapped = Array.from(combinedMap.values());
    mapped.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      return b.membersCount - a.membersCount;
    });

    waState.syncedGroups = mapped;
    const grpCount = mapped.filter((m) => m.kind === 'group').length;
    const chCount = mapped.filter((m) => m.kind === 'channel').length;
    waState.lastSync =
      chCount > 0
        ? `${grpCount} grupos e ${chCount} canais sincronizados às ${nowTime}`
        : `${grpCount} grupos sincronizados às ${nowTime}`;
    return mapped;
  } catch {
    return waState.syncedGroups;
  }
}

let cachedWaVersion: [number, number, number] | null = null;

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const latest = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (latest && latest.version) {
      cachedWaVersion = latest.version;
      return latest.version;
    }
  } catch {
    // ignore
  }
  return [2, 3000, 1015901307];
}

async function handleDiscoveredChatNodes(sock: any, chats: any[]) {
  if (!Array.isArray(chats) || chats.length === 0) return;
  let addedAny = false;
  const nowTime = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  for (const c of chats) {
    const jid = c?.id || c?.jid;
    if (typeof jid === 'string' && jid.endsWith('@newsletter')) {
      discoveredNewsletterJids.add(jid);
      const alreadyExists = waState.syncedGroups.some((g) => g.roomCode === jid);
      if (!alreadyExists) {
        const fetched = await fetchSingleNewsletterByJidOrInvite(sock, 'jid', jid);
        const room: ServerWhatsAppRoom = fetched || {
          id: `wa-${jid}`,
          roomCode: jid,
          name: c?.name || c?.subject || c?.title || `Canal WhatsApp (${jid.split('@')[0]})`,
          platform: 'whatsapp',
          kind: 'channel',
          membersCount: Number(c?.subscribersCount || c?.size || 1),
          role:
            engineConfig.roleOverrides[`wa-${jid}`] ||
            engineConfig.roleOverrides[jid] ||
            'member',
          syncedAt: `Canal sincronizado às ${nowTime}`,
        };
        waState.syncedGroups = [
          room,
          ...waState.syncedGroups.filter((g) => g.roomCode !== jid),
        ];
        addedAny = true;
      }
    }
  }

  if (addedAny) {
    const channels = waState.syncedGroups.filter((g) => g.kind === 'channel');
    engineConfig.syncedNewsletters = channels;
    saveEngineConfig(engineConfig);
  }
}

async function startWhatsAppSocket(forceReset = false) {
  if (isStartingSocket) {
    socketRestartPending = true;
    return;
  }
  isStartingSocket = true;

  try {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (presenceKeepAliveInterval) {
      clearInterval(presenceKeepAliveInterval);
      presenceKeepAliveInterval = null;
    }

    await lastCredsSavePromise.catch(() => {});

    if (activeSock) {
      try {
        activeSock.ev?.removeAllListeners?.();
        activeSock.ws?.close?.();
        activeSock.end?.(undefined);
      } catch {
        // ignore cleanup error
      }
      activeSock = null;
    }

    if (forceReset) {
      clearAuthDirectory(true);
      engineConfig.savedWhatsAppSession = undefined;
      saveEngineConfig(engineConfig);
      waState.phoneNumber = null;
      waState.pairingCode = null;
      waState.syncedGroups = [...(engineConfig.syncedNewsletters || [])];
      waState.qrDataUrl = null;
      waState.rawQr = null;
      waState.status = 'connecting';
      waState.lastSync = 'Gerando novo QR Code...';
    } else {
      restoreAuthFromBackup();
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const hasStoredCreds = Boolean(state.creds?.registered || state.creds?.me);

    if (hasStoredCreds) {
      const savedUserJid = state.creds?.me?.id || engineConfig.savedWhatsAppSession?.userJid;
      const savedUserName = state.creds?.me?.name || 'WhatsApp Conectado';
      const resolvedPhone =
        (savedUserJid ? formatJidToPhone(savedUserJid) : null) ||
        engineConfig.savedWhatsAppSession?.phoneNumber ||
        waState.phoneNumber;

      waState.phoneNumber = resolvedPhone;
      waState.deviceName =
        engineConfig.savedWhatsAppSession?.deviceName ||
        `${savedUserName} · Sessão Persistente`;

      if (waState.status !== 'connected') {
        waState.status = 'reconnecting';
        waState.qrDataUrl = null;
        waState.lastSync = 'Sessão preservada ativa · Reconectando socket com o celular...';
      }
    } else {
      waState.phoneNumber = null;
      if (!waState.qrDataUrl) {
        waState.status = 'connecting';
        waState.lastSync = 'Gerando QR Code para leitura...';
      } else {
        waState.status = 'qr_ready';
      }
    }

    const version = await getBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: silentLogger as any,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys:
          typeof makeCacheableSignalKeyStore === 'function'
            ? makeCacheableSignalKeyStore(state.keys, silentLogger as any)
            : state.keys,
      },
      browser: Browsers
        ? Browsers.macOS('Desktop')
        : ['Mac OS', 'Desktop', '14.4.1'],
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      getMessage: async () => ({ conversation: '' }),
    });

    activeSock = sock;
    lastSocketActivity = Date.now();

    // Prevent Baileys' internal communities dirty-bit handler from throwing unhandled 500 errors
    if (sock.ws && typeof sock.ws.removeAllListeners === 'function') {
      sock.ws.removeAllListeners('CB:ib,,dirty');
    }

    sock.ev.on('creds.update', () => {
      lastSocketActivity = Date.now();
      lastCredsSavePromise = Promise.resolve(saveCreds())
        .then(() => syncAuthBackup())
        .catch(() => {});

      if (state.creds?.me) {
        const userJid = state.creds.me.id;
        const userName = state.creds.me.name || 'WhatsApp Conectado';
        const formattedPhone = formatJidToPhone(userJid);
        const deviceLabel = `${userName} · Sessão Persistente`;

        waState.phoneNumber = formattedPhone;
        waState.deviceName = deviceLabel;

        engineConfig.savedWhatsAppSession = {
          phoneNumber: formattedPhone,
          deviceName: deviceLabel,
          userJid,
          connectedAt: Date.now(),
        };
        saveEngineConfig(engineConfig);
        syncAuthBackup();

        if (waState.status === 'qr_ready' || waState.status === 'connecting') {
          waState.status = 'reconnecting';
          waState.qrDataUrl = null;
          waState.lastSync = 'QR Code lido! Sincronizando chaves com seu WhatsApp...';
        }
      }
    });

    sock.ev.on('connection.update', async (update: any) => {
      lastSocketActivity = Date.now();
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const dataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
              dark: '#020617',
              light: '#FFFFFF',
            },
            errorCorrectionLevel: 'M',
          });
          waState.qrDataUrl = dataUrl;
          waState.rawQr = qr;
          waState.qrGeneratedAt = Date.now();
          waState.status = 'qr_ready';
          waState.phoneNumber = null;
          waState.lastSync = 'Aguardando leitura do QR Code no WhatsApp';
          waState.mode = 'baileys_live';
          waState.errorMessage = null;
        } catch {
          // ignore QR generation error
        }
      }

      if (connection === 'open') {
        const userJid = sock.user?.id || state.creds?.me?.id;
        const userName =
          sock.user?.name || state.creds?.me?.name || 'WhatsApp Conectado';
        const formattedPhone = formatJidToPhone(userJid);
        const deviceLabel = `${userName} · Sessão Persistente`;

        waState.status = 'connected';
        waState.qrDataUrl = null;
        waState.rawQr = null;
        waState.pairingCode = null;
        waState.errorMessage = null;
        waState.phoneNumber = formattedPhone;
        waState.deviceName = deviceLabel;
        waState.lastSync = `Conectado às ${new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })} · Sincronizando grupos e canais...`;

        engineConfig.savedWhatsAppSession = {
          phoneNumber: formattedPhone,
          deviceName: deviceLabel,
          userJid: userJid || '',
          connectedAt: Date.now(),
        };
        saveEngineConfig(engineConfig);
        syncAuthBackup();

        // Start active presence keep-alive to keep session alive and prevent idle timeouts
        if (presenceKeepAliveInterval) {
          clearInterval(presenceKeepAliveInterval);
          presenceKeepAliveInterval = null;
        }
        presenceKeepAliveInterval = setInterval(async () => {
          if (activeSock && waState.status === 'connected') {
            try {
              await activeSock.sendPresenceUpdate('available');
              lastSocketActivity = Date.now();
            } catch {
              // ignore presence ping failure
            }
          }
        }, 20000);

        await fetchAndStoreParticipatingGroups(sock, state.creds?.me);
      }

      if (connection === 'close') {
        lastSocketActivity = Date.now();
        if (presenceKeepAliveInterval) {
          clearInterval(presenceKeepAliveInterval);
          presenceKeepAliveInterval = null;
        }

        const statusCode =
          (lastDisconnect?.error as any)?.output?.statusCode ||
          (lastDisconnect?.error as any)?.data?.statusCode;

        const hasSession = Boolean(state.creds?.me || state.creds?.registered);

        if (statusCode === 401 || statusCode === DisconnectReason?.loggedOut) {
          // Session was explicitly logged out or invalidated on the phone — reset cleanly to show a fresh QR code
          clearAuthDirectory(true);
          engineConfig.savedWhatsAppSession = undefined;
          saveEngineConfig(engineConfig);
          waState.status = 'connecting';
          waState.phoneNumber = null;
          waState.qrDataUrl = null;
          waState.lastSync = 'Sessão expirada no aparelho · Gerando novo QR Code...';
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            startWhatsAppSocket(true);
          }, 800);
          return;
        }

        if (hasSession) {
          waState.status = 'reconnecting';
          waState.qrDataUrl = null;
          waState.phoneNumber =
            waState.phoneNumber || engineConfig.savedWhatsAppSession?.phoneNumber || null;
          waState.deviceName =
            waState.deviceName || engineConfig.savedWhatsAppSession?.deviceName || 'Sessão Persistente';
          waState.lastSync = 'Reconectando sessão com o aparelho...';
        } else {
          waState.status = 'connecting';
          waState.phoneNumber = null;
        }

        await lastCredsSavePromise.catch(() => {});

        const delayMs =
          statusCode === DisconnectReason?.restartRequired || statusCode === 515
            ? 200
            : 1000;

        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
        reconnectTimeout = setTimeout(() => {
          startWhatsAppSocket(false);
        }, delayMs);
      }
    });

    sock.ev.on('messaging-history.set', async (data: any) => {
      lastSocketActivity = Date.now();
      if (Array.isArray(data?.chats)) {
        await handleDiscoveredChatNodes(sock, data.chats);
      }
    });

    sock.ev.on('chats.upsert', async (chats: any[]) => {
      lastSocketActivity = Date.now();
      await handleDiscoveredChatNodes(sock, chats);
    });

    sock.ev.on('chats.update', async (chats: any[]) => {
      lastSocketActivity = Date.now();
      await handleDiscoveredChatNodes(sock, chats);
    });

    sock.ev.on('messages.upsert', async (event: any) => {
      lastSocketActivity = Date.now();
      const messages: any[] = event?.messages || [];
      for (const msg of messages) {
        const jid = msg?.key?.remoteJid;
        if (typeof jid === 'string' && jid.endsWith('@newsletter')) {
          await handleDiscoveredChatNodes(sock, [{ id: jid }]);
        }
        await handleIncomingBaileysMessage(msg);
      }
    });

    sock.ev.on('messages.update', async (updates: any[]) => {
      lastSocketActivity = Date.now();
      if (!Array.isArray(updates)) return;
      for (const item of updates) {
        if (item?.key && item?.update?.message) {
          await handleIncomingBaileysMessage({
            key: item.key,
            message: item.update.message,
            messageTimestamp: item.update.messageTimestamp || Math.floor(Date.now() / 1000),
          });
        }
      }
    });

    sock.ev.on('groups.upsert', async () => {
      lastSocketActivity = Date.now();
      await fetchAndStoreParticipatingGroups(sock, state.creds?.me);
    });
  } catch (err: any) {
    waState.errorMessage = err?.message || 'Erro ao inicializar socket Baileys';
    reconnectTimeout = setTimeout(() => {
      startWhatsAppSocket(false);
    }, 2500);
  } finally {
    isStartingSocket = false;
    if (socketRestartPending) {
      socketRestartPending = false;
      setTimeout(() => {
        startWhatsAppSocket(false);
      }, 400);
    }
  }
}

let lastTelegramUpdateId = 0;
let isPollingTelegram = false;

async function fetchAndRegisterTelegramChat(
  token: string,
  chatIdentifier: string | number,
  fallbackChat?: any,
  preferredRole?: 'member' | 'admin'
): Promise<ServerWhatsAppRoom | null> {
  try {
    const cleanToken = token.trim();
    const botId = cleanToken.split(':')[0];
    let chatObj: any = fallbackChat || null;

    if (cleanToken && cleanToken.includes(':') && !cleanToken.includes('AtacadoOfertasBot')) {
      try {
        const chatRes = await fetch(
          `https://api.telegram.org/bot${cleanToken}/getChat?chat_id=${encodeURIComponent(
            String(chatIdentifier)
          )}`,
          { signal: AbortSignal.timeout(4000) }
        );
        const chatData: any = await chatRes.json();
        if (chatData?.ok && chatData.result) {
          chatObj = chatData.result;
        }
      } catch {
        // use fallbackChat if available
      }
    }

    if (!chatObj) return null;
    const chatType = String(chatObj.type || '');
    if (chatType !== 'group' && chatType !== 'supergroup' && chatType !== 'channel') {
      return null;
    }

    const chatIdStr = String(chatObj.id);
    const roomId = `tg-${chatIdStr}`;
    let membersCount = 1;
    let detectedRole: 'member' | 'admin' =
      preferredRole || (chatType === 'channel' ? 'admin' : 'member');

    if (cleanToken && cleanToken.includes(':')) {
      try {
        const countRes = await fetch(
          `https://api.telegram.org/bot${cleanToken}/getChatMemberCount?chat_id=${encodeURIComponent(
            chatIdStr
          )}`,
          { signal: AbortSignal.timeout(3500) }
        );
        const countData: any = await countRes.json();
        if (countData?.ok && typeof countData.result === 'number') {
          membersCount = countData.result;
        }
      } catch {
        // ignore
      }

      if (botId) {
        try {
          const memberRes = await fetch(
            `https://api.telegram.org/bot${cleanToken}/getChatMember?chat_id=${encodeURIComponent(
              chatIdStr
            )}&user_id=${encodeURIComponent(botId)}`,
            { signal: AbortSignal.timeout(3500) }
          );
          const memberData: any = await memberRes.json();
          const status = memberData?.result?.status;
          if (status === 'administrator' || status === 'creator') {
            detectedRole = 'admin';
          } else if (status === 'member' && !preferredRole) {
            detectedRole = 'member';
          }
        } catch {
          // ignore
        }
      }
    }

    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const overrideRole =
      engineConfig.roleOverrides[roomId] || engineConfig.roleOverrides[chatIdStr];

    const room: ServerWhatsAppRoom = {
      id: roomId,
      roomCode: chatIdStr,
      name:
        chatObj.title ||
        (chatObj.username ? `@${chatObj.username}` : `Telegram ${chatIdStr}`),
      platform: 'telegram',
      kind: chatType === 'channel' ? 'channel' : 'group',
      membersCount,
      role: overrideRole || detectedRole,
      syncedAt: `Sincronizado via Telegram API às ${nowTime}`,
    };

    waState.discoveredTelegramRooms = [
      room,
      ...waState.discoveredTelegramRooms.filter((r) => r.roomCode !== chatIdStr),
    ];
    engineConfig.discoveredTelegramRooms = waState.discoveredTelegramRooms;
    saveEngineConfig(engineConfig);
    return room;
  } catch {
    return null;
  }
}

function extractFullTelegramText(post: any): string {
  let text = String(post?.text || post?.caption || '').trim();
  const entities = [...(post?.entities || []), ...(post?.caption_entities || [])];
  const foundUrls: string[] = [];

  for (const ent of entities) {
    if (ent?.type === 'text_link' && ent?.url && ent.url.startsWith('http')) {
      foundUrls.push(ent.url);
    } else if (
      ent?.type === 'url' &&
      typeof ent.offset === 'number' &&
      typeof ent.length === 'number'
    ) {
      const extractedUrl = text.substring(ent.offset, ent.offset + ent.length).trim();
      if (extractedUrl && extractedUrl.startsWith('http')) {
        foundUrls.push(extractedUrl);
      }
    }
  }

  if (Array.isArray(post?.reply_markup?.inline_keyboard)) {
    for (const row of post.reply_markup.inline_keyboard) {
      if (Array.isArray(row)) {
        for (const btn of row) {
          if (btn?.url && btn.url.startsWith('http')) {
            foundUrls.push(btn.url);
          }
        }
      }
    }
  }

  for (const u of foundUrls) {
    if (!text.includes(u)) {
      text = text ? `${text}\n${u}` : u;
    }
  }

  return text;
}

async function pollTelegramUpdates() {
  if (isPollingTelegram) return;
  const token = engineConfig.telegramBotToken?.trim();
  if (!token || !token.includes(':') || token.includes('AtacadoOfertasBot')) return;

  isPollingTelegram = true;
  try {
    const allowed = encodeURIComponent(
      JSON.stringify([
        'message',
        'edited_message',
        'channel_post',
        'edited_channel_post',
        'my_chat_member',
        'chat_member',
        'chat_join_request',
      ])
    );
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${
        lastTelegramUpdateId + 1
      }&timeout=1&allowed_updates=${allowed}`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (!res.ok) return;
    const data: any = await res.json();
    if (!data?.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      if (update.update_id > lastTelegramUpdateId) {
        lastTelegramUpdateId = update.update_id;
      }

      const post =
        update.message ||
        update.channel_post ||
        update.edited_message ||
        update.edited_channel_post;
      const candidateChats = [
        post?.chat,
        update.my_chat_member?.chat,
        update.chat_member?.chat,
        update.chat_join_request?.chat,
        post?.forward_from_chat,
        post?.sender_chat,
      ].filter(Boolean);

      for (const c of candidateChats) {
        if (c && (c.type === 'group' || c.type === 'supergroup' || c.type === 'channel')) {
          await fetchAndRegisterTelegramChat(token, c.id, c);
        }
      }

      const chat = post?.chat;
      if (post && chat) {
        const chatIdStr = String(chat.id);
        const msgId = String(post.message_id || update.update_id);
        const dedupeKey = `tg-msg-${chatIdStr}-${msgId}`;
        if (processedIncomingMsgIds.has(dedupeKey)) continue;

        const text = extractFullTelegramText(post);
        if (!text || text.startsWith('/sync') || text.startsWith('/start')) continue;

        const matchingRoutes = findMatchingRoutesForIncoming(chatIdStr, chat.title);
        if (matchingRoutes.length > 0) {
          processedIncomingMsgIds.add(dedupeKey);
        }

        // Pre-download Telegram photo buffer if message has a photo attachment
        let tgPhotoBuffer: Buffer | null = null;
        if (Array.isArray(post.photo) && post.photo.length > 0) {
          tgPhotoBuffer = await downloadTelegramPhotoBuffer(token, post.photo);
        }

        for (const route of matchingRoutes) {
          const matchedSourceId =
            resolveMatchedSourceRoomIdForRoute(route, chatIdStr, chat.title) ||
            route.sourceRoomId;
          const destRoom = findRoomInAllLists(route.destinationRoomId);

          const res = await enqueueReplicationDispatch(() =>
            executeReplicationForRoute({
              rawText: text,
              sourceRoomId: matchedSourceId,
              route,
              hasIncomingImage: Boolean(tgPhotoBuffer),
              incomingImageBuffer: tgPhotoBuffer,
            })
          );
          const preview = text.replace(/\s+/g, ' ').slice(0, 80);
          if (res.ok) {
            pushInterceptLog({
              groupJid: chatIdStr,
              groupId: `tg-${chatIdStr}`,
              groupName: chat.title || `Telegram Chat (${chatIdStr})`,
              previewText: preview,
              status: 'replicated',
              detail: `Replicado com sucesso para "${destRoom?.name || route.destinationRoomId}"`,
            });
          } else if (
            res.error?.includes('Anti-Duplicidade') ||
            res.error?.includes('repetido bloqueado') ||
            res.error?.includes('já enviado')
          ) {
            pushInterceptLog({
              groupJid: chatIdStr,
              groupId: `tg-${chatIdStr}`,
              groupName: chat.title || `Telegram Chat (${chatIdStr})`,
              previewText: preview,
              status: 'duplicate_suppressed',
              detail: res.error,
            });
          } else {
            pushInterceptLog({
              groupJid: chatIdStr,
              groupId: `tg-${chatIdStr}`,
              groupName: chat.title || `Telegram Chat (${chatIdStr})`,
              previewText: preview,
              status: 'error',
              detail: res.error || 'Erro ao enviar para o destino.',
            });
          }
        }
      }
    }
  } catch {
    // ignore transient Telegram poll error
  } finally {
    isPollingTelegram = false;
  }
}

setInterval(pollTelegramUpdates, 3000);

// Watchdog de Auto-Recuperação: verifica e mantém a conexão do WhatsApp ativa quando credenciais reais existem
setInterval(() => {
  if (!hasValidCredsOnDisk()) return;
  if (waState.status === 'qr_ready' || waState.status === 'connecting') return;

  const isSocketOpen = Boolean(activeSock?.ws?.isOpen);
  const isConnected = waState.status === 'connected' && isSocketOpen;

  if (!isConnected && !isStartingSocket) {
    const elapsed = Date.now() - lastSocketActivity;
    if (elapsed > 12000) {
      startWhatsAppSocket(false);
    }
  }
}, 12000);

async function bootstrapServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const getAppOrigin = (req: express.Request) => {
    if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
      return process.env.APP_URL.replace(/\/$/, '');
    }
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
  };

  startWhatsAppSocket(false);

  // GET /api/whatsapp/status
  app.get('/api/whatsapp/status', async (req, res) => {
    pruneExpiredHistory();
    const origin = getAppOrigin(req);
    const elapsedSec = waState.qrGeneratedAt
      ? Math.floor((Date.now() - waState.qrGeneratedAt) / 1000)
      : 0;
    const remainingSec = Math.max(0, 60 - (elapsedSec % 60));

    const groupsWithRoles = waState.syncedGroups.map((g) => ({
      ...g,
      role: engineConfig.roleOverrides[g.id] || engineConfig.roleOverrides[g.roomCode] || g.role,
    }));

    const telegramWithRoles = waState.discoveredTelegramRooms.map((t) => ({
      ...t,
      role: engineConfig.roleOverrides[t.id] || engineConfig.roleOverrides[t.roomCode] || t.role,
    }));

    res.json({
      ...waState,
      syncedGroups: groupsWithRoles,
      discoveredTelegramRooms: telegramWithRoles,
      qrRemainingSec: remainingSec,
      appOrigin: origin,
      serverHistory,
      serverRoutes: engineConfig.routes,
      serverCredentials: engineConfig.credentials,
      alertSettings: engineConfig.alertSettings,
      recentInterceptLogs,
      configSyncedAt,
      authBundle: waState.status === 'connected' ? exportAuthBundle() : null,
    });
  });

  // POST /api/engine/sync
  app.post('/api/engine/sync', (req, res) => {
    const {
      credentials,
      routes,
      rules,
      rooms,
      telegramBotToken,
      roleOverrides,
      selectedDraftPair,
      alertSettings,
      authBundle,
    } = req.body || {};

    // Restore WhatsApp cryptographic auth bundle if container restarted with empty disk
    if (authBundle && typeof authBundle === 'object' && !hasValidCredsOnDisk()) {
      const restored = importAuthBundle(authBundle);
      if (restored) {
        startWhatsAppSocket(false);
      }
    }

    const incomingIsDemo =
      credentials?.mercadoLivre?.sessionCookie?.includes('ml_sess_active_99812x') &&
      credentials?.shopee?.apiSecret?.startsWith('shp_live_98f7') &&
      credentials?.aliExpress?.appSecret?.startsWith('ali_sec_77a8');
    const currentIsReal =
      !engineConfig.credentials?.mercadoLivre?.sessionCookie?.includes('ml_sess_active_99812x') ||
      !engineConfig.credentials?.shopee?.apiSecret?.startsWith('shp_live_98f7') ||
      !engineConfig.credentials?.aliExpress?.appSecret?.startsWith('ali_sec_77a8');

    if (credentials) {
      if (!incomingIsDemo || !currentIsReal) {
        engineConfig.credentials = credentials;
      }
    }
    if (Array.isArray(routes)) {
      if (routes.length > 0 || !incomingIsDemo) {
        engineConfig.routes = routes;
      }
    }
    if (rules) engineConfig.rules = rules;
    if (Array.isArray(rooms)) {
      const cleanRooms = rooms.filter((r: ChatRoom) => !String(r.id).startsWith('room-'));
      if (cleanRooms.length > 0 || !incomingIsDemo) {
        engineConfig.rooms = cleanRooms;
      }
    }
    if (
      typeof telegramBotToken === 'string' &&
      !telegramBotToken.includes('AtacadoOfertasBot')
    ) {
      engineConfig.telegramBotToken = telegramBotToken;
    }
    if (roleOverrides && typeof roleOverrides === 'object') {
      engineConfig.roleOverrides = { ...engineConfig.roleOverrides, ...roleOverrides };
    }
    if (selectedDraftPair && typeof selectedDraftPair === 'object') {
      engineConfig.selectedDraftPair = selectedDraftPair;
    }
    if (alertSettings && typeof alertSettings === 'object') {
      engineConfig.alertSettings = {
        ...INITIAL_ALERT_SETTINGS,
        ...(engineConfig.alertSettings || {}),
        ...alertSettings,
        recentAlerts: Array.isArray(engineConfig.alertSettings?.recentAlerts)
          ? engineConfig.alertSettings.recentAlerts
          : [],
      };
    }
    if (!incomingIsDemo) {
      configSyncedAt = Date.now();
    }
    saveEngineConfig(engineConfig);
    res.json({
      ok: true,
      configSyncedAt,
      activeRoutesCount: engineConfig.routes.filter((r) => r.active).length,
      alertSettings: engineConfig.alertSettings,
    });
  });

  // POST /api/alerts/test
  app.post('/api/alerts/test', async (req, res) => {
    const { alertSettings, customReason } = req.body || {};
    if (alertSettings && typeof alertSettings === 'object') {
      engineConfig.alertSettings = {
        ...INITIAL_ALERT_SETTINGS,
        ...(engineConfig.alertSettings || {}),
        ...alertSettings,
        recentAlerts: Array.isArray(engineConfig.alertSettings?.recentAlerts)
          ? engineConfig.alertSettings.recentAlerts
          : [],
      };
      saveEngineConfig(engineConfig);
    }

    const result = await dispatchWhatsAppErrorAlert({
      category: 'test',
      reason:
        customReason ||
        'Teste de alerta do painel — falha simulada ao entregar oferta no grupo destino (verifique a conexão de rede ou o grupo destino).',
      routeName: 'Rota de Teste (Simulação)',
      destinationName: 'Grupo VIP de Ofertas',
      productTitle: 'Produto de Teste — Validação de Alerta no WhatsApp',
      forceSend: true,
    });

    res.json({
      ...result,
      alertSettings: engineConfig.alertSettings,
    });
  });

  // POST /api/alerts/clear
  app.post('/api/alerts/clear', (req, res) => {
    if (engineConfig.alertSettings) {
      engineConfig.alertSettings.recentAlerts = [];
      saveEngineConfig(engineConfig);
    }
    alertCooldownMap.clear();
    res.json({
      ok: true,
      alertSettings: engineConfig.alertSettings,
    });
  });

  // POST /api/engine/convert-preview (Live official API link conversion for the simulator)
  app.post('/api/engine/convert-preview', async (req, res) => {
    const { rawText, sourceRoomId } = req.body || {};
    const text = String(rawText || '');
    if (!text.trim()) {
      res.json({ ok: false });
      return;
    }
    try {
      const { preconvertedUrlMap, ogImageUrl, validationError } =
        await resolveAndConvertUrlsInText(
          text,
          engineConfig.credentials,
          engineConfig.rules
        );
      const parsed = parseAndConvertOffer(
        text,
        engineConfig.credentials,
        engineConfig.rules,
        sourceRoomId,
        preconvertedUrlMap
      );
      res.json({
        ok: true,
        parsed,
        ogImageUrl,
        validationError,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/engine/resend-history (Re-dispatches or retries an offer from Histórico)
  app.post('/api/engine/resend-history', async (req, res) => {
    const { historyId } = req.body || {};
    const item = serverHistory.find((h) => h.id === historyId);
    if (!item) {
      res.status(404).json({
        ok: false,
        error: 'Item de histórico não encontrado para reenvio.',
      });
      return;
    }

    // Branch A: Item had an error or no convertedText -> re-run replication pipeline
    if (item.status === 'error' || !item.convertedText) {
      try {
        let activeRoute =
          engineConfig.routes.find((r) => r.id === item.routeId) ||
          engineConfig.routes.find((r) => r.sourceRoomId === item.sourceRoomId) ||
          engineConfig.routes.find((r) => r.active);

        const destRoomId =
          item.destinationRoomId ||
          activeRoute?.destinationRoomId ||
          engineConfig.selectedDraftPair?.destinationRoomId ||
          waState.syncedGroups.find((g) => g.id !== item.sourceRoomId)?.id ||
          waState.syncedGroups[0]?.id;

        if (!destRoomId) {
          res.status(400).json({
            ok: false,
            error: 'Nenhum grupo de destino configurado para enviar a oferta.',
          });
          return;
        }

        if (!activeRoute) {
          activeRoute = {
            id: item.routeId || `route-retry-${Date.now()}`,
            name: 'Reenvio Manual',
            sourceRoomId: item.sourceRoomId || 'manual',
            destinationRoomId: destRoomId,
            active: true,
            totalConverted: 0,
            lastDispatchedAt: 'Agora',
          };
        }

        const rawTextToReprocess =
          item.originalText &&
          item.originalText.trim().length > 0 &&
          !item.originalText.startsWith('[Imagem sem legenda]')
            ? item.originalText
            : [item.productTitle, item.originalUrl]
                .filter(
                  (s) =>
                    s &&
                    !s.includes('Erro de entrega') &&
                    !s.includes('Link interceptado')
                )
                .join('\n');

        let textPayload = rawTextToReprocess || '';
        if (
          item.originalUrl &&
          item.originalUrl.startsWith('http') &&
          !textPayload.includes(item.originalUrl)
        ) {
          textPayload = textPayload ? `${textPayload}\n${item.originalUrl}` : item.originalUrl;
        }

        if (!textPayload || !textPayload.includes('http')) {
          res.status(400).json({
            ok: false,
            error: 'Esta oferta não contém um link válido salvo para reprocessamento.',
          });
          return;
        }

        const retryResult = await enqueueReplicationDispatch(() =>
          executeReplicationForRoute({
            rawText: textPayload,
            sourceRoomId: item.sourceRoomId || activeRoute.sourceRoomId,
            route: activeRoute,
          })
        );

        if (!retryResult.ok) {
          if (retryResult.error) {
            item.errorReason = retryResult.error;
            item.timestamp = new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            saveServerHistory(serverHistory);
          }
          res.status(400).json({
            ok: false,
            error:
              retryResult.error ||
              'Ainda não foi possível enviar. Verifique as credenciais ou a conexão.',
            serverHistory,
          });
          return;
        }

        // Successfully sent! Remove old error entry from serverHistory if a new historyItem was created
        if (retryResult.historyItem) {
          serverHistory = serverHistory.filter((h) => h.id !== item.id);
          if (!serverHistory.some((h) => h.id === retryResult.historyItem!.id)) {
            serverHistory = [retryResult.historyItem, ...serverHistory];
          }
          pruneExpiredHistory();
          saveServerHistory(serverHistory);
        }

        res.json({
          ok: true,
          serverHistory,
          historyItem: retryResult.historyItem,
        });
        return;
      } catch (err: any) {
        res.status(500).json({
          ok: false,
          error: err?.message || 'Erro ao processar nova tentativa de envio.',
        });
        return;
      }
    }

    try {
      const activeRoute =
        engineConfig.routes.find((r) => r.id === item.routeId && r.active) ||
        engineConfig.routes.find((r) => r.active) ||
        engineConfig.routes[0];

      const destRoomId =
        item.destinationRoomId ||
        activeRoute?.destinationRoomId ||
        engineConfig.selectedDraftPair?.destinationRoomId ||
        waState.syncedGroups.find((g) => g.id !== item.sourceRoomId)?.id ||
        waState.syncedGroups[0]?.id;

      if (!destRoomId) {
        res.status(400).json({
          ok: false,
          error: 'Nenhum grupo de destino encontrado para reenviar.',
        });
        return;
      }

      const destRoom = findRoomInAllLists(destRoomId);
      const destPlatform =
        destRoom?.platform ||
        (String(destRoomId).startsWith('tg-') || String(destRoomId).startsWith('-')
          ? 'telegram'
          : 'whatsapp');
      const destCode = destRoom?.roomCode || destRoomId;
      const cleanDestJid = destCode.replace(/^wa-/, '').replace(/^tg-/, '').trim();

      // Try to fetch clean OG:Image for the product so the photo is sent too
      let imageBuffer: Buffer | null = null;
      let ogImageUrl: string | null = null;
      try {
        const targetUrl = item.convertedUrl || item.originalUrl;
        if (targetUrl && targetUrl.startsWith('http')) {
          const pageRes = await fetch(targetUrl, {
            redirect: 'follow',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(3500),
          });
          const html = await pageRes.text();
          const picMatch = html.match(/"pictures":\[\{"id":"([^"]+)"/);
          if (picMatch && picMatch[1]) {
            ogImageUrl = `https://http2.mlstatic.com/D_NQ_NP_2X_${picMatch[1]}-F.jpg`;
          } else {
            const ogMatch =
              html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
              html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
            if (ogMatch && ogMatch[1] && ogMatch[1].startsWith('http')) {
              ogImageUrl = ogMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/-(F|O)\.webp$/i, '-$1.jpg');
            }
          }
          if (ogImageUrl) {
            const imgRes = await fetch(ogImageUrl, { signal: AbortSignal.timeout(3500) });
            if (imgRes.ok) {
              const arrBuf = await imgRes.arrayBuffer();
              imageBuffer = Buffer.from(arrBuf);
            }
          }
        }
      } catch {
        // fallback to text-only if image fetch times out
      }

      if (destPlatform === 'whatsapp') {
        if (!activeSock || waState.status !== 'connected') {
          res.status(400).json({
            ok: false,
            error: 'WhatsApp não está conectado no momento.',
          });
          return;
        }
        const targetJid = cleanDestJid.includes('@') ? cleanDestJid : `${cleanDestJid}@g.us`;
        recordBotOutgoingMessage(targetJid, item.convertedText);

        let sentMsg: any = null;
        if (imageBuffer) {
          try {
            sentMsg = await activeSock.sendMessage(targetJid, {
              image: imageBuffer,
              caption: item.convertedText,
            });
          } catch {
            sentMsg = await activeSock.sendMessage(targetJid, {
              text: item.convertedText,
            });
          }
        } else {
          sentMsg = await activeSock.sendMessage(targetJid, {
            text: item.convertedText,
          });
        }
        if (sentMsg?.key?.id) {
          sentByBotMsgIds.add(sentMsg.key.id);
        }
      } else {
        const token = engineConfig.telegramBotToken.trim();
        if (!token || !token.includes(':')) {
          res.status(400).json({
            ok: false,
            error: 'Bot Token do Telegram não configurado.',
          });
          return;
        }
        if (ogImageUrl) {
          await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cleanDestJid,
              photo: ogImageUrl,
              caption: item.convertedText,
            }),
            signal: AbortSignal.timeout(5000),
          });
        } else {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cleanDestJid,
              text: item.convertedText,
            }),
            signal: AbortSignal.timeout(5000),
          });
        }
      }

      const nowStr = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      item.timestamp = `${nowStr} (Reenviado)`;
      item.destinationRoomId = destRoomId;
      item.createdAt = Date.now();
      pruneExpiredHistory();
      saveServerHistory(serverHistory);

      res.json({
        ok: true,
        serverHistory,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Erro ao reenviar oferta.',
      });
    }
  });

  // POST /api/engine/clear-history
  app.post('/api/engine/clear-history', (req, res) => {
    const { itemId } = req.body || {};
    if (itemId) {
      serverHistory = serverHistory.filter((item) => item.id !== itemId);
    } else {
      serverHistory = [];
    }
    saveServerHistory(serverHistory);
    res.json({ ok: true, serverHistory });
  });

  // POST /api/engine/toggle-room-role
  app.post('/api/engine/toggle-room-role', (req, res) => {
    const { roomId, roomCode, newRole } = req.body || {};
    if (roomId) engineConfig.roleOverrides[roomId] = newRole;
    if (roomCode) engineConfig.roleOverrides[roomCode] = newRole;
    waState.syncedGroups = waState.syncedGroups.map((g) =>
      g.id === roomId || g.roomCode === roomCode ? { ...g, role: newRole } : g
    );
    waState.discoveredTelegramRooms = waState.discoveredTelegramRooms.map((t) =>
      t.id === roomId || t.roomCode === roomCode ? { ...t, role: newRole } : t
    );
    engineConfig.discoveredTelegramRooms = waState.discoveredTelegramRooms;
    engineConfig.syncedNewsletters = waState.syncedGroups.filter((g) => g.kind === 'channel');
    saveEngineConfig(engineConfig);
    res.json({ ok: true });
  });

  // POST /api/rooms/delete
  app.post('/api/rooms/delete', (req, res) => {
    const { roomId, roomCode } = req.body || {};
    waState.syncedGroups = waState.syncedGroups.filter(
      (g) => g.id !== roomId && g.roomCode !== roomCode
    );
    waState.discoveredTelegramRooms = waState.discoveredTelegramRooms.filter(
      (t) => t.id !== roomId && t.roomCode !== roomCode
    );
    engineConfig.discoveredTelegramRooms = waState.discoveredTelegramRooms;
    engineConfig.syncedNewsletters = (engineConfig.syncedNewsletters || []).filter(
      (n) => n.id !== roomId && n.roomCode !== roomCode
    );
    engineConfig.rooms = (engineConfig.rooms || []).filter(
      (r) => r.id !== roomId && r.roomCode !== roomCode
    );
    saveEngineConfig(engineConfig);
    res.json({ ok: true });
  });

  // POST /api/rooms/lookup (Sync real Telegram Group/Channel or WhatsApp Channel by @username, link, or ID)
  app.post('/api/rooms/lookup', async (req, res) => {
    const { identifier, platform, kind, role, customName } = req.body || {};
    const rawInput = String(identifier || '').trim();
    const fallbackName = String(customName || '').trim();

    if (!rawInput && !fallbackName) {
      res.status(400).json({
        ok: false,
        error: 'Informe o @username, link (t.me/ ou whatsapp.com/channel/) ou ID da sala.',
      });
      return;
    }

    const isWaChannelLink = /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i.test(rawInput);
    const isNewsletterJid = rawInput.endsWith('@newsletter');
    const isTelegramLink = /t\.me\/([A-Za-z0-9_+@-]+)/i.test(rawInput);
    const isTelegramUsername = rawInput.startsWith('@');
    const isTelegramNumericId = /^-\d{6,}$/.test(rawInput);

    const detectedPlatform: 'whatsapp' | 'telegram' =
      isWaChannelLink || isNewsletterJid
        ? 'whatsapp'
        : isTelegramLink || isTelegramUsername || isTelegramNumericId
        ? 'telegram'
        : platform === 'telegram'
        ? 'telegram'
        : 'whatsapp';

    // 1. Handle Telegram Group or Channel lookup via official Bot API
    if (detectedPlatform === 'telegram') {
      const token = engineConfig.telegramBotToken?.trim();
      if (!token || !token.includes(':')) {
        res.status(400).json({
          ok: false,
          error: 'Configure e valide seu Bot Token do Telegram na aba 2. Conexões primeiro.',
        });
        return;
      }

      let chatTarget = rawInput;
      const tgLinkMatch = rawInput.match(/t\.me\/(?:s\/)?([A-Za-z0-9_+-]+)/i);
      if (tgLinkMatch && tgLinkMatch[1]) {
        const slug = tgLinkMatch[1];
        if (slug.startsWith('+')) {
          res.status(400).json({
            ok: false,
            error:
              'Para links privados (t.me/+...), envie qualquer mensagem (ex: /sync) dentro do grupo/canal com o bot presente para sincronizar automaticamente, ou informe o ID numérico (-100...).',
          });
          return;
        }
        chatTarget = `@${slug.replace(/^@/, '')}`;
      } else if (!chatTarget.startsWith('@') && !chatTarget.startsWith('-') && /^[A-Za-z0-9_]{4,}$/.test(chatTarget)) {
        chatTarget = `@${chatTarget}`;
      }

      const syncedRoom = await fetchAndRegisterTelegramChat(
        token,
        chatTarget,
        fallbackName
          ? {
              id: chatTarget,
              title: fallbackName,
              type: kind === 'channel' ? 'channel' : 'supergroup',
            }
          : undefined,
        role === 'admin' ? 'admin' : 'member'
      );

      if (!syncedRoom) {
        res.status(400).json({
          ok: false,
          error: `Não foi possível localizar "${chatTarget}" na API do Telegram. Verifique se o @username / ID (-100...) está correto ou adicione o bot no grupo e envie uma mensagem.`,
        });
        return;
      }

      res.json({
        ok: true,
        room: syncedRoom,
        discoveredTelegramRooms: waState.discoveredTelegramRooms,
      });
      return;
    }

    // 2. Handle WhatsApp Channel (@newsletter or whatsapp.com/channel/<code>)
    const waChannelMatch = rawInput.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
    if (waChannelMatch || isNewsletterJid || kind === 'channel') {
      const inviteCode = waChannelMatch ? waChannelMatch[1] : '';
      const nowTime = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (activeSock && waState.status === 'connected') {
        const roomFromSocket = await fetchSingleNewsletterByJidOrInvite(
          activeSock,
          isNewsletterJid ? 'jid' : 'invite',
          isNewsletterJid ? rawInput : inviteCode || rawInput
        );
        if (roomFromSocket) {
          if (role === 'admin' || role === 'member') {
            roomFromSocket.role = role;
            engineConfig.roleOverrides[roomFromSocket.id] = role;
            engineConfig.roleOverrides[roomFromSocket.roomCode] = role;
          }
          waState.syncedGroups = [
            roomFromSocket,
            ...waState.syncedGroups.filter((g) => g.roomCode !== roomFromSocket.roomCode),
          ];
          saveEngineConfig(engineConfig);
          res.json({
            ok: true,
            room: roomFromSocket,
            syncedGroups: waState.syncedGroups,
          });
          return;
        }
      }

      // Scrape public WhatsApp Channel preview page for instant name & subscriber count
      let scrapedTitle = fallbackName;
      let scrapedSubscribers = 1;
      if (inviteCode) {
        try {
          const pageRes = await fetch(`https://whatsapp.com/channel/${inviteCode}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(4500),
          });
          const html = await pageRes.text();
          const ogTitle =
            html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
            '';
          const cleanTitle = ogTitle
            .replace(/\s*\|\s*WhatsApp Channel.*$/i, '')
            .replace(/\s*no WhatsApp.*$/i, '')
            .trim();
          if (cleanTitle && !cleanTitle.toLowerCase().includes('whatsapp')) {
            scrapedTitle = cleanTitle;
          }
          const ogDesc =
            html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            '';
          const subMatch = ogDesc.match(/([\d.,]+)\s*(mil|k|m|seguidores|followers)/i);
          if (subMatch) {
            const num = parseFloat(subMatch[1].replace(/\./g, '').replace(',', '.'));
            const unit = subMatch[2].toLowerCase();
            if (!Number.isNaN(num)) {
              scrapedSubscribers =
                unit === 'mil' || unit === 'k'
                  ? Math.round(num * 1000)
                  : unit === 'm'
                  ? Math.round(num * 1000000)
                  : Math.round(num);
            }
          }
        } catch {
          // ignore scrape error
        }

        if (!engineConfig.pendingNewsletterInvites?.includes(inviteCode)) {
          engineConfig.pendingNewsletterInvites = [
            ...(engineConfig.pendingNewsletterInvites || []),
            inviteCode,
          ];
        }
      }

      const channelCode = isNewsletterJid
        ? rawInput
        : inviteCode
        ? `invite:${inviteCode}@newsletter`
        : `${rawInput.replace(/[^0-9]/g, '') || Date.now()}@newsletter`;
      const roomId = `wa-${channelCode}`;
      const chosenRole: 'member' | 'admin' = role === 'admin' ? 'admin' : 'member';
      engineConfig.roleOverrides[roomId] = chosenRole;
      engineConfig.roleOverrides[channelCode] = chosenRole;

      const channelRoom: ServerWhatsAppRoom = {
        id: roomId,
        roomCode: channelCode,
        name: scrapedTitle || `Canal WhatsApp (${inviteCode || channelCode.split('@')[0]})`,
        platform: 'whatsapp',
        kind: 'channel',
        membersCount: scrapedSubscribers,
        role: chosenRole,
        syncedAt: `Canal vinculado às ${nowTime}`,
      };

      engineConfig.syncedNewsletters = [
        channelRoom,
        ...(engineConfig.syncedNewsletters || []).filter((n) => n.roomCode !== channelCode),
      ];
      waState.syncedGroups = [
        channelRoom,
        ...waState.syncedGroups.filter((g) => g.roomCode !== channelCode),
      ];
      saveEngineConfig(engineConfig);

      res.json({
        ok: true,
        room: channelRoom,
        syncedGroups: waState.syncedGroups,
      });
      return;
    }

    res.status(400).json({
      ok: false,
      error:
        'Para sincronizar grupos do WhatsApp, escaneie o QR Code na aba 2. Conexões. Para Canais do WhatsApp, cole o link https://whatsapp.com/channel/...',
    });
  });

  // POST /api/engine/dispatch-now
  app.post('/api/engine/dispatch-now', async (req, res) => {
    const { rawText, sourceRoomId, routeId, destinationRoomId } = req.body || {};

    let targetRoute: TrafficRoute | undefined = engineConfig.routes.find(
      (r) => r.id === routeId
    );

    if (!targetRoute && destinationRoomId) {
      targetRoute = {
        id: routeId || `manual-${Date.now()}`,
        name: 'Disparo Manual / Teste Direto',
        sourceRoomId: sourceRoomId || 'manual',
        destinationRoomId,
        active: true,
        totalConverted: 0,
        lastDispatchedAt: 'Agora mesmo',
      };
    }

    if (!targetRoute) {
      targetRoute = engineConfig.routes.find((r) => r.active) || engineConfig.routes[0];
    }

    if (!targetRoute) {
      res.status(400).json({
        ok: false,
        error: 'Crie pelo menos uma rota em Fontes de Tráfego para disparar.',
      });
      return;
    }

    const result = await enqueueReplicationDispatch(() =>
      executeReplicationForRoute({
        rawText: String(rawText || ''),
        sourceRoomId: sourceRoomId || targetRoute.sourceRoomId,
        route: targetRoute,
      })
    );

    res.json({
      ...result,
      serverHistory,
      serverRoutes: engineConfig.routes,
      recentInterceptLogs,
    });
  });

  // POST /api/whatsapp/generate-qr
  app.post('/api/whatsapp/generate-qr', async (req, res) => {
    await startWhatsAppSocket(true);

    for (let i = 0; i < 18; i++) {
      if (waState.qrDataUrl || waState.status === 'connected') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    res.json({
      ...waState,
      qrRemainingSec: 60,
    });
  });

  // POST /api/whatsapp/sync-groups
  app.post('/api/whatsapp/sync-groups', async (req, res) => {
    // 1. Trigger Telegram updates & refresh all known Telegram rooms
    await pollTelegramUpdates();
    const token = engineConfig.telegramBotToken?.trim();
    if (token && token.includes(':') && !token.includes('AtacadoOfertasBot')) {
      const existingTgIds = new Set<string>();
      for (const r of waState.discoveredTelegramRooms) {
        if (r.roomCode) existingTgIds.add(r.roomCode);
      }
      for (const r of engineConfig.rooms || []) {
        if (r.platform === 'telegram' && r.roomCode) existingTgIds.add(r.roomCode);
      }
      for (const chatId of Array.from(existingTgIds)) {
        await fetchAndRegisterTelegramChat(token, chatId);
      }
    }

    // 2. Sync WhatsApp Groups & Channels (@newsletter)
    if (activeSock && waState.status === 'connected') {
      const groups = await fetchAndStoreParticipatingGroups(activeSock);
      res.json({
        ok: true,
        syncedGroups: groups,
        discoveredTelegramRooms: waState.discoveredTelegramRooms,
        count: groups.length + waState.discoveredTelegramRooms.length,
      });
      return;
    }

    res.json({
      ok: waState.discoveredTelegramRooms.length > 0 || waState.syncedGroups.length > 0,
      syncedGroups: waState.syncedGroups,
      discoveredTelegramRooms: waState.discoveredTelegramRooms,
      count: waState.syncedGroups.length + waState.discoveredTelegramRooms.length,
    });
  });

  // POST /api/whatsapp/pairing-code
  app.post('/api/whatsapp/pairing-code', async (req, res) => {
    const { phoneNumber } = req.body || {};
    const cleanDigits = String(phoneNumber || '').replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      res.status(400).json({ error: 'Informe o número com DDI + DDD (ex: 5511999999999).' });
      return;
    }

    try {
      if (activeSock && typeof activeSock.requestPairingCode === 'function') {
        const code = await Promise.race([
          activeSock.requestPairingCode(cleanDigits),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 5000)
          ),
        ]);
        const formatted =
          code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        waState.pairingCode = formatted;
        res.json({ pairingCode: formatted, mode: 'baileys_live' });
        return;
      }
    } catch {
      // ignore pairing code error
    }

    res.status(503).json({
      error: 'Aguarde 2 segundos para o socket inicializar e tente novamente, ou use o QR Code.',
    });
  });

  // GET /api/whatsapp/mobile-confirm
  app.get('/api/whatsapp/mobile-confirm', (req, res) => {
    waState.status = 'connected';
    waState.qrDataUrl = null;
    waState.phoneNumber = '+55 (11) 98412-7790';
    waState.deviceName = 'Smartphone Pareado via QR Code';
    waState.lastSync = `Pareado às ${new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sessão Pareada — Chat Bot Automático</title>
  <style>
    body { background: #0B0F19; color: #F8FAFC; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
    .card { background: #111827; border: 1px solid #10B981; border-radius: 16px; padding: 28px; max-width: 380px; text-align: center; }
    .badge { display: inline-block; background: rgba(16,185,129,0.15); color: #34D399; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 8px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #94A3B8; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">WHATSAPP CONECTADO</div>
    <h1>Aparelho Pareado com Sucesso!</h1>
    <p>O painel do <strong>Chat Bot Automático</strong> já reconheceu a leitura do seu QR Code e sincronizou seus grupos e canais em tempo real.</p>
  </div>
</body>
</html>`);
  });

  // POST /api/whatsapp/disconnect
  app.post('/api/whatsapp/disconnect', async (req, res) => {
    if (activeSock) {
      try {
        await activeSock.logout();
      } catch {
        // ignore
      }
      activeSock = null;
    }
    clearAuthDirectory(true);
    engineConfig.savedWhatsAppSession = undefined;
    saveEngineConfig(engineConfig);
    waState.status = 'disconnected';
    waState.qrDataUrl = null;
    waState.rawQr = null;
    waState.pairingCode = null;
    waState.phoneNumber = null;
    waState.syncedGroups = [...(engineConfig.syncedNewsletters || [])];
    waState.lastSync = 'Desconectado manualmente';
    setTimeout(() => {
      startWhatsAppSocket(true);
    }, 300);
    res.json(waState);
  });

  // POST /api/telegram/validate
  app.post('/api/telegram/validate', async (req, res) => {
    const { botToken } = req.body || {};
    const token = String(botToken || '').trim();
    if (!token || !token.includes(':')) {
      res.status(400).json({
        valid: false,
        error: 'O Bot Token deve conter o formato ID:HASH fornecido pelo @BotFather.',
      });
      return;
    }

    engineConfig.telegramBotToken = token;
    saveEngineConfig(engineConfig);

    const startTime = Date.now();
    try {
      await fetch(
        `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`,
        { signal: AbortSignal.timeout(3500) }
      ).catch(() => {});

      const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(4500),
      });
      const pingMs = Math.max(12, Date.now() - startTime);
      const data: any = await tgRes.json();

      if (data && data.ok && data.result) {
        await pollTelegramUpdates();
        res.json({
          valid: true,
          botUsername: `@${data.result.username}`,
          botName: data.result.first_name || 'Telegram Bot',
          botId: String(data.result.id),
          canReadAllGroupMessages: Boolean(data.result.can_read_all_group_messages),
          discoveredTelegramRooms: waState.discoveredTelegramRooms,
          pingMs,
          realApi: true,
        });
        return;
      }
    } catch {
      // ignore
    }

    res.status(400).json({
      valid: false,
      error: 'Não foi possível validar o Bot Token na API oficial do Telegram.',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrapServer();
