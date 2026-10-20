export type MarketplaceId = 'amazon' | 'mercadoLivre' | 'shopee' | 'aliExpress';

export interface AffiliateCredentials {
  amazon: {
    enabled: boolean;
    associateTag: string;
  };
  mercadoLivre: {
    enabled: boolean;
    affiliateTag: string;
    sessionCookie: string;
  };
  shopee: {
    enabled: boolean;
    appId: string;
    apiSecret: string;
  };
  aliExpress: {
    enabled: boolean;
    appKey: string;
    trackingId: string;
    appSecret: string;
  };
}

export type WhatsAppConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';
export type TelegramConnectionStatus = 'online' | 'offline' | 'validating' | 'invalid';

export interface ConnectionsState {
  whatsapp: {
    status: WhatsAppConnectionStatus;
    phoneNumber: string;
    deviceName: string;
    engine: 'Baileys v6.7 (WebSocket)' | 'WPPConnect Engine';
    lastSync: string;
    qrSeed: number;
  };
  telegram: {
    status: TelegramConnectionStatus;
    botToken: string;
    botUsername: string;
    botId: string;
    pingMs: number;
    lastValidatedAt: string;
  };
}

export type PlatformType = 'whatsapp' | 'telegram';
export type RoomKind = 'group' | 'channel';
export type RoomRole = 'member' | 'admin';

export interface ChatRoom {
  id: string;
  roomCode: string;
  name: string;
  platform: PlatformType;
  kind: RoomKind;
  membersCount: number;
  role: RoomRole;
  syncedAt: string;
}

export interface TrafficRoute {
  id: string;
  name: string;
  sourceRoomId: string;
  sourceRoomIds?: string[];
  destinationRoomId: string;
  active: boolean;
  totalConverted: number;
  lastDispatchedAt: string;
}

export interface AlertDispatchLog {
  id: string;
  timestamp: string;
  targetPhone: string;
  reason: string;
  routeName?: string;
  status: 'sent' | 'suppressed_cooldown' | 'failed';
  messageText: string;
}

export interface AlertSettings {
  enabled: boolean;
  targetPhone: string;
  cooldownMinutes: number;
  customPrefix: string;
  alertOnSendError: boolean;
  alertOnApiError: boolean;
  alertOnBrokenLink: boolean;
  recentAlerts?: AlertDispatchLog[];
}

export type ImageReplacementStrategy = 'og_image' | 'strip_image' | 'keep_original';

export interface ReplicaRules {
  parser: {
    amazon: boolean;
    mercadoLivre: boolean;
    shopee: boolean;
    aliExpress: boolean;
  };
  layout: {
    keepTitle: boolean;
    keepPrice: boolean;
    keepCoupons: boolean;
    discardCompetitorCta: boolean;
  };
  antiWatermark: {
    enabled: boolean;
    blacklistedRoomIds: string[];
    strategy: ImageReplacementStrategy;
  };
  antiDuplicate?: {
    enabled: boolean;
    cooldownHours: number;
  };
  replacement: {
    footerEnabled: boolean;
    mandatoryFooter: string;
    sanitizeMentions: boolean;
    sanitizePhones: boolean;
    sanitizeInviteLinks: boolean;
  };
}

export type ProductVisualPreset = 'headphones' | 'airfryer' | 'smartwatch' | 'espresso';

export interface ParsedOfferResult {
  originalText: string;
  convertedText: string;
  detectedMarketplace: MarketplaceId | null;
  originalUrls: string[];
  convertedUrls: string[];
  removedElements: string[];
  watermarkIntercepted: boolean;
  imageActionLabel: string;
  productPreset: ProductVisualPreset;
  productSku: string;
  canonicalProductId?: string | null;
  ogImageMetadata: {
    title: string;
    resolution: string;
    sourceDomain: string;
  };
}

export interface DispatchHistoryItem {
  id: string;
  timestamp: string;
  routeId: string;
  sourceRoomId: string;
  destinationRoomId: string;
  marketplace: MarketplaceId;
  productTitle: string;
  canonicalProductId?: string | null;
  originalUrl: string;
  convertedUrl: string;
  originalText: string;
  convertedText: string;
  removedElements: string[];
  watermarkReplaced: boolean;
  productPreset: ProductVisualPreset;
  status?: 'success' | 'error';
  errorReason?: string;
  createdAt?: number;
}
