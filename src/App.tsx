import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  KeyRound,
  Radio,
  Users,
  GitFork,
  Sparkles,
  Check,
  RefreshCw,
  Trash2,
  Plus,
  ArrowRight,
  Eye,
  EyeOff,
  Play,
  Pause,
  Copy,
  Search,
  SlidersHorizontal,
  Image as ImageIcon,
  FileText,
  RotateCcw,
  QrCode,
  Smartphone,
  Hash,
  Send,
  ShieldCheck,
  Clock,
  ExternalLink,
  AlertTriangle,
  Settings,
  Download,
  Upload,
  Bell,
} from 'lucide-react';
import {
  AffiliateCredentials,
  AlertSettings,
  ChatRoom,
  ConnectionsState,
  DispatchHistoryItem,
  MarketplaceId,
  ParsedOfferResult,
  PlatformType,
  ReplicaRules,
  RoomKind,
  RoomRole,
  TrafficRoute,
} from './types';
import {
  COMPETITOR_OFFER_SAMPLES,
  INITIAL_ALERT_SETTINGS,
  INITIAL_CONNECTIONS,
  INITIAL_CREDENTIALS,
  INITIAL_HISTORY,
  INITIAL_ROOMS,
  INITIAL_ROUTES,
  INITIAL_RULES,
} from './data/initialData';
import { isCompetitorOrInviteUrl, parseAndConvertOffer } from './utils/replicaEngine';
import { ProductStudioIllustration } from './components/ProductStudioIllustration';
import { WhatsAppQrMatrix } from './components/WhatsAppQrMatrix';

type MainModuleId =
  | 'affiliates'
  | 'connections'
  | 'rooms'
  | 'routing'
  | 'replica'
  | 'history'
  | 'alerts'
  | 'settings';
type RoomSubTab = 'all' | 'whatsapp' | 'telegram';
type ReplicaSubTab = 'trigger_rules' | 'anti_watermark' | 'replacement_params';
type HistoryFilterTab = 'all' | MarketplaceId;
type QrScanMethod = 'baileys_qr' | 'camera_qr' | 'pairing_code';

const STORAGE_KEYS = {
  CREDENTIALS: 'cba_affiliate_credentials_v3',
  CONNECTIONS: 'cba_connections_state_v3',
  ROOMS: 'cba_synced_rooms_v3',
  ROUTES: 'cba_traffic_routes_v3',
  RULES: 'cba_replica_rules_v3',
  HISTORY: 'cba_dispatch_history_v3',
  ALERTS: 'cba_alert_settings_v3',
  AUTH_BUNDLE: 'cba_baileys_auth_bundle_v1',
};

const HISTORY_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function getHistoryItemCreatedAtMs(item: DispatchHistoryItem): number {
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

function isHistoryItemWithin8Hours(item: DispatchHistoryItem): boolean {
  if (['hist-1', 'hist-2', 'hist-3', 'hist-4'].includes(item.id)) return false;
  if (String(item.sourceRoomId).startsWith('room-')) return false;
  if (item.status === 'error' && item.originalUrl && isCompetitorOrInviteUrl(item.originalUrl)) {
    return false;
  }
  return Date.now() - getHistoryItemCreatedAtMs(item) < HISTORY_TTL_MS;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeDemoCredentials(creds: AffiliateCredentials): AffiliateCredentials {
  const amzTag =
    creds.amazon?.associateTag === 'atacadoofertas-20'
      ? ''
      : creds.amazon?.associateTag || '';

  const mlTag =
    creds.mercadoLivre?.affiliateTag === 'matt_word=atacado_hub&matt_tool=88492011'
      ? ''
      : creds.mercadoLivre?.affiliateTag || '';

  const rawMlCookie = creds.mercadoLivre?.sessionCookie || '';
  const mlCookie =
    rawMlCookie.includes('ml_sess_active_99812x') ||
    rawMlCookie.includes('ml_sec_992817412') ||
    rawMlCookie.includes('ATACADO_OFERTAS')
      ? ''
      : rawMlCookie;

  const shopeeAppId =
    creds.shopee?.appId === '18392049182' ? '' : creds.shopee?.appId || '';
  const rawShopeeSecret = creds.shopee?.apiSecret || '';
  const shopeeSecret =
    rawShopeeSecret.startsWith('shp_live_98f7') ||
    rawShopeeSecret.startsWith('shp_sec_8849')
      ? ''
      : rawShopeeSecret;

  const aliAppKey =
    creds.aliExpress?.appKey === '33918274' ? '' : creds.aliExpress?.appKey || '';
  const aliTracking =
    creds.aliExpress?.trackingId === 'hub_afiliados_br'
      ? ''
      : creds.aliExpress?.trackingId || '';
  const rawAliSecret = creds.aliExpress?.appSecret || '';
  const aliSecret = rawAliSecret.startsWith('ali_sec_77') ? '' : rawAliSecret;

  return {
    amazon: {
      enabled: Boolean(amzTag.trim()) && (creds.amazon?.enabled ?? true),
      associateTag: amzTag,
    },
    mercadoLivre: {
      enabled:
        (Boolean(mlTag.trim()) || Boolean(mlCookie.trim())) &&
        (creds.mercadoLivre?.enabled ?? true),
      affiliateTag: mlTag,
      sessionCookie: mlCookie,
    },
    shopee: {
      enabled:
        (Boolean(shopeeAppId.trim()) || Boolean(shopeeSecret.trim())) &&
        (creds.shopee?.enabled ?? true),
      appId: shopeeAppId,
      apiSecret: shopeeSecret,
    },
    aliExpress: {
      enabled:
        (Boolean(aliAppKey.trim()) ||
          Boolean(aliTracking.trim()) ||
          Boolean(aliSecret.trim())) &&
        (creds.aliExpress?.enabled ?? true),
      appKey: aliAppKey,
      trackingId: aliTracking,
      appSecret: aliSecret,
    },
  };
}

function sanitizeDemoConnections(conn: ConnectionsState): ConnectionsState {
  const isDemoTg =
    conn.telegram?.botToken?.includes('AtacadoOfertasBot') ||
    conn.telegram?.botUsername === '@AtacadoOfertasAutoBot';
  const isDemoWppPhone = conn.whatsapp?.phoneNumber === '+55 (11) 98412-7790';

  return {
    whatsapp: {
      ...conn.whatsapp,
      phoneNumber: isDemoWppPhone ? '' : conn.whatsapp?.phoneNumber || '',
      deviceName:
        conn.whatsapp?.deviceName === 'Worker Node #01 · São Paulo'
          ? 'Sessão WebSocket'
          : conn.whatsapp?.deviceName || 'Sessão WebSocket',
    },
    telegram: isDemoTg
      ? INITIAL_CONNECTIONS.telegram
      : conn.telegram || INITIAL_CONNECTIONS.telegram,
  };
}

function sanitizeDemoRules(r: ReplicaRules): ReplicaRules {
  const isDemoFooter = r.replacement?.mandatoryFooter?.includes(
    'biolink.info/atacado-ofertas'
  );
  if (!isDemoFooter) return r;
  return {
    ...r,
    replacement: {
      ...r.replacement,
      footerEnabled: false,
      mandatoryFooter: '',
    },
  };
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

function sanitizeStoredHistory(items: DispatchHistoryItem[]): DispatchHistoryItem[] {
  return items.filter((item) => !isTestOrSampleHistoryItem(item) && isHistoryItemWithin8Hours(item));
}

export default function App() {
  const [activeModule, setActiveModule] = useState<MainModuleId>('affiliates');
  const [roomSubTab, setRoomSubTab] = useState<RoomSubTab>('all');
  const [replicaSubTab, setReplicaSubTab] = useState<ReplicaSubTab>('trigger_rules');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterTab>('all');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [resendingHistoryId, setResendingHistoryId] = useState<string | null>(null);

  // Persistent Domain State
  const [credentials, setCredentials] = useState<AffiliateCredentials>(() =>
    sanitizeDemoCredentials(loadFromStorage(STORAGE_KEYS.CREDENTIALS, INITIAL_CREDENTIALS))
  );
  const [connections, setConnections] = useState<ConnectionsState>(() =>
    sanitizeDemoConnections(loadFromStorage(STORAGE_KEYS.CONNECTIONS, INITIAL_CONNECTIONS))
  );
  const [rooms, setRooms] = useState<ChatRoom[]>(() =>
    loadFromStorage(STORAGE_KEYS.ROOMS, INITIAL_ROOMS).filter(
      (r) => !String(r.id).startsWith('room-')
    )
  );
  const [routes, setRoutes] = useState<TrafficRoute[]>(() =>
    loadFromStorage(STORAGE_KEYS.ROUTES, INITIAL_ROUTES).filter(
      (rt) => !String(rt.sourceRoomId).startsWith('room-')
    )
  );
  const [rules, setRules] = useState<ReplicaRules>(() =>
    sanitizeDemoRules(loadFromStorage(STORAGE_KEYS.RULES, INITIAL_RULES))
  );
  const [history, setHistory] = useState<DispatchHistoryItem[]>(() => {
    const raw = loadFromStorage(STORAGE_KEYS.HISTORY, INITIAL_HISTORY);
    const cleaned = sanitizeStoredHistory(raw);
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(cleaned));
    } catch {}
    return cleaned;
  });
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => ({
    ...INITIAL_ALERT_SETTINGS,
    ...loadFromStorage(STORAGE_KEYS.ALERTS, INITIAL_ALERT_SETTINGS),
  }));
  const [isSendingTestAlert, setIsSendingTestAlert] = useState<boolean>(false);

  // Real-time QR & Backend Session State
  const [serverQrDataUrl, setServerQrDataUrl] = useState<string | null>(null);
  const [qrRemainingSec, setQrRemainingSec] = useState<number>(60);
  const [serverQrMode, setServerQrMode] = useState<'baileys_live' | 'camera_pair'>('baileys_live');
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(false);
  const [pairingPhoneInput, setPairingPhoneInput] = useState<string>('');
  const [pairingCodeResult, setPairingCodeResult] = useState<string | null>(null);
  const [isRequestingCode, setIsRequestingCode] = useState<boolean>(false);
  const [lastInterceptStatus, setLastInterceptStatus] = useState<string>(
    'Escutando mensagens em tempo real nos grupos conectados'
  );
  const [isDispatchingTestId, setIsDispatchingTestId] = useState<string | null>(null);
  const [recentInterceptLogs, setRecentInterceptLogs] = useState<
    Array<{
      id: string;
      timestamp: string;
      groupJid: string;
      groupId: string;
      groupName: string;
      previewText: string;
      status: 'replicated' | 'ignored_no_route' | 'error' | 'duplicate_suppressed';
      detail: string;
    }>
  >([]);

  const hasNotifiedRealGroupsRef = useRef<boolean>(false);
  const lastSeenHistoryIdRef = useRef<string>(INITIAL_HISTORY[0]?.id || '');

  // UI Feedback & Transient States
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [roomSearch, setRoomSearch] = useState('');
  const [isSyncingRooms, setIsSyncingRooms] = useState(false);

  // New Room Modal & Quick Lookup State
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [newRoomIdentifier, setNewRoomIdentifier] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPlatform, setNewRoomPlatform] = useState<PlatformType>('telegram');
  const [newRoomKind, setNewRoomKind] = useState<RoomKind>('group');
  const [newRoomRole, setNewRoomRole] = useState<RoomRole>('member');
  const [isLookingUpRoom, setIsLookingUpRoom] = useState(false);

  // New Route Form State (Multi-Source capable)
  const [isCreateRouteOpen, setIsCreateRouteOpen] = useState(true);
  const [newRouteName, setNewRouteName] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(INITIAL_ROOMS[0]?.id || '');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() =>
    INITIAL_ROOMS[0]?.id ? [INITIAL_ROOMS[0].id] : []
  );
  const [sourceBuilderSearch, setSourceBuilderSearch] = useState<string>('');
  const [selectedDestId, setSelectedDestId] = useState<string>(
    INITIAL_ROOMS[1]?.id || INITIAL_ROOMS[0]?.id || ''
  );

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
  }, [credentials]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONNECTIONS, JSON.stringify(connections));
  }, [connections]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
  }, [rooms]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(routes));
  }, [routes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(rules));
  }, [rules]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alertSettings));
  }, [alertSettings]);

  const syncEngineConfigToBackend = useCallback(() => {
    let savedAuthBundle: Record<string, string> | null = null;
    try {
      const rawBundle = localStorage.getItem(STORAGE_KEYS.AUTH_BUNDLE);
      if (rawBundle) {
        savedAuthBundle = JSON.parse(rawBundle);
      }
    } catch {}

    fetch('/api/engine/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentials,
        routes,
        rules,
        rooms,
        telegramBotToken: connections.telegram.botToken,
        alertSettings,
        authBundle: savedAuthBundle,
        selectedDraftPair: {
          sourceRoomId: selectedSourceIds[0] || selectedSourceId,
          sourceRoomIds: selectedSourceIds,
          destinationRoomId: selectedDestId,
        },
      }),
    }).catch(() => {});
  }, [
    credentials,
    routes,
    rules,
    rooms,
    connections.telegram.botToken,
    alertSettings,
    selectedSourceId,
    selectedSourceIds,
    selectedDestId,
  ]);

  // CRITICAL: Sync credentials, routes, rules, rooms, draft pair, and Telegram token to backend replication engine
  useEffect(() => {
    syncEngineConfigToBackend();
  }, [syncEngineConfigToBackend]);

  // Live Simulator & Replica Tester State
  const [selectedSampleId, setSelectedSampleId] = useState<string>(COMPETITOR_OFFER_SAMPLES[0].id);
  const [simulatorSourceRoomId, setSimulatorSourceRoomId] = useState<string>(
    COMPETITOR_OFFER_SAMPLES[0].sourceRoomId
  );
  const [simulatorRawText, setSimulatorRawText] = useState<string>(
    COMPETITOR_OFFER_SAMPLES[0].rawMessage
  );
  const [autoStreamActive, setAutoStreamActive] = useState<boolean>(false);
  const [copiedPreview, setCopiedPreview] = useState<boolean>(false);
  const [serverConvertedPreview, setServerConvertedPreview] = useState<ParsedOfferResult | null>(
    null
  );

  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4200);
  }, []);

  // Poll /api/whatsapp/status every 1.2s for QR, connection, real groups, and replicated message history
  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/whatsapp/status');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;

        // If server restarted and hasn't received client config yet, push immediately
        if (data.configSyncedAt === 0) {
          syncEngineConfigToBackend();
        }

        if (data.qrDataUrl) {
          setServerQrDataUrl(data.qrDataUrl);
        }
        if (typeof data.qrRemainingSec === 'number') {
          setQrRemainingSec(data.qrRemainingSec);
        }
        if (data.mode) {
          setServerQrMode(data.mode);
        }
        if (data.pairingCode) {
          setPairingCodeResult(data.pairingCode);
        }
        if (data.lastInterceptStatus) {
          setLastInterceptStatus(data.lastInterceptStatus);
        }
        if (Array.isArray(data.recentInterceptLogs)) {
          setRecentInterceptLogs(data.recentInterceptLogs);
        }
        if (Array.isArray(data.alertSettings?.recentAlerts)) {
          setAlertSettings((prev) => ({
            ...prev,
            recentAlerts: data.alertSettings.recentAlerts,
          }));
        }

        // Sync live replicated history from backend (auto-filtered within 8h and cleaned from test offers)
        if (Array.isArray(data.serverHistory)) {
          const cleanServerHistory = sanitizeStoredHistory(data.serverHistory);
          setHistory(cleanServerHistory);
          try {
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(cleanServerHistory));
          } catch {}
          const newest = cleanServerHistory[0];
          if (newest && newest.id !== lastSeenHistoryIdRef.current) {
            const wasInitial = !lastSeenHistoryIdRef.current;
            lastSeenHistoryIdRef.current = newest.id;
            if (!wasInitial) {
              if (newest.status === 'error') {
                triggerToast(
                  `Envio bloqueado (${newest.errorReason || 'Erro no link/API'}): "${newest.productTitle.slice(0, 32)}..."`
                );
              } else {
                triggerToast(
                  `Produto enviado com sucesso! Salvo na aba Histórico: "${newest.productTitle.slice(0, 32)}..."`
                );
              }
            }
          }
        }

        // Merge both WhatsApp Groups/Channels and Telegram Groups/Channels on every poll
        const incomingWaRooms: ChatRoom[] = Array.isArray(data.syncedGroups)
          ? data.syncedGroups
          : [];
        const incomingTgRooms: ChatRoom[] = Array.isArray(data.discoveredTelegramRooms)
          ? data.discoveredTelegramRooms
          : [];

        if (incomingWaRooms.length > 0 || incomingTgRooms.length > 0) {
          setRooms((prevRooms) => {
            const roomMap = new Map<string, ChatRoom>();
            for (const r of prevRooms) {
              if (!String(r.id).startsWith('room-')) {
                roomMap.set(r.roomCode || r.id, r);
              }
            }
            for (const waRoom of incomingWaRooms) {
              roomMap.set(waRoom.roomCode || waRoom.id, waRoom);
            }
            for (const tgRoom of incomingTgRooms) {
              roomMap.set(tgRoom.roomCode || tgRoom.id, tgRoom);
            }
            return Array.from(roomMap.values());
          });
        }

        if (data.authBundle && typeof data.authBundle === 'object') {
          try {
            localStorage.setItem(STORAGE_KEYS.AUTH_BUNDLE, JSON.stringify(data.authBundle));
          } catch {}
        }

        if (data.status === 'reconnecting') {
          setConnections((prev) => ({
            ...prev,
            whatsapp: {
              ...prev.whatsapp,
              status: 'reconnecting',
              phoneNumber: data.phoneNumber || prev.whatsapp.phoneNumber,
              deviceName: data.deviceName || prev.whatsapp.deviceName,
              lastSync: data.lastSync || 'Sincronizando chaves com o aparelho...',
            },
          }));
        } else if (
          data.status === 'qr_ready' ||
          data.status === 'connecting' ||
          data.status === 'disconnected'
        ) {
          setConnections((prev) => ({
            ...prev,
            whatsapp: {
              ...prev.whatsapp,
              status: 'disconnected',
              phoneNumber: '',
              lastSync: data.lastSync || 'Aguardando leitura do QR Code no WhatsApp',
            },
          }));
        } else if (data.status === 'connected') {
          setConnections((prev) => {
            const wasConnected = prev.whatsapp.status === 'connected';
            if (!wasConnected) {
              triggerToast('WhatsApp conectado e sessão salva com sucesso!');
            }
            return {
              ...prev,
              whatsapp: {
                ...prev.whatsapp,
                status: 'connected',
                phoneNumber: data.phoneNumber || prev.whatsapp.phoneNumber,
                deviceName: data.deviceName || prev.whatsapp.deviceName,
                lastSync: data.lastSync || 'Conectado e sincronizado',
              },
            };
          });

          if (incomingWaRooms.length > 0 && !hasNotifiedRealGroupsRef.current) {
            hasNotifiedRealGroupsRef.current = true;
            const grpCount = incomingWaRooms.filter((r) => r.kind === 'group').length;
            const chCount = incomingWaRooms.filter((r) => r.kind === 'channel').length;
            triggerToast(
              chCount > 0
                ? `${grpCount} grupos e ${chCount} canais do WhatsApp sincronizados!`
                : `${grpCount} grupos reais do seu WhatsApp sincronizados!`
            );
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };

    fetchStatus();
    const poll = setInterval(fetchStatus, 1200);
    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, [triggerToast, syncEngineConfigToBackend]);

  // Keep selectedSourceId and selectedDestId valid when rooms update
  useEffect(() => {
    if (rooms.length > 0 && !rooms.some((r) => r.id === selectedSourceId)) {
      setSelectedSourceId(rooms[0].id);
    }
    if (rooms.length > 0 && !rooms.some((r) => r.id === selectedDestId)) {
      const fallbackRoom = rooms.find((r) => r.id !== selectedSourceId) || rooms[0];
      setSelectedDestId(fallbackRoom.id);
    }
  }, [rooms, selectedSourceId, selectedDestId]);

  // Live parsed output for the simulator (instant local fallback + official server API conversion)
  const localParsedResult = useMemo(() => {
    return parseAndConvertOffer(simulatorRawText, credentials, rules, simulatorSourceRoomId);
  }, [simulatorRawText, credentials, rules, simulatorSourceRoomId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/engine/convert-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText: simulatorRawText,
            sourceRoomId: simulatorSourceRoomId,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.ok && data.parsed) {
          setServerConvertedPreview(data.parsed);
        }
      } catch {
        // fallback to localParsedResult
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [simulatorRawText, simulatorSourceRoomId, credentials, rules]);

  const liveParsedResult = serverConvertedPreview || localParsedResult;

  // Automated test dispatch loop removed: messages are dispatched strictly upon receiving real messages in source groups

  // Handlers: Module 1 (Affiliate Credentials)
  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
    const activeCount = [
      credentials.amazon.enabled,
      credentials.mercadoLivre.enabled,
      credentials.shopee.enabled,
      credentials.aliExpress.enabled,
    ].filter(Boolean).length;
    triggerToast(`Configurações salvas com sucesso (${activeCount}/4 integrações ativas).`);
  };

  const toggleSecretVisibility = (fieldKey: string) => {
    setShowSecrets((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
  };

  // Handlers: Module 2 (Connections & Real QR Code)
  const handleRefreshQrCode = async () => {
    setIsGeneratingQr(true);
    setPairingCodeResult(null);
    hasNotifiedRealGroupsRef.current = false;
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH_BUNDLE);
    } catch {}
    setConnections((prev) => ({
      ...prev,
      whatsapp: {
        ...prev.whatsapp,
        status: 'disconnected',
        phoneNumber: '',
        qrSeed: Math.floor(100000 + Math.random() * 900000),
      },
    }));

    try {
      const res = await fetch('/api/whatsapp/generate-qr', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.qrDataUrl) {
          setServerQrDataUrl(data.qrDataUrl);
        }
        setQrRemainingSec(60);
      }
    } catch {
      // ignore
    } finally {
      setIsGeneratingQr(false);
      triggerToast('Novo QR Code gerado e pronto para leitura no WhatsApp!');
    }
  };

  const handleDisconnectWhatsApp = async () => {
    hasNotifiedRealGroupsRef.current = false;
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH_BUNDLE);
    } catch {}
    try {
      await fetch('/api/whatsapp/disconnect', { method: 'POST' });
    } catch {
      // ignore
    }
    setConnections((prev) => ({
      ...prev,
      whatsapp: {
        ...prev.whatsapp,
        status: 'disconnected',
        phoneNumber: '',
        lastSync: 'Sessão encerrada manualmente',
      },
    }));
    triggerToast('Sessão encerrada. Gerando novo QR Code...');
  };

  const handleRequestPairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRequestingCode(true);
    try {
      const res = await fetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: pairingPhoneInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        triggerToast(data.error || 'Número inválido.');
      } else if (data.pairingCode) {
        setPairingCodeResult(data.pairingCode);
        triggerToast(`Código de pareamento oficial gerado: ${data.pairingCode}`);
      }
    } catch {
      triggerToast('Erro ao gerar código de pareamento.');
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleValidateTelegramToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = connections.telegram.botToken.trim();
    if (!token || !token.includes(':')) {
      setConnections((prev) => ({
        ...prev,
        telegram: { ...prev.telegram, status: 'invalid', pingMs: 0 },
      }));
      triggerToast('Formato inválido: o token do BotFather deve conter ID:HASH.');
      return;
    }

    setConnections((prev) => ({
      ...prev,
      telegram: { ...prev.telegram, status: 'validating' },
    }));

    try {
      const res = await fetch('/api/telegram/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        const nowTime = new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        setConnections((prev) => ({
          ...prev,
          telegram: {
            ...prev.telegram,
            status: 'online',
            botUsername: data.botUsername || prev.telegram.botUsername,
            botId: data.botId || prev.telegram.botId,
            pingMs: data.pingMs || 32,
            lastValidatedAt: `Hoje às ${nowTime}`,
          },
        }));
        if (Array.isArray(data.discoveredTelegramRooms) && data.discoveredTelegramRooms.length > 0) {
          setRooms((prev) => {
            const roomMap = new Map<string, ChatRoom>();
            for (const r of prev) roomMap.set(r.roomCode || r.id, r);
            for (const tg of data.discoveredTelegramRooms) roomMap.set(tg.roomCode || tg.id, tg);
            return Array.from(roomMap.values());
          });
        }
        triggerToast(
          `Bot ${data.botUsername} validado com sucesso (Ping: ${data.pingMs}ms).`
        );
        return;
      }
    } catch {
      // ignore
    }

    setConnections((prev) => ({
      ...prev,
      telegram: {
        ...prev.telegram,
        status: 'invalid',
        pingMs: 0,
      },
    }));
    triggerToast('Não foi possível validar o Token na API do Telegram.');
  };

  // Handlers: Module 3 (Groups & Channels)
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      const matchesTab = roomSubTab === 'all' || room.platform === roomSubTab;
      const q = roomSearch.trim().toLowerCase();
      const matchesQuery =
        !q ||
        room.name.toLowerCase().includes(q) ||
        room.roomCode.toLowerCase().includes(q);
      return matchesTab && matchesQuery;
    });
  }, [rooms, roomSubTab, roomSearch]);

  const handleSyncMetadata = async () => {
    setIsSyncingRooms(true);
    try {
      const res = await fetch('/api/whatsapp/sync-groups', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const waList: ChatRoom[] = Array.isArray(data.syncedGroups) ? data.syncedGroups : [];
        const tgList: ChatRoom[] = Array.isArray(data.discoveredTelegramRooms)
          ? data.discoveredTelegramRooms
          : [];
        if (waList.length > 0 || tgList.length > 0) {
          setRooms((prev) => {
            const roomMap = new Map<string, ChatRoom>();
            for (const r of prev) roomMap.set(r.roomCode || r.id, r);
            for (const w of waList) roomMap.set(w.roomCode || w.id, w);
            for (const t of tgList) roomMap.set(t.roomCode || t.id, t);
            return Array.from(roomMap.values());
          });
          setIsSyncingRooms(false);
          triggerToast(
            `Sincronização concluída: ${waList.length} salas WhatsApp e ${tgList.length} salas Telegram!`
          );
          return;
        }
      }
    } catch {
      // ignore
    }

    setTimeout(() => {
      setIsSyncingRooms(false);
      triggerToast(
        'Para sincronizar no Telegram, envie uma mensagem no grupo com o bot ou cole o @username/link abaixo.'
      );
    }, 450);
  };

  const handleToggleRoomRole = async (room: ChatRoom) => {
    const newRole: RoomRole = room.role === 'admin' ? 'member' : 'admin';
    setRooms((prev) =>
      prev.map((r) => (r.id === room.id ? { ...r, role: newRole } : r))
    );
    try {
      await fetch('/api/engine/toggle-room-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: room.id,
          roomCode: room.roomCode,
          newRole,
        }),
      });
    } catch {
      // ignore
    }
    triggerToast(
      `Papel de "${room.name}" alterado para ${
        newRole === 'admin' ? 'Administrador' : 'Membro'
      }. Envio habilitado normalmente.`
    );
  };

  const handleDeleteRoom = async (roomId: string) => {
    const target = rooms.find((r) => r.id === roomId);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
    setRoutes((prev) =>
      prev.filter((rt) => rt.sourceRoomId !== roomId && rt.destinationRoomId !== roomId)
    );
    try {
      await fetch('/api/rooms/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, roomCode: target?.roomCode }),
      });
    } catch {
      // ignore
    }
    triggerToast(`Sala "${target?.name || roomId}" removida da listagem.`);
  };

  const handleCreateCustomRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomIdentifier.trim() && !newRoomName.trim()) return;

    setIsLookingUpRoom(true);
    try {
      const res = await fetch('/api/rooms/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: newRoomIdentifier.trim(),
          customName: newRoomName.trim(),
          platform: newRoomPlatform,
          kind: newRoomKind,
          role: newRoomRole,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.room) {
        triggerToast(
          data.error ||
            'Não foi possível sincronizar esta sala. Verifique o @username, link ou ID.'
        );
        return;
      }

      const syncedRoom: ChatRoom = data.room;
      setRooms((prev) => [
        syncedRoom,
        ...prev.filter((r) => r.roomCode !== syncedRoom.roomCode && r.id !== syncedRoom.id),
      ]);
      setNewRoomIdentifier('');
      setNewRoomName('');
      setIsAddRoomOpen(false);
      triggerToast(
        `${syncedRoom.kind === 'channel' ? 'Canal' : 'Grupo'} "${syncedRoom.name}" (${syncedRoom.platform.toUpperCase()}) sincronizado com sucesso!`
      );
    } catch {
      triggerToast('Erro de conexão ao consultar a API do grupo/canal.');
    } finally {
      setIsLookingUpRoom(false);
    }
  };

  const destinationRooms = useMemo(
    () => rooms,
    [rooms]
  );

  const getRouteSourceIds = useCallback((route: TrafficRoute): string[] => {
    const list = Array.isArray(route.sourceRoomIds)
      ? route.sourceRoomIds.filter(Boolean)
      : [];
    if (route.sourceRoomId && !list.includes(route.sourceRoomId)) {
      list.unshift(route.sourceRoomId);
    }
    return Array.from(new Set(list));
  }, []);

  const formatRouteAutoName = useCallback(
    (sourceIds: string[], destId: string): string => {
      const dst = rooms.find((r) => r.id === destId);
      const dstName = dst?.name?.slice(0, 20) || 'Destino';
      if (sourceIds.length === 0) return `Origem → ${dstName}`;
      const firstSrc = rooms.find((r) => r.id === sourceIds[0]);
      const firstName = firstSrc?.name?.slice(0, 18) || 'Origem';
      if (sourceIds.length === 1) {
        return `${firstName} → ${dstName}`;
      }
      return `${firstName} +${sourceIds.length - 1} fonte${
        sourceIds.length - 1 > 1 ? 's' : ''
      } → ${dstName}`;
    },
    [rooms]
  );

  const handleToggleSourceInTopBuilder = (roomId: string) => {
    setSelectedSourceIds((prev) => {
      const exists = prev.includes(roomId);
      const next = exists ? prev.filter((id) => id !== roomId) : [...prev, roomId];
      setSelectedSourceId(next[0] || '');
      return next;
    });
  };

  const handleSelectAllSourcesInBuilder = () => {
    const validIds = rooms
      .filter((r) => r.id !== selectedDestId)
      .map((r) => r.id);
    setSelectedSourceIds(validIds);
    setSelectedSourceId(validIds[0] || '');
  };

  const handleClearSourcesInBuilder = () => {
    setSelectedSourceIds([]);
    setSelectedSourceId('');
  };

  const handleSelectDestInTopBuilder = (newDstId: string) => {
    setSelectedDestId(newDstId);
  };

  const handleQuickBindGroupAsSource = (groupId: string, groupName: string) => {
    setSelectedSourceId(groupId);
    setSelectedSourceIds((prev) => (prev.includes(groupId) ? prev : [...prev, groupId]));
    const destRoom =
      rooms.find((r) => r.id === selectedDestId && r.id !== groupId) ||
      rooms.find((r) => r.id !== groupId) ||
      rooms[0];

    if (!destRoom) {
      triggerToast('Sincronize pelo menos 2 grupos para definir Origem e Destino.');
      return;
    }

    const newRoute: TrafficRoute = {
      id: `route-${Date.now()}`,
      name: `${groupName.slice(0, 22)} → ${destRoom.name.slice(0, 22)}`,
      sourceRoomId: groupId,
      sourceRoomIds: [groupId],
      destinationRoomId: destRoom.id,
      active: true,
      totalConverted: 0,
      lastDispatchedAt: 'Escutando mensagens ao vivo',
    };

    setRoutes((prev) => [
      newRoute,
      ...prev.filter((rt) => !rt.sourceRoomId.startsWith('room-wa-')),
    ]);
    triggerToast(
      `Grupo "${groupName}" ativado como Origem! Enviando automaticamente para "${destRoom.name}".`
    );
  };

  const handleCreateRoute = (e: React.FormEvent) => {
    e.preventDefault();
    const candidateSources =
      selectedSourceIds.length > 0
        ? selectedSourceIds
        : selectedSourceId
        ? [selectedSourceId]
        : [];
    const validSourceIds = Array.from(
      new Set(candidateSources.filter((id) => id && id !== selectedDestId && rooms.some((r) => r.id === id)))
    );
    const destRoom = rooms.find((r) => r.id === selectedDestId);

    if (validSourceIds.length === 0 || !destRoom) {
      triggerToast(
        'Selecione pelo menos 1 grupo/canal Fonte (diferente do Destino) e 1 grupo de Destino.'
      );
      return;
    }

    const defaultLabel = formatRouteAutoName(validSourceIds, destRoom.id);
    const newRoute: TrafficRoute = {
      id: `route-${Date.now()}`,
      name: newRouteName.trim() || defaultLabel,
      sourceRoomId: validSourceIds[0],
      sourceRoomIds: validSourceIds,
      destinationRoomId: destRoom.id,
      active: true,
      totalConverted: 0,
      lastDispatchedAt: 'Escutando mensagens ao vivo',
    };

    setRoutes((prev) => [
      newRoute,
      ...prev.filter((rt) => !rt.sourceRoomId.startsWith('room-wa-')),
    ]);
    setNewRouteName('');
    triggerToast(
      `Rota criada com ${validSourceIds.length} grupo(s) fonte(s) enviando para "${destRoom.name}"!`
    );
  };

  const handleUpdateRouteRooms = (
    routeId: string,
    field: 'sourceRoomId' | 'destinationRoomId',
    newRoomId: string
  ) => {
    setRoutes((prev) =>
      prev.map((rt) => {
        if (rt.id !== routeId) return rt;
        if (field === 'destinationRoomId') {
          const filteredSources = getRouteSourceIds(rt).filter((id) => id !== newRoomId);
          const nextSources = filteredSources.length > 0 ? filteredSources : [rt.sourceRoomId];
          return {
            ...rt,
            destinationRoomId: newRoomId,
            sourceRoomId: nextSources[0],
            sourceRoomIds: nextSources,
            name: formatRouteAutoName(nextSources, newRoomId),
          };
        }
        const currentSources = getRouteSourceIds(rt);
        const nextSources = currentSources.includes(newRoomId)
          ? currentSources
          : [newRoomId, ...currentSources.slice(1)];
        return {
          ...rt,
          sourceRoomId: newRoomId,
          sourceRoomIds: nextSources,
          name: formatRouteAutoName(nextSources, rt.destinationRoomId),
        };
      })
    );
    triggerToast('Mapeamento da rota atualizado e sincronizado com o servidor!');
  };

  const handleAddSourceToExistingRoute = (routeId: string, sourceRoomIdToAdd: string) => {
    if (!sourceRoomIdToAdd) return;
    setRoutes((prev) =>
      prev.map((rt) => {
        if (rt.id !== routeId) return rt;
        if (sourceRoomIdToAdd === rt.destinationRoomId) {
          triggerToast('O grupo de destino não pode ser adicionado como fonte da mesma rota.');
          return rt;
        }
        const current = getRouteSourceIds(rt);
        if (current.includes(sourceRoomIdToAdd)) return rt;
        const nextSources = [...current, sourceRoomIdToAdd];
        return {
          ...rt,
          sourceRoomId: nextSources[0],
          sourceRoomIds: nextSources,
          name: formatRouteAutoName(nextSources, rt.destinationRoomId),
        };
      })
    );
    triggerToast('Grupo fonte adicionado à rota!');
  };

  const handleRemoveSourceFromExistingRoute = (routeId: string, sourceRoomIdToRemove: string) => {
    setRoutes((prev) =>
      prev.map((rt) => {
        if (rt.id !== routeId) return rt;
        const current = getRouteSourceIds(rt);
        if (current.length <= 1) {
          triggerToast('A rota precisa ter pelo menos 1 grupo fonte selecionado.');
          return rt;
        }
        const nextSources = current.filter((id) => id !== sourceRoomIdToRemove);
        return {
          ...rt,
          sourceRoomId: nextSources[0],
          sourceRoomIds: nextSources,
          name: formatRouteAutoName(nextSources, rt.destinationRoomId),
        };
      })
    );
    triggerToast('Grupo fonte removido da rota.');
  };

  const handleTestRouteLiveDispatch = async (route: TrafficRoute) => {
    setIsDispatchingTestId(route.id);
    const sample = COMPETITOR_OFFER_SAMPLES[0];
    try {
      const res = await fetch('/api/engine/dispatch-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: sample.rawMessage,
          sourceRoomId: route.sourceRoomId,
          routeId: route.id,
          destinationRoomId: route.destinationRoomId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.serverHistory)) setHistory(data.serverHistory);
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === route.id
              ? {
                  ...r,
                  totalConverted: r.totalConverted + 1,
                  lastDispatchedAt: 'Disparo real concluído agora',
                }
              : r
          )
        );
        triggerToast('Oferta convertida e enviada de verdade para o grupo de destino!');
      } else {
        triggerToast(`Aviso no envio: ${data.error || 'Verifique se a sala destino é válida.'}`);
      }
    } catch {
      triggerToast('Erro ao comunicar com o motor de disparo.');
    } finally {
      setIsDispatchingTestId(null);
    }
  };

  const handleToggleRoute = (routeId: string) => {
    setRoutes((prev) =>
      prev.map((r) => (r.id === routeId ? { ...r, active: !r.active } : r))
    );
  };

  const handleDeleteRoute = (routeId: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== routeId));
    triggerToast('Roteamento removido.');
  };

  // Handlers: Module 5 (Replica Chat & Live Dispatch)
  const handleSelectOfferPreset = (sampleId: string) => {
    const found = COMPETITOR_OFFER_SAMPLES.find((s) => s.id === sampleId);
    if (!found) return;
    setSelectedSampleId(found.id);
    setSimulatorSourceRoomId(found.sourceRoomId);
    setSimulatorRawText(found.rawMessage);
  };

  const handleManualDispatchSimulation = async () => {
    const matchingRoute =
      routes.find((r) => r.sourceRoomId === simulatorSourceRoomId && r.active) ||
      routes.find((r) => r.active) ||
      routes[0];

    setIsDispatchingTestId('simulator');
    try {
      const res = await fetch('/api/engine/dispatch-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: simulatorRawText,
          sourceRoomId: simulatorSourceRoomId,
          routeId: matchingRoute?.id,
          destinationRoomId:
            matchingRoute?.destinationRoomId ||
            destinationRooms.find((r) => r.id !== selectedSourceId)?.id ||
            rooms[0]?.id,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.serverHistory)) {
        setHistory(
          data.serverHistory.filter(
            (h: DispatchHistoryItem) =>
              !['hist-1', 'hist-2', 'hist-3', 'hist-4'].includes(h.id) &&
              !String(h.sourceRoomId).startsWith('room-')
          )
        );
      }
      if (data.ok) {
        triggerToast('Oferta higienizada, convertida e enviada para o canal de destino!');
      } else {
        triggerToast(
          `Envio bloqueado (${data.error || 'Produto sem estoque ou link inválido'}) — Registrado no Histórico.`
        );
      }
      return;
    } catch {
      triggerToast('Erro ao comunicar com o servidor de disparo.');
    } finally {
      setIsDispatchingTestId(null);
    }
  };

  const handleResendHistoryItem = async (item: DispatchHistoryItem) => {
    if (resendingHistoryId) return;
    setResendingHistoryId(item.id);
    try {
      const res = await fetch('/api/engine/resend-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historyId: item.id }),
      });
      const data = await res.json();
      if (Array.isArray(data.serverHistory)) {
        setHistory(data.serverHistory);
      }
      if (data.ok) {
        triggerToast(`Oferta "${item.productTitle.slice(0, 30)}..." enviada com sucesso!`);
      } else {
        triggerToast(`Não foi possível enviar: ${data.error || 'Verifique as credenciais ou a conexão.'}`);
      }
    } catch {
      triggerToast('Erro ao processar nova tentativa de envio.');
    } finally {
      setResendingHistoryId(null);
    }
  };

  const handleDeleteHistoryItem = async (itemId: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== itemId);
      try {
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(next));
      } catch {}
      return next;
    });
    try {
      await fetch('/api/engine/clear-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      triggerToast('Item removido do histórico.');
    } catch {
      // ignore
    }
  };

  const handleClearAllHistory = async () => {
    setHistory([]);
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify([]));
    } catch {}
    try {
      await fetch('/api/engine/clear-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      triggerToast('Histórico limpo com sucesso.');
    } catch {
      // ignore
    }
  };

  const handleToggleBlacklistRoom = (roomId: string) => {
    setRules((prev) => {
      const exists = prev.antiWatermark.blacklistedRoomIds.includes(roomId);
      const updated = exists
        ? prev.antiWatermark.blacklistedRoomIds.filter((id) => id !== roomId)
        : [...prev.antiWatermark.blacklistedRoomIds, roomId];
      return {
        ...prev,
        antiWatermark: {
          ...prev.antiWatermark,
          blacklistedRoomIds: updated,
        },
      };
    });
  };

  const handleResetDemoData = () => {
    setCredentials(INITIAL_CREDENTIALS);
    setRooms(INITIAL_ROOMS);
    setRoutes(INITIAL_ROUTES);
    setRules(INITIAL_RULES);
    setHistory(INITIAL_HISTORY);
    triggerToast('Configurações limpas para o padrão.');
  };

  // Summary metrics
  const totalConvertedOffers = useMemo(
    () => routes.reduce((acc, r) => acc + r.totalConverted, 0),
    [routes]
  );
  const activeRoutesCount = useMemo(
    () => routes.filter((r) => r.active).length,
    [routes]
  );
  const activeMarketplacesCount = useMemo(
    () =>
      [
        credentials.amazon.enabled,
        credentials.mercadoLivre.enabled,
        credentials.shopee.enabled,
        credentials.aliExpress.enabled,
      ].filter(Boolean).length,
    [credentials]
  );

  const getRoomById = (id: string) => rooms.find((r) => r.id === id);

  // Filtered history list for the Histórico tab
  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      const matchesMarketplace =
        historyFilter === 'all' || item.marketplace === historyFilter;
      const q = historySearch.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.productTitle.toLowerCase().includes(q) ||
        item.convertedUrl.toLowerCase().includes(q) ||
        item.originalUrl.toLowerCase().includes(q) ||
        item.convertedText.toLowerCase().includes(q) ||
        (item.errorReason && item.errorReason.toLowerCase().includes(q));
      return matchesMarketplace && matchesQuery;
    });
  }, [history, historyFilter, historySearch]);

  // Check if any route still references a disconnected demo room while real WhatsApp rooms exist
  const hasRealWhatsAppGroups = useMemo(
    () => rooms.some((r) => r.id.startsWith('wa-')),
    [rooms]
  );

  const moduleMeta: Record<MainModuleId, { title: string; subtitle: string }> = {
    affiliates: {
      title: 'Configurações de Afiliados (APIs & Chaves)',
      subtitle:
        'Gerencie suas tags comissionadas, chaves de API e cookies de sessão ativa para substituição automática de links.',
    },
    connections: {
      title: 'Conexões de Entrada & Saída',
      subtitle:
        'Pareamento em tempo real de sessão WhatsApp via Leitor de QR Code (Baileys Multi-Device) e validação do Bot Token Telegram.',
    },
    rooms: {
      title: 'Grupos & Canais Sincronizados',
      subtitle:
        'Listagem unificada dos seus grupos reais do WhatsApp e canais do Telegram. Você pode alternar a permissão (Membro ⇄ Admin) em 1 clique.',
    },
    routing: {
      title: 'Fontes de Tráfego (Roteamento & Replicação Real)',
      subtitle:
        'Selecione o Grupo de Origem (De Onde Copiar) e o Grupo de Destino (Para Onde Enviar) para replicar as mensagens automaticamente no seu WhatsApp/Telegram.',
    },
    replica: {
      title: 'Replica Chat & Regras de Disparo',
      subtitle:
        'Motor central de higienização textual, parser Regex de links, extração OG:Image anti-marca d’água e rodapé obrigatório.',
    },
    history: {
      title: 'Histórico de Produtos Enviados com Sucesso',
      subtitle:
        'Registro completo de todos os produtos capturados, higienizados, convertidos com seu link oficial de afiliado e enviados para os seus grupos de destino.',
    },
    alerts: {
      title: 'Central de Alertas de Erro via WhatsApp',
      subtitle:
        'Cadastre um número para receber avisos automáticos enviados pelo WhatsApp principal logado no site sempre que ocorrer erro de envio ou bloqueio para corrigir.',
    },
    settings: {
      title: 'Configurações (Baixar & Exportar Dados Salvos)',
      subtitle:
        'Exporte ou baixe um arquivo com todas as suas configurações salvas de APIs & Chaves, Replica Chat, Fontes de Tráfego e Alertas.',
    },
  };

  const handleSendTestAlertNow = async () => {
    if (isSendingTestAlert) return;
    if (!alertSettings.targetPhone || alertSettings.targetPhone.replace(/\D/g, '').length < 10) {
      triggerToast('Informe primeiro um número de WhatsApp válido (com DDD) para enviar o alerta.');
      return;
    }
    setIsSendingTestAlert(true);
    try {
      const res = await fetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertSettings,
        }),
      });
      const data = await res.json();
      if (data.alertSettings) {
        setAlertSettings(data.alertSettings);
      }
      if (data.ok) {
        triggerToast(
          `Alerta de teste enviado com sucesso para ${alertSettings.targetPhone} pelo WhatsApp principal!`
        );
      } else {
        triggerToast(
          data.error ||
            'Não foi possível enviar o alerta. Verifique se o WhatsApp principal está conectado na aba 2. Conexões.'
        );
      }
    } catch {
      triggerToast('Erro ao comunicar com o servidor de alertas.');
    } finally {
      setIsSendingTestAlert(false);
    }
  };

  const handleClearAlertLogs = async () => {
    setAlertSettings((prev) => ({ ...prev, recentAlerts: [] }));
    try {
      await fetch('/api/alerts/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      triggerToast('Histórico de alertas limpo.');
    } catch {
      // ignore
    }
  };

  const buildExportPayload = useCallback(
    (scope: 'all' | 'affiliates' | 'replica' | 'routing') => {
      const exportedAt = new Date().toISOString();
      if (scope === 'affiliates') {
        return {
          exportedAt,
          module: 'api_credentials',
          credentials,
          telegramBotToken: connections.telegram.botToken,
        };
      }
      if (scope === 'replica') {
        return {
          exportedAt,
          module: 'replica_chat',
          rules,
        };
      }
      if (scope === 'routing') {
        return {
          exportedAt,
          module: 'traffic_sources',
          routes,
          rooms,
          selectedDraftPair: {
            sourceRoomId: selectedSourceIds[0] || selectedSourceId,
            sourceRoomIds: selectedSourceIds,
            destinationRoomId: selectedDestId,
          },
        };
      }
      return {
        exportedAt,
        module: 'complete_backup',
        apiCredentials: {
          credentials,
          telegramBotToken: connections.telegram.botToken,
        },
        replicaChat: {
          rules,
        },
        trafficSources: {
          routes,
          rooms,
          selectedDraftPair: {
            sourceRoomId: selectedSourceIds[0] || selectedSourceId,
            sourceRoomIds: selectedSourceIds,
            destinationRoomId: selectedDestId,
          },
        },
        alertSettings,
      };
    },
    [
      credentials,
      connections.telegram.botToken,
      rules,
      routes,
      rooms,
      selectedSourceId,
      selectedSourceIds,
      selectedDestId,
      alertSettings,
    ]
  );

  const handleDownloadSettings = (scope: 'all' | 'affiliates' | 'replica' | 'routing') => {
    const payload = buildExportPayload(scope);
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filenameMap: Record<'all' | 'affiliates' | 'replica' | 'routing', string> = {
      all: `configuracoes-completas-bot-${dateSlug}.json`,
      affiliates: `configuracoes-apis-chaves-${dateSlug}.json`,
      replica: `configuracoes-replica-chat-${dateSlug}.json`,
      routing: `configuracoes-fontes-trafego-${dateSlug}.json`,
    };
    const link = document.createElement('a');
    link.href = url;
    link.download = filenameMap[scope];
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    triggerToast(`Arquivo "${filenameMap[scope]}" baixado com sucesso!`);
  };

  const handleCopySettingsJson = (scope: 'all' | 'affiliates' | 'replica' | 'routing') => {
    const payload = buildExportPayload(scope);
    const jsonString = JSON.stringify(payload, null, 2);
    navigator.clipboard.writeText(jsonString);
    const labelMap: Record<'all' | 'affiliates' | 'replica' | 'routing', string> = {
      all: 'Todas as Configurações',
      affiliates: 'APIs & Chaves',
      replica: 'Replica Chat',
      routing: 'Fontes de Tráfego',
    };
    triggerToast(`JSON de "${labelMap[scope]}" copiado para a área de transferência!`);
  };

  const handleImportSettingsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        let restoredParts: string[] = [];

        const importedCreds = parsed?.apiCredentials?.credentials || parsed?.credentials;
        if (importedCreds && typeof importedCreds === 'object') {
          setCredentials(importedCreds);
          restoredParts.push('APIs & Chaves');
        }

        const importedTgToken =
          parsed?.apiCredentials?.telegramBotToken ?? parsed?.telegramBotToken;
        if (typeof importedTgToken === 'string') {
          setConnections((prev) => ({
            ...prev,
            telegram: {
              ...prev.telegram,
              botToken: importedTgToken,
            },
          }));
        }

        const importedRules = parsed?.replicaChat?.rules || parsed?.rules;
        if (importedRules && typeof importedRules === 'object') {
          setRules(importedRules);
          restoredParts.push('Replica Chat');
        }

        const importedRoutes = parsed?.trafficSources?.routes || parsed?.routes;
        if (Array.isArray(importedRoutes)) {
          setRoutes(importedRoutes);
          restoredParts.push('Fontes de Tráfego');
        }

        const importedRooms = parsed?.trafficSources?.rooms || parsed?.rooms;
        if (Array.isArray(importedRooms) && importedRooms.length > 0) {
          setRooms((prev) => {
            const map = new Map<string, ChatRoom>();
            for (const r of prev) map.set(r.id, r);
            for (const r of importedRooms) {
              if (r && r.id) map.set(r.id, r);
            }
            return Array.from(map.values());
          });
        }

        const importedDraft =
          parsed?.trafficSources?.selectedDraftPair || parsed?.selectedDraftPair;
        if (importedDraft?.sourceRoomId) setSelectedSourceId(importedDraft.sourceRoomId);
        if (Array.isArray(importedDraft?.sourceRoomIds)) {
          setSelectedSourceIds(importedDraft.sourceRoomIds);
        }
        if (importedDraft?.destinationRoomId) setSelectedDestId(importedDraft.destinationRoomId);

        if (parsed?.alertSettings && typeof parsed.alertSettings === 'object') {
          setAlertSettings((prev) => ({
            ...prev,
            ...parsed.alertSettings,
          }));
          restoredParts.push('Alertas');
        }

        if (restoredParts.length > 0) {
          triggerToast(`Configurações importadas com sucesso (${restoredParts.join(', ')})!`);
        } else {
          triggerToast('Arquivo JSON lido, mas nenhum bloco de configuração compatível foi encontrado.');
        }
      } catch {
        triggerToast('Arquivo JSON inválido. Selecione um arquivo exportado pelo sistema.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="h-16 border-b border-slate-800/90 bg-[#0B0F19]/95 sticky top-0 z-30 px-6 flex items-center justify-between gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('affiliates');
          }}
          className="text-base font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
        >
          Chat Bot Automático
        </a>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveModule('affiliates')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'affiliates'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            APIs & Chaves
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('connections')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'connections'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Conexões
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('rooms')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'rooms'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Grupos & Canais
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('routing')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'routing'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Fontes de Tráfego
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('replica')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'replica'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Replica Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('history')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeModule === 'history'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Histórico</span>
            <span className="text-xs font-mono text-emerald-400 tabular-nums">
              ({history.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('alerts')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeModule === 'alerts'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Alertas</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('settings')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeModule === 'settings'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-emerald-400" />
            <span>Configurações</span>
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveModule('replica');
              setReplicaSubTab('trigger_rules');
            }}
            className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Simulador Ao Vivo
          </button>
        </div>
      </header>

      {/* Main Workspace Layout: Sidebar (260px) + Content Viewport */}
      <div className="flex-1 flex max-w-[1440px] w-full mx-auto">
        <aside className="w-64 shrink-0 border-r border-slate-800/90 bg-[#0B0F19] p-4 hidden md:flex flex-col justify-between">
          <div className="space-y-6">
            <div>
              <p className="px-3 text-[11px] font-medium text-slate-500 mb-2">
                Módulos da Arquitetura
              </p>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveModule('affiliates')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'affiliates'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <KeyRound className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>1. APIs & Chaves</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {activeMarketplacesCount}/4
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('connections')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'connections'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>2. Conexões</span>
                  </span>
                  <span className="text-xs font-mono text-emerald-400 tabular-nums">
                    {connections.whatsapp.status === 'connected'
                      ? 'WPP ON'
                      : connections.whatsapp.status === 'reconnecting'
                      ? 'SYNC...'
                      : 'QR ATIVO'}{' '}
                    · {connections.telegram.status === 'online' ? 'TG' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('rooms')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'rooms'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>3. Grupos & Canais</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {rooms.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('routing')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'routing'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <GitFork className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>4. Fontes de Tráfego</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {activeRoutesCount} ativas
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('replica')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'replica'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>5. Replica Chat</span>
                  </span>
                  <span className="text-xs font-mono text-emerald-400 tabular-nums">
                    OG:Img
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('history')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'history'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>6. Histórico</span>
                  </span>
                  <span className="text-xs font-mono text-emerald-400 tabular-nums font-semibold">
                    {history.length} enviados
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('alerts')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'alerts'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Bell className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>7. Alertas</span>
                  </span>
                  <span className="text-xs font-mono text-amber-400 tabular-nums">
                    {alertSettings.enabled && alertSettings.targetPhone ? 'ATIVO' : 'CONFIG'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('settings')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeModule === 'settings'
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <Settings className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>8. Configurações</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    Exportar
                  </span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80 px-3 space-y-3">
              <p className="text-[11px] font-medium text-slate-500">
                Status do Motor de Replicação
              </p>
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Ofertas Convertidas</span>
                  <span className="font-mono text-slate-200 tabular-nums font-semibold">
                    {totalConvertedOffers}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Produtos no Histórico</span>
                  <span className="font-mono text-emerald-400 tabular-nums font-semibold">
                    {history.length} produtos
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Salas de Destino</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {destinationRooms.length} salas
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModule('history')}
                  className="w-full mt-2 py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span>Ver Produtos Enviados</span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleResetDemoData}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Configurações</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 space-y-6">
          {/* Mobile Navigation Bar */}
          <div className="flex md:hidden items-center gap-1 overflow-x-auto pb-2 border-b border-slate-800">
            {(
              [
                ['affiliates', '1. APIs'],
                ['connections', '2. Conexões'],
                ['rooms', '3. Grupos'],
                ['routing', '4. Rotas'],
                ['replica', '5. Replica Chat'],
                ['history', `6. Histórico (${history.length})`],
                ['alerts', '7. Alertas'],
                ['settings', '8. Configurações'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveModule(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
                  activeModule === id
                    ? 'bg-emerald-500 text-slate-950 font-semibold'
                    : 'text-slate-400 bg-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Toast Feedback Banner */}
          {toastMessage && (
            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-sm">
              <div className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{toastMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="text-xs text-emerald-400 hover:text-emerald-200 font-medium ml-4"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Contextual Module Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800/90">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span>Hub de Afiliados Automatizado</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400 font-medium">
                  {moduleMeta[activeModule].title.split('(')[0].trim()}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-white font-display">
                {moduleMeta[activeModule].title}
              </h1>
              <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                {moduleMeta[activeModule].subtitle}
              </p>
            </div>

            {activeModule === 'affiliates' && (
              <button
                type="button"
                onClick={handleSaveCredentials}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer self-start"
              >
                <Check className="w-4 h-4" />
                <span>Salvar Configurações</span>
              </button>
            )}

            {activeModule === 'connections' && (
              <button
                type="button"
                onClick={handleRefreshQrCode}
                disabled={isGeneratingQr}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer self-start"
              >
                <RefreshCw className={`w-4 h-4 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                <span>Gerar Novo QR Code</span>
              </button>
            )}

            {activeModule === 'rooms' && (
              <div className="flex items-center gap-2.5 self-start">
                <button
                  type="button"
                  onClick={handleSyncMetadata}
                  disabled={isSyncingRooms}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-lg border border-slate-700 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRooms ? 'animate-spin' : ''}`} />
                  <span>{isSyncingRooms ? 'Sincronizando...' : 'Sincronizar Grupos Reais'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddRoomOpen((prev) => !prev)}
                  className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Vincular Sala</span>
                </button>
              </div>
            )}

            {activeModule === 'routing' && (
              <button
                type="button"
                onClick={() => setIsCreateRouteOpen((prev) => !prev)}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer self-start"
              >
                <Plus className="w-4 h-4" />
                <span>Criar Roteamento de Fonte</span>
              </button>
            )}
          </div>

          {/* =====================================================================
              MODULE 1: CONFIGURAÇÕES DE AFILIADOS (APIs & CHAVES)
             ===================================================================== */}
          {activeModule === 'affiliates' && (
            <form onSubmit={handleSaveCredentials} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>Integração Oficial #01</span>
                        <span aria-hidden="true">·</span>
                        <span>amzn.to / amazon.com.br</span>
                      </div>
                      <h2 className="text-lg font-semibold text-white mt-0.5">
                        Amazon Associados
                      </h2>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={credentials.amazon.enabled}
                      onClick={() =>
                        setCredentials((prev) => ({
                          ...prev,
                          amazon: { ...prev.amazon, enabled: !prev.amazon.enabled },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        credentials.amazon.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {credentials.amazon.enabled ? 'ATIVO (ON)' : 'INATIVO (OFF)'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Tag de Associado (Associate Tag)
                      </label>
                      <input
                        type="text"
                        value={credentials.amazon.associateTag}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            amazon: {
                              ...prev.amazon,
                              associateTag: val,
                              enabled: Boolean(val.trim()),
                            },
                          }));
                        }}
                        placeholder="ex: sua-tag-20"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Injetada automaticamente no parâmetro <code className="text-slate-300">?tag=</code> em todos os links descompactados da Amazon.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Formato gerado:</span>
                    <span className="font-mono text-slate-300 truncate max-w-[260px]">
                      {credentials.amazon.associateTag.trim()
                        ? `amazon.com.br/dp/SKU?tag=${credentials.amazon.associateTag.trim()}`
                        : 'Aguardando tag de associado'}
                    </span>
                  </div>
                </section>

                <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>Integração Oficial #02</span>
                        <span aria-hidden="true">·</span>
                        <span>meli.la / mercadolivre.com.br</span>
                      </div>
                      <h2 className="text-lg font-semibold text-white mt-0.5">
                        Mercado Livre Afiliados
                      </h2>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={credentials.mercadoLivre.enabled}
                      onClick={() =>
                        setCredentials((prev) => ({
                          ...prev,
                          mercadoLivre: {
                            ...prev.mercadoLivre,
                            enabled: !prev.mercadoLivre.enabled,
                          },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        credentials.mercadoLivre.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {credentials.mercadoLivre.enabled ? 'ATIVO (ON)' : 'INATIVO (OFF)'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Tag de Afiliado (Parâmetros matt_word & matt_tool)
                      </label>
                      <input
                        type="text"
                        value={credentials.mercadoLivre.affiliateTag}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            mercadoLivre: {
                              ...prev.mercadoLivre,
                              affiliateTag: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.mercadoLivre.sessionCookie.trim()),
                            },
                          }));
                        }}
                        placeholder="matt_word=seu_usuario&matt_tool=12345678"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          Cookie de Sessão do Painel (Extração via Sessão Ativa)
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('mlCookie')}
                          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {showSecrets['mlCookie'] ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Ocultar</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Mostrar</span>
                            </>
                          )}
                        </button>
                      </div>
                      <input
                        type={showSecrets['mlCookie'] ? 'text' : 'password'}
                        value={credentials.mercadoLivre.sessionCookie}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            mercadoLivre: {
                              ...prev.mercadoLivre,
                              sessionCookie: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.mercadoLivre.affiliateTag.trim()),
                            },
                          }));
                        }}
                        placeholder="orgnickp=...; ssid=..."
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Status da Sessão ML:</span>
                    {credentials.mercadoLivre.sessionCookie.trim() ? (
                      <span className="text-emerald-400 font-medium">
                        Cookie Autenticado · Geração Link Curto Ativa
                      </span>
                    ) : credentials.mercadoLivre.affiliateTag.trim() ? (
                      <span className="text-amber-400 font-medium">
                        Tag Configurada · Sem Cookie de Sessão
                      </span>
                    ) : (
                      <span className="text-slate-500 font-medium">
                        Aguardando configuração
                      </span>
                    )}
                  </div>
                </section>

                <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>Integração Oficial #03</span>
                        <span aria-hidden="true">·</span>
                        <span>shope.ee / s.shopee.com.br</span>
                      </div>
                      <h2 className="text-lg font-semibold text-white mt-0.5">
                        Shopee Open API Afiliados
                      </h2>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={credentials.shopee.enabled}
                      onClick={() =>
                        setCredentials((prev) => ({
                          ...prev,
                          shopee: { ...prev.shopee, enabled: !prev.shopee.enabled },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        credentials.shopee.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {credentials.shopee.enabled ? 'ATIVO (ON)' : 'INATIVO (OFF)'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Shopee App ID
                      </label>
                      <input
                        type="text"
                        value={credentials.shopee.appId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            shopee: {
                              ...prev.shopee,
                              appId: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.shopee.apiSecret.trim()),
                            },
                          }));
                        }}
                        placeholder="Informe seu App ID"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors tabular-nums"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          API Secret (GraphQL Signature Key)
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('shopeeSecret')}
                          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {showSecrets['shopeeSecret'] ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Ocultar</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Mostrar</span>
                            </>
                          )}
                        </button>
                      </div>
                      <input
                        type={showSecrets['shopeeSecret'] ? 'text' : 'password'}
                        value={credentials.shopee.apiSecret}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            shopee: {
                              ...prev.shopee,
                              apiSecret: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.shopee.appId.trim()),
                            },
                          }));
                        }}
                        placeholder="Informe sua API Secret"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Endpoint:</span>
                    <span className="font-mono text-slate-300">
                      open-api.affiliate.shopee.com.br/graphql
                    </span>
                  </div>
                </section>

                <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>Integração Oficial #04</span>
                        <span aria-hidden="true">·</span>
                        <span>s.click.aliexpress.com</span>
                      </div>
                      <h2 className="text-lg font-semibold text-white mt-0.5">
                        AliExpress Portals API
                      </h2>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={credentials.aliExpress.enabled}
                      onClick={() =>
                        setCredentials((prev) => ({
                          ...prev,
                          aliExpress: {
                            ...prev.aliExpress,
                            enabled: !prev.aliExpress.enabled,
                          },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        credentials.aliExpress.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {credentials.aliExpress.enabled ? 'ATIVO (ON)' : 'INATIVO (OFF)'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        App Key
                      </label>
                      <input
                        type="text"
                        value={credentials.aliExpress.appKey}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            aliExpress: {
                              ...prev.aliExpress,
                              appKey: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.aliExpress.trackingId.trim()) ||
                                Boolean(prev.aliExpress.appSecret.trim()),
                            },
                          }));
                        }}
                        placeholder="Informe sua App Key"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Tracking ID
                      </label>
                      <input
                        type="text"
                        value={credentials.aliExpress.trackingId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            aliExpress: {
                              ...prev.aliExpress,
                              trackingId: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.aliExpress.appKey.trim()) ||
                                Boolean(prev.aliExpress.appSecret.trim()),
                            },
                          }));
                        }}
                        placeholder="Informe seu Tracking ID"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          App Secret API
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('aliSecret')}
                          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {showSecrets['aliSecret'] ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Ocultar</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Mostrar</span>
                            </>
                          )}
                        </button>
                      </div>
                      <input
                        type={showSecrets['aliSecret'] ? 'text' : 'password'}
                        value={credentials.aliExpress.appSecret}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCredentials((prev) => ({
                            ...prev,
                            aliExpress: {
                              ...prev.aliExpress,
                              appSecret: val,
                              enabled:
                                Boolean(val.trim()) ||
                                Boolean(prev.aliExpress.appKey.trim()) ||
                                Boolean(prev.aliExpress.trackingId.trim()),
                            },
                          }));
                        }}
                        placeholder="Informe sua App Secret"
                        className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Rastreamento Remessa Conforme:</span>
                    <span className="font-mono text-slate-300">
                      {credentials.aliExpress.trackingId.trim()
                        ? `aff_trace_key=${credentials.aliExpress.trackingId.trim()}`
                        : 'Aguardando Tracking ID'}
                    </span>
                  </div>
                </section>
              </div>

              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-slate-400">
                  <span>As credenciais ativas alimentam diretamente o motor </span>
                  <strong className="text-slate-200">Replica Chat</strong>
                  <span> em tempo real.</span>
                </div>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Salvar Configurações Globais
                </button>
              </div>
            </form>
          )}

          {/* =====================================================================
              MODULE 2: CONEXÕES (WHATSAPP QR CODE FUNCIONAL & TELEGRAM BOTFATHER)
             ===================================================================== */}
          {activeModule === 'connections' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Canal de Entrada & Saída</span>
                      <span aria-hidden="true">·</span>
                      <span>Baileys Multi-Device (Sessão Persistente)</span>
                    </div>
                    <h2 className="text-lg font-semibold text-white mt-0.5">
                      Sessão WhatsApp (Leitor de QR Code)
                    </h2>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`inline-block text-xs font-mono font-semibold px-2.5 py-1 rounded border ${
                        connections.whatsapp.status === 'connected'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                          : connections.whatsapp.status === 'reconnecting'
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {connections.whatsapp.status === 'connected'
                        ? 'CONECTADO & ESCUTANDO MENSAGENS'
                        : connections.whatsapp.status === 'reconnecting'
                        ? 'PAREANDO APARELHO (515 SYNC)...'
                        : 'QR CODE PRONTO PARA LEITURA'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 py-1">
                  <WhatsAppQrMatrix
                    qrDataUrl={serverQrDataUrl}
                    fallbackPayload=""
                    status={
                      connections.whatsapp.status === 'connected'
                        ? 'connected'
                        : connections.whatsapp.status === 'reconnecting'
                        ? 'reconnecting'
                        : 'qr_ready'
                    }
                    remainingSec={qrRemainingSec}
                    mode="baileys_live"
                    onRefreshQr={handleRefreshQrCode}
                    isRefreshing={isGeneratingQr}
                  />

                  <div className="flex-1 space-y-4 text-sm w-full">
                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 space-y-2 text-xs">
                      <div className="font-semibold text-white">
                        Escaneie pelo aplicativo do WhatsApp:
                      </div>
                      <ol className="list-decimal list-inside space-y-1.5 text-slate-300 leading-relaxed">
                        <li>Abra o <strong>WhatsApp</strong> no seu celular</li>
                        <li>
                          Toque em <strong>Mais opções (⋮)</strong> ou{' '}
                          <strong>Configurações</strong> e selecione{' '}
                          <strong className="text-emerald-400">Aparelhos conectados</strong>
                        </li>
                        <li>
                          Toque em <strong>Conectar um aparelho</strong> e aponte para o QR Code ao lado.
                        </li>
                      </ol>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/80">
                        <span className="text-slate-400 block">Número Conectado</span>
                        <span className="font-mono text-white font-semibold tabular-nums mt-0.5 block">
                          {connections.whatsapp.status === 'connected'
                            ? connections.whatsapp.phoneNumber
                            : connections.whatsapp.status === 'reconnecting'
                            ? 'Validando aparelho...'
                            : 'Aguardando leitura...'}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/80">
                        <span className="text-slate-400 block">Status do Protocolo</span>
                        <span className="font-mono text-emerald-400 tabular-nums mt-0.5 block">
                          {connections.whatsapp.lastSync}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleRefreshQrCode}
                    disabled={isGeneratingQr}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                    <span>Gerar Novo QR Code</span>
                  </button>

                  {connections.whatsapp.status === 'connected' ? (
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveModule('routing')}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Configurar Roteamento de Grupos
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectWhatsApp}
                        className="px-3.5 py-2 bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Desconectar Sessão
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 font-mono">
                      Handshake automático pós-leitura ativo (Código 515 habilitado)
                    </span>
                  )}
                </div>
              </section>

              <section className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Subcategoria · Bot API Oficial</span>
                      <span aria-hidden="true">·</span>
                      <span>@BotFather</span>
                    </div>
                    <h2 className="text-lg font-semibold text-white mt-0.5">
                      Sessão Telegram (Bot Token)
                    </h2>
                  </div>

                  <span
                    className={`inline-block text-xs font-mono font-semibold px-2.5 py-1 rounded border whitespace-nowrap ${
                      connections.telegram.status === 'online'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                        : connections.telegram.status === 'validating'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                        : 'bg-red-500/15 text-red-400 border-red-500/40'
                    }`}
                  >
                    {connections.telegram.status === 'online'
                      ? `ONLINE · ${connections.telegram.pingMs}ms`
                      : connections.telegram.status === 'validating'
                      ? 'TESTANDO PING...'
                      : 'NÃO CONECTADO'}
                  </span>
                </div>

                <form onSubmit={handleValidateTelegramToken} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-slate-300">
                        Bot Token (Fornecido pelo @BotFather)
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility('tgToken')}
                        className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                      >
                        {showSecrets['tgToken'] ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Ocultar</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Mostrar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <input
                      type={showSecrets['tgToken'] ? 'text' : 'password'}
                      value={connections.telegram.botToken}
                      onChange={(e) =>
                        setConnections((prev) => ({
                          ...prev,
                          telegram: { ...prev.telegram, botToken: e.target.value },
                        }))
                      }
                      placeholder="1234567890:AAH_seu_token_do_botfather"
                      className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-slate-100 outline-none transition-colors"
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-[#0B0F19] border border-slate-800/90 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Username do Bot:</span>
                      <span className="font-mono text-slate-200">
                        {connections.telegram.botUsername || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Latência de Ping API:</span>
                      <span className="font-mono text-emerald-400 tabular-nums">
                        {connections.telegram.pingMs > 0
                          ? `${connections.telegram.pingMs} ms (api.telegram.org)`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Última Validação:</span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        {connections.telegram.lastValidatedAt}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/25 text-[11px] text-slate-300 leading-relaxed">
                    <strong className="text-emerald-300">Como sincronizar Grupos/Canais do Telegram:</strong>{' '}
                    Adicione seu bot ({connections.telegram.botUsername || '@seu_bot'}) como Admin no grupo/canal e envie qualquer mensagem lá dentro (ou informe o <code className="text-emerald-300">@username</code> / link <code className="text-emerald-300">t.me/</code> na aba <strong>3. Grupos & Canais</strong>).
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      Validação e escuta de canais ativa.
                    </span>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Validar Token & Testar Ping
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* =====================================================================
              MODULE 3: GRUPOS & CANAIS SINCRONIZADOS
             ===================================================================== */}
          {activeModule === 'rooms' && (
            <div className="space-y-5">
              {/* Always-available Quick Sync Bar for Telegram Groups/Channels & WhatsApp Channels */}
              <form
                onSubmit={handleCreateCustomRoom}
                className="bg-[#111827] border border-emerald-500/40 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Sincronizar Grupo/Canal do Telegram ou Canal do WhatsApp
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Cole o <strong>@username</strong>, link <strong>t.me/...</strong> ou ID (<strong>-100...</strong>) do Telegram, ou o link de um <strong>Canal do WhatsApp (whatsapp.com/channel/...)</strong> para puxar os dados reais via API.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div className="lg:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">
                      @Username, Link (t.me / whatsapp.com/channel) ou ID
                    </label>
                    <input
                      type="text"
                      required
                      value={newRoomIdentifier}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewRoomIdentifier(val);
                        if (val.includes('whatsapp.com/channel') || val.endsWith('@newsletter')) {
                          setNewRoomPlatform('whatsapp');
                          setNewRoomKind('channel');
                        } else if (val.includes('t.me/') || val.startsWith('@') || val.startsWith('-100')) {
                          setNewRoomPlatform('telegram');
                        }
                      }}
                      placeholder="Ex: @meu_canal, t.me/grupo ou whatsapp.com/channel/..."
                      className="w-full px-3 py-2 bg-[#0B0F19] border border-slate-800 rounded-lg text-xs font-mono text-white outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Nome Opcional
                    </label>
                    <input
                      type="text"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="Automático via API"
                      className="w-full px-3 py-2 bg-[#0B0F19] border border-slate-800 rounded-lg text-xs text-white outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Plataforma</label>
                    <select
                      value={newRoomPlatform}
                      onChange={(e) => setNewRoomPlatform(e.target.value as PlatformType)}
                      className="w-full px-3 py-2 bg-[#0B0F19] border border-slate-800 rounded-lg text-xs text-white outline-none"
                    >
                      <option value="telegram">Telegram</option>
                      <option value="whatsapp">WhatsApp (Canal)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tipo</label>
                    <select
                      value={newRoomKind}
                      onChange={(e) => setNewRoomKind(e.target.value as RoomKind)}
                      className="w-full px-3 py-2 bg-[#0B0F19] border border-slate-800 rounded-lg text-xs text-white outline-none"
                    >
                      <option value="group">Grupo</option>
                      <option value="channel">Canal</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Permissão</label>
                    <select
                      value={newRoomRole}
                      onChange={(e) => setNewRoomRole(e.target.value as RoomRole)}
                      className="w-full px-3 py-2 bg-[#0B0F19] border border-slate-800 rounded-lg text-xs text-white outline-none"
                    >
                      <option value="member">Membro (Fonte)</option>
                      <option value="admin">Admin (Destino)</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-slate-400">
                    Dica: Grupos privados onde o bot {connections.telegram.botUsername || 'Telegram'} está presente também aparecem sozinhos assim que qualquer mensagem é enviada neles.
                  </span>
                  <button
                    type="submit"
                    disabled={isLookingUpRoom}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {isLookingUpRoom ? 'Consultando API...' : 'Sincronizar via API'}
                  </button>
                </div>
              </form>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="inline-flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg self-start">
                  {(
                    [
                      ['all', `Todos (${rooms.length})`],
                      [
                        'whatsapp',
                        `WhatsApp (${rooms.filter((r) => r.platform === 'whatsapp').length})`,
                      ],
                      [
                        'telegram',
                        `Telegram (${rooms.filter((r) => r.platform === 'telegram').length})`,
                      ],
                    ] as const
                  ).map(([tabKey, tabLabel]) => (
                    <button
                      key={tabKey}
                      type="button"
                      onClick={() => setRoomSubTab(tabKey)}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        roomSubTab === tabKey
                          ? 'bg-emerald-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tabLabel}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    placeholder="Buscar por nome ou ID da sala..."
                    className="w-full pl-9 pr-3.5 py-2 bg-[#111827] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0B0F19]/60">
                        <th className="py-3 px-4">ID da Sala</th>
                        <th className="py-3 px-4">Nome do Grupo / Canal</th>
                        <th className="py-3 px-4">Plataforma & Tipo</th>
                        <th className="py-3 px-4 text-right">Membros Estimados</th>
                        <th className="py-3 px-4">Permissão (Clique p/ Alternar)</th>
                        <th className="py-3 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-sm">
                      {filteredRooms.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                            Nenhum grupo ou canal encontrado para o filtro selecionado.
                          </td>
                        </tr>
                      ) : (
                        filteredRooms.map((room) => (
                          <tr
                            key={room.id}
                            className="hover:bg-slate-800/35 transition-colors"
                          >
                            <td className="py-3 px-4 font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                              {room.roomCode}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-100">
                              <div>{room.name}</div>
                              <div className="text-[11px] text-slate-500">
                                {room.syncedAt}
                                {rules.antiWatermark.blacklistedRoomIds.includes(room.id) && (
                                  <>
                                    <span> · </span>
                                    <span className="text-amber-400">
                                      Filtro Anti-Marca d’Água Ativo
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-300 whitespace-nowrap">
                              <span className="font-medium text-white">
                                {room.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                              </span>
                              <span aria-hidden="true" className="mx-1.5 text-slate-600">
                                ·
                              </span>
                              <span className="font-mono text-xs text-emerald-400">
                                {room.kind === 'channel' ? 'Canal' : 'Grupo'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs text-slate-200 tabular-nums whitespace-nowrap">
                              {room.membersCount.toLocaleString('pt-BR')}
                            </td>
                            <td className="py-3 px-4 text-xs whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleToggleRoomRole(room)}
                                title="Clique para alternar papel (Membro / Administrador) — envio liberado em ambos"
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors cursor-pointer ${
                                  room.role === 'admin'
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
                                }`}
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>
                                  {room.role === 'admin'
                                    ? 'Administrador'
                                    : 'Membro (Envio Liberado)'}
                                </span>
                              </button>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleDeleteRoom(room.id)}
                                title="Desvincular ou ocultar sala da listagem"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Excluir</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              MODULE 4: FONTES DE TRÁFEGO (ROTEAMENTO DE MENSAGENS REAL)
             ===================================================================== */}
          {activeModule === 'routing' && (
            <div className="space-y-6">
              {/* Helper Guide when real WhatsApp groups are connected */}
              {hasRealWhatsAppGroups && (
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-emerald-300 text-sm">
                      Seus grupos reais do WhatsApp estão conectados!
                    </div>
                    <p className="text-slate-300">
                      Selecione abaixo <strong>De Onde Copiar (Grupo Fonte)</strong> e{' '}
                      <strong>Para Onde Enviar (Grupo de Destino)</strong> usando seus grupos reais, ou altere diretamente os seletores nas rotas abaixo. Qualquer mensagem enviada no grupo de origem será replicada automaticamente!
                    </p>
                  </div>
                </div>
              )}

              {isCreateRouteOpen && (
                <form
                  onSubmit={handleCreateRoute}
                  className="bg-[#111827] border border-emerald-500/40 rounded-xl p-6 space-y-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        Criar Novo Roteamento Multi-Fonte (Vários Grupos Fontes → 1 Grupo Destino)
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Selecione um ou vários grupos/canais como Fontes (De Onde Copiar) e escolha o grupo/canal de Destino onde o bot enviará todas as ofertas convertidas.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCreateRouteOpen(false)}
                      className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Ocultar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {/* Multi-Source Group Selector (Left 7 Cols) */}
                    <div className="lg:col-span-7 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="block text-xs font-medium text-slate-200">
                          1. Grupos/Canais Fontes (De Onde Copiar — Selecione 1 ou Vários)
                        </label>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-semibold tabular-nums">
                            {selectedSourceIds.filter((id) => id !== selectedDestId).length} selecionados
                          </span>
                          <button
                            type="button"
                            onClick={handleSelectAllSourcesInBuilder}
                            className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                          >
                            Marcar Todos
                          </button>
                          <span className="text-slate-600">·</span>
                          <button
                            type="button"
                            onClick={handleClearSourcesInBuilder}
                            className="text-slate-400 hover:text-slate-200 cursor-pointer"
                          >
                            Limpar
                          </button>
                        </div>
                      </div>

                      {rooms.length > 4 && (
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={sourceBuilderSearch}
                            onChange={(e) => setSourceBuilderSearch(e.target.value)}
                            placeholder="Filtrar grupos/canais fontes por nome..."
                            className="w-full pl-9 pr-3 py-1.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-slate-100 outline-none"
                          />
                        </div>
                      )}

                      <div className="bg-[#0B0F19] border border-slate-800 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-800/60">
                        {rooms.length === 0 ? (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Nenhum grupo ou canal sincronizado ainda. Conecte seu WhatsApp/Telegram na aba 2. Conexões ou adicione na aba 3. Grupos & Canais.
                          </div>
                        ) : (
                          rooms
                            .filter((rm) => {
                              const q = sourceBuilderSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                rm.name.toLowerCase().includes(q) ||
                                rm.roomCode.toLowerCase().includes(q)
                              );
                            })
                            .map((room) => {
                              const isDest = room.id === selectedDestId;
                              const isChecked =
                                !isDest && selectedSourceIds.includes(room.id);

                              return (
                                <label
                                  key={room.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (!isDest) {
                                      handleToggleSourceInTopBuilder(room.id);
                                    }
                                  }}
                                  className={`px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs transition-colors select-none ${
                                    isDest
                                      ? 'opacity-45 cursor-not-allowed bg-slate-900/30'
                                      : isChecked
                                      ? 'bg-emerald-500/10 hover:bg-emerald-500/15 cursor-pointer'
                                      : 'hover:bg-slate-800/40 cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                      className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                                        isChecked
                                          ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                                          : 'border-slate-600 bg-slate-900'
                                      }`}
                                    >
                                      {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 shrink-0">
                                      {room.platform === 'whatsapp' ? 'WPP' : 'TG'} ·{' '}
                                      {room.kind === 'channel' ? 'Canal' : 'Grupo'}
                                    </span>
                                    <span className="font-medium text-slate-100 truncate">
                                      {room.name}
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                    {isDest
                                      ? 'Selecionado como Destino'
                                      : isChecked
                                      ? 'Fonte Selecionada'
                                      : 'Clique p/ marcar'}
                                  </span>
                                </label>
                              );
                            })
                        )}
                      </div>
                    </div>

                    {/* Destination Group & Route Activation (Right 5 Cols) */}
                    <div className="lg:col-span-5 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-emerald-400 mb-1.5">
                          2. Grupo/Canal de Destino (Para Onde Enviar)
                        </label>
                        <select
                          value={selectedDestId}
                          onChange={(e) => handleSelectDestInTopBuilder(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-slate-100 outline-none"
                        >
                          {rooms.length === 0 && (
                            <option value="">Sincronize seus grupos primeiro...</option>
                          )}
                          {rooms.some((r) => r.platform === 'whatsapp') && (
                            <optgroup label="WhatsApp (Envio liberado para membros e admins)">
                              {rooms
                                .filter((r) => r.platform === 'whatsapp')
                                .map((room) => (
                                  <option key={room.id} value={room.id}>
                                    [WHATSAPP] {room.name} {room.kind === 'channel' ? '(Canal)' : '(Grupo)'}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          {rooms.some((r) => r.platform === 'telegram') && (
                            <optgroup label="Telegram (Requer bot adicionado ao canal)">
                              {rooms
                                .filter((r) => r.platform === 'telegram')
                                .map((room) => (
                                  <option key={room.id} value={room.id}>
                                    [TELEGRAM] {room.name}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          3. Nome da Rota (Opcional)
                        </label>
                        <div className="flex items-center gap-2.5">
                          <input
                            type="text"
                            value={newRouteName}
                            onChange={(e) => setNewRouteName(e.target.value)}
                            placeholder="Ex: 5 Fontes de Promoções → Grupo VIP..."
                            className="flex-1 px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-slate-100 outline-none"
                          />
                          <button
                            type="submit"
                            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Ativar Rota</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              )}

              {/* Active & Paused Traffic Routes List with Multi-Source Chips & Real Test Button */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Mapeamentos de Roteamento Configurados ({routes.length})
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Adicione ou remova múltiplos grupos fontes diretamente em cada rota abaixo, altere o grupo de destino ou clique em "Testar Disparo Real".
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-slate-800/80">
                  {routes.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                      <p className="text-sm text-slate-400">
                        Nenhum roteamento de fonte configurado no momento.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsCreateRouteOpen(true)}
                        className="px-4 py-2 bg-emerald-500 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer"
                      >
                        Criar Primeiro Roteamento
                      </button>
                    </div>
                  ) : (
                    routes.map((route) => {
                      const routeSourceIds = getRouteSourceIds(route);
                      const dest = getRoomById(route.destinationRoomId);
                      const availableToAdd = rooms.filter(
                        (rm) =>
                          rm.id !== route.destinationRoomId &&
                          !routeSourceIds.includes(rm.id)
                      );

                      return (
                        <div
                          key={route.id}
                          className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-800/25 transition-colors"
                        >
                          <div className="space-y-3 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span className="font-semibold text-slate-200">
                                {route.name}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px] tabular-nums">
                                {routeSourceIds.length} grupo(s) fonte(s) → 1 destino
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                Status: {route.lastDispatchedAt}
                              </span>
                            </div>

                            {/* Interactive Multi-Source -> Single Destination Selectors */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center pt-1">
                              <div className="lg:col-span-7 p-3 rounded-lg bg-[#0B0F19] border border-slate-800 space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="block text-[10px] text-slate-400 font-mono">
                                    GRUPOS/CANAIS FONTES ({routeSourceIds.length} SELECIONADOS):
                                  </label>
                                </div>

                                {/* Chips for each selected source group */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {routeSourceIds.map((srcId) => {
                                    const srcRoom = getRoomById(srcId);
                                    return (
                                      <span
                                        key={srcId}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/90 border border-slate-700 text-xs text-slate-100"
                                      >
                                        <span className="text-[10px] font-mono text-emerald-400">
                                          {srcRoom?.platform
                                            ? srcRoom.platform.toUpperCase()
                                            : 'FONTE'}
                                        </span>
                                        <span className="truncate max-w-[200px]">
                                          {srcRoom?.name || srcId}
                                        </span>
                                        {routeSourceIds.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleRemoveSourceFromExistingRoute(
                                                route.id,
                                                srcId
                                              )
                                            }
                                            title="Remover este grupo fonte da rota"
                                            className="ml-0.5 text-slate-400 hover:text-red-400 font-bold cursor-pointer"
                                          >
                                            ×
                                          </button>
                                        )}
                                      </span>
                                    );
                                  })}
                                </div>

                                {/* Add another source group inline selector */}
                                {availableToAdd.length > 0 && (
                                  <div className="pt-1 border-t border-slate-800/80">
                                    <select
                                      value=""
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleAddSourceToExistingRoute(
                                            route.id,
                                            e.target.value
                                          );
                                        }
                                      }}
                                      className="w-full bg-transparent text-xs text-emerald-400 font-medium outline-none cursor-pointer"
                                    >
                                      <option value="" className="bg-[#0B0F19] text-slate-400">
                                        + Adicionar outro grupo/canal fonte nesta rota...
                                      </option>
                                      {availableToAdd.map((rm) => (
                                        <option
                                          key={rm.id}
                                          value={rm.id}
                                          className="bg-[#0B0F19] text-white"
                                        >
                                          [{rm.platform.toUpperCase()}] {rm.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>

                              <div className="lg:col-span-1 flex justify-center">
                                <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0 hidden lg:block" />
                              </div>

                              <div className="lg:col-span-4 p-3 rounded-lg bg-[#0B0F19] border border-slate-800">
                                <label className="block text-[10px] text-emerald-400 font-mono mb-1.5">
                                  DESTINO (PARA ONDE ENVIAR):
                                </label>
                                <select
                                  value={route.destinationRoomId}
                                  onChange={(e) =>
                                    handleUpdateRouteRooms(
                                      route.id,
                                      'destinationRoomId',
                                      e.target.value
                                    )
                                  }
                                  className="w-full bg-transparent text-xs font-medium text-white outline-none cursor-pointer"
                                >
                                  {!dest && (
                                    <option value={route.destinationRoomId} className="bg-[#0B0F19]">
                                      [Selecione um grupo real de Destino...]
                                    </option>
                                  )}
                                  {rooms.map((rm) => (
                                    <option
                                      key={rm.id}
                                      value={rm.id}
                                      className="bg-[#0B0F19] text-white"
                                    >
                                      [{rm.platform.toUpperCase()}] {rm.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Route Actions */}
                          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800">
                            <div className="text-right mr-1">
                              <div className="text-xs font-mono font-semibold text-white tabular-nums">
                                {route.totalConverted} replicadas
                              </div>
                            </div>

                            <span className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19] text-emerald-400 border border-emerald-500/30 text-xs font-mono flex items-center gap-1.5 whitespace-nowrap">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                              <span>Escuta Ativa (Disparo Real)</span>
                            </span>

                            <button
                              type="button"
                              onClick={() => handleToggleRoute(route.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                                route.active
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {route.active ? 'ATIVA' : 'PAUSADA'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteRoute(route.id)}
                              className="p-2 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                              title="Excluir roteamento"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Real-Time Incoming Message Monitor */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Monitor de Escuta & Replicação em Tempo Real (WhatsApp / Telegram)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Qualquer mensagem recebida nos seus grupos conectados aparece instantaneamente abaixo.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 tabular-nums">
                    {lastInterceptStatus}
                  </span>
                </div>

                <div className="divide-y divide-slate-800/70">
                  {recentInterceptLogs.length === 0 ? (
                    <div className="py-8 px-5 text-center text-xs text-slate-400">
                      Aguardando novas mensagens nos grupos conectados... Envie ou receba ofertas nos grupos de Origem para que sejam replicadas em tempo real com proteção anti-duplicidade de 8 horas.
                    </div>
                  ) : (
                    recentInterceptLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/20"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-slate-400 tabular-nums">
                              {log.timestamp}
                            </span>
                            <span className="font-semibold text-white">
                              {log.groupName}
                            </span>
                            <span
                              className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                                log.status === 'replicated'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                  : log.status === 'duplicate_suppressed'
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                                  : log.status === 'error'
                                  ? 'bg-red-500/15 text-red-300 border-red-500/40'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {log.status === 'replicated'
                                ? 'REPLICADA COM SUCESSO'
                                : log.status === 'duplicate_suppressed'
                                ? 'REPETIDA (BLOQUEADA PELO ANTI-DUPLICIDADE)'
                                : log.status === 'error'
                                ? 'ERRO NO ENVIO'
                                : 'GRUPO SEM ROTA ATIVA'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 font-mono truncate">
                            "{log.previewText}"
                          </p>
                          <p className="text-[11px] text-slate-400">{log.detail}</p>
                        </div>

                        {log.status === 'ignored_no_route' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickBindGroupAsSource(log.groupId, log.groupName)
                            }
                            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Definir este Grupo como Origem
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              MODULE 5: REPLICA CHAT & REGRAS DE DISPARO
             ===================================================================== */}
          {activeModule === 'replica' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="inline-flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setReplicaSubTab('trigger_rules')}
                    className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      replicaSubTab === 'trigger_rules'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Regras de Disparo & Simulador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReplicaSubTab('anti_watermark')}
                    className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      replicaSubTab === 'anti_watermark'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Filtro Anti-Marca d’Água (OG:Image)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReplicaSubTab('replacement_params')}
                    className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      replicaSubTab === 'replacement_params'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Parâmetros de Substituição & Rodapé</span>
                  </button>
                </div>

                <div className="px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 select-none whitespace-nowrap">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Modo: Disparo 100% Mensagens Reais</span>
                </div>
              </div>

              {replicaSubTab === 'trigger_rules' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Parser de Links (Descompactação & Regex por Rede)
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Identifica links curtos ou completos, expande o redirecionamento, extrai o SKU original do produto e regera a URL com sua tag ativa.
                        </p>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        {(
                          [
                            ['mercadoLivre', 'Mercado Livre', 'meli\\.la|mercadolivre\\.com(\\.br)?'],
                            ['amazon', 'Amazon Brasil', 'amzn\\.to|amazon\\.com\\.br|a\\.co'],
                            ['shopee', 'Shopee Afiliados', 'shope\\.ee|s\\.shopee\\.com\\.br'],
                            ['aliExpress', 'AliExpress', 's\\.click\\.aliexpress\\.com|aliexpress\\.com'],
                          ] as const
                        ).map(([key, label, pattern]) => (
                          <div
                            key={key}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B0F19] border border-slate-800/90"
                          >
                            <div>
                              <span className="font-medium text-slate-200">{label}</span>
                              <span className="mx-2 text-slate-600">·</span>
                              <code className="text-[11px] text-emerald-400 font-mono">
                                /{pattern}/i
                              </code>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setRules((prev) => ({
                                  ...prev,
                                  parser: { ...prev.parser, [key]: !prev.parser[key] },
                                }))
                              }
                              className={`px-2.5 py-1 rounded font-mono text-[11px] font-semibold cursor-pointer ${
                                rules.parser[key]
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {rules.parser[key] ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Padronização de Layout da Oferta
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Preserva os elementos de conversão (título, preço e cupom) e descarta convites e chamadas concorrentes.
                        </p>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        {(
                          [
                            ['keepTitle', 'Manter Título e Headline do Produto'],
                            ['keepPrice', 'Manter Bloco de Preço Original e Parcelamento'],
                            ['keepCoupons', 'Manter Códigos de Cupom de Desconto'],
                            [
                              'discardCompetitorCta',
                              'Descartar Links de Convite e Call-to-Actions Concorrentes',
                            ],
                          ] as const
                        ).map(([field, label]) => (
                          <div
                            key={field}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B0F19] border border-slate-800/90"
                          >
                            <span className="text-slate-200 font-medium">{label}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setRules((prev) => ({
                                  ...prev,
                                  layout: { ...prev.layout, [field]: !prev.layout[field] },
                                }))
                              }
                              className={`px-2.5 py-1 rounded font-mono text-[11px] font-semibold cursor-pointer ${
                                rules.layout[field]
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {rules.layout[field] ? 'ATIVO' : 'INATIVO'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">
                              Filtro Anti-Duplicidade & Anti-Spam de Produtos Repetidos
                            </h3>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              RECOMENDADO
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                            Impede que o mesmo produto (mesmo link do concorrente ou mesmo título de oferta) seja reenviado para o grupo destino quando múltiplos grupos fontes postam a mesma promoção ou quando o concorrente reposta em sequência.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setRules((prev) => ({
                              ...prev,
                              antiDuplicate: {
                                enabled: !(prev.antiDuplicate?.enabled ?? true),
                                cooldownHours: prev.antiDuplicate?.cooldownHours ?? 8,
                              },
                            }))
                          }
                          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                            (rules.antiDuplicate?.enabled ?? true)
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {(rules.antiDuplicate?.enabled ?? true) ? 'ANTI-DUPLICIDADE ATIVO' : 'DESATIVADO'}
                        </button>
                      </div>

                      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="text-slate-300">
                          <span>Intervalo mínimo para permitir reenvio do mesmo produto ao mesmo destino:</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {([2, 4, 6, 8, 12, 24] as const).map((hours) => {
                            const isSelected = (rules.antiDuplicate?.cooldownHours ?? 8) === hours;
                            return (
                              <button
                                key={hours}
                                type="button"
                                onClick={() =>
                                  setRules((prev) => ({
                                    ...prev,
                                    antiDuplicate: {
                                      enabled: prev.antiDuplicate?.enabled ?? true,
                                      cooldownHours: hours,
                                    },
                                  }))
                                }
                                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-emerald-500 text-slate-950 font-bold'
                                    : 'bg-[#0B0F19] text-slate-400 hover:text-white border border-slate-800'
                                }`}
                              >
                                {hours}h {hours === 8 ? '(Padrão)' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          Bancada de Teste Ao Vivo: Interceptação & Conversão Replica Chat
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Selecione um exemplo real de promoção de concorrente ou cole qualquer mensagem abaixo para testar o parser e disparar diretamente na rota ativa.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {COMPETITOR_OFFER_SAMPLES.map((sample) => (
                          <button
                            key={sample.id}
                            type="button"
                            onClick={() => handleSelectOfferPreset(sample.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                              selectedSampleId === sample.id
                                ? 'bg-emerald-500 text-slate-950 font-semibold'
                                : 'bg-[#0B0F19] text-slate-300 hover:text-white border border-slate-800'
                            }`}
                          >
                            {sample.label.split('·')[0].trim()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                      <div className="lg:col-span-5 flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-amber-400">
                            1. MENSAGEM INTERCEPTADA (CONCORRENTE)
                          </span>
                          <select
                            value={simulatorSourceRoomId}
                            onChange={(e) => setSimulatorSourceRoomId(e.target.value)}
                            className="px-2.5 py-1 bg-[#0B0F19] border border-slate-800 rounded text-xs text-slate-300 outline-none"
                          >
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                Fonte: {r.name.slice(0, 28)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <textarea
                          rows={10}
                          value={simulatorRawText}
                          onChange={(e) => setSimulatorRawText(e.target.value)}
                          className="w-full flex-1 p-3.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs font-mono text-slate-200 leading-relaxed outline-none resize-none"
                        />

                        <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/90 space-y-1.5">
                          <div className="text-[11px] font-medium text-slate-400">
                            Itens Higienizados Automaticamente ({liveParsedResult.removedElements.length}):
                          </div>
                          {liveParsedResult.removedElements.length === 0 ? (
                            <p className="text-[11px] text-slate-500">
                              Nenhum ruído ou link concorrente detectado no texto atual.
                            </p>
                          ) : (
                            <ul className="space-y-1 text-[11px] font-mono text-red-300">
                              {liveParsedResult.removedElements.map((item, i) => (
                                <li key={i} className="truncate">
                                  ✕ {item}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="lg:col-span-3 flex flex-col justify-between space-y-3 bg-[#0B0F19] border border-slate-800 rounded-xl p-4">
                        <div className="text-xs font-semibold text-slate-200">
                          2. TRATAMENTO VISUAL (OG:IMAGE)
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="text-[11px] text-slate-400 mb-1">
                              Foto Recebida vs. OG:Image Oficial:
                            </div>
                            <ProductStudioIllustration
                              preset={liveParsedResult.productPreset}
                              mode={
                                liveParsedResult.watermarkIntercepted &&
                                rules.antiWatermark.strategy === 'og_image'
                                  ? 'clean_og_image'
                                  : 'competitor_watermarked'
                              }
                              sku={liveParsedResult.productSku}
                            />
                          </div>

                          <div className="space-y-1 text-[11px]">
                            <div className="text-emerald-400 font-medium">
                              {liveParsedResult.imageActionLabel}
                            </div>
                            <div className="text-slate-400 font-mono">
                              Fonte CDN: {liveParsedResult.ogImageMetadata.sourceDomain}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setReplicaSubTab('anti_watermark')}
                          className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg transition-colors cursor-pointer"
                        >
                          Configurar Lista Negra ({rules.antiWatermark.blacklistedRoomIds.length})
                        </button>
                      </div>

                      <div className="lg:col-span-4 flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-emerald-400">
                            3. MENSAGEM PRONTA PARA DISPARO
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(liveParsedResult.convertedText);
                              setCopiedPreview(true);
                              setTimeout(() => setCopiedPreview(false), 1800);
                            }}
                            className="text-xs text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>{copiedPreview ? 'Copiado!' : 'Copiar Texto'}</span>
                          </button>
                        </div>

                        <pre className="w-full flex-1 p-3.5 bg-[#0B0F19] border border-emerald-500/30 rounded-lg text-xs font-mono text-emerald-100 whitespace-pre-wrap break-words leading-relaxed overflow-y-auto max-h-[290px]">
                          {liveParsedResult.convertedText}
                        </pre>

                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(liveParsedResult.convertedText);
                              setCopiedPreview(true);
                              setTimeout(() => setCopiedPreview(false), 2000);
                              triggerToast('Texto convertido copiado para a área de transferência!');
                            }}
                            className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <Copy className="w-4 h-4" />
                            <span>
                              {copiedPreview
                                ? 'Copiado com Sucesso!'
                                : 'Copiar Texto Convertido'}
                            </span>
                          </button>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400 text-center">
                            🛡️ <strong className="text-slate-300">Modo Produção:</strong> Disparos ocorrem exclusivamente quando uma mensagem real chega nos grupos fontes configurados.
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="p-4 rounded-xl bg-[#111827] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-xs text-slate-300">
                      Todos os produtos convertidos e enviados com sucesso ficam armazenados na aba dedicada{' '}
                      <strong className="text-emerald-400">6. Histórico ({history.length} produtos)</strong>.
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveModule('history')}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-semibold text-xs rounded-lg border border-emerald-500/30 transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Abrir Aba Histórico ({history.length})</span>
                    </button>
                  </div>
                </div>
              )}

              {replicaSubTab === 'anti_watermark' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <section className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          Lista Negra de Grupos (Filtro Anti-Marca d’Água)
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          Selecione os grupos ou canais fontes que adicionam molduras, logotipos ou marcas d’água nas fotos das promoções.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setRules((prev) => ({
                            ...prev,
                            antiWatermark: {
                              ...prev.antiWatermark,
                              enabled: !prev.antiWatermark.enabled,
                            },
                          }))
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer whitespace-nowrap ${
                          rules.antiWatermark.enabled
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {rules.antiWatermark.enabled ? 'FILTRO ATIVO' : 'FILTRO INATIVO'}
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <label className="block text-xs font-medium text-slate-300">
                        Mecanismo de Substituição de Imagem
                      </label>
                      <div className="grid grid-cols-1 gap-2.5">
                        <label
                          className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                            rules.antiWatermark.strategy === 'og_image'
                              ? 'bg-emerald-950/30 border-emerald-500/50'
                              : 'bg-[#0B0F19] border-slate-800'
                          }`}
                        >
                          <input
                            type="radio"
                            name="imgStrategy"
                            checked={rules.antiWatermark.strategy === 'og_image'}
                            onChange={() =>
                              setRules((prev) => ({
                                ...prev,
                                antiWatermark: {
                                  ...prev.antiWatermark,
                                  strategy: 'og_image',
                                },
                              }))
                            }
                            className="mt-1 accent-emerald-500"
                          />
                          <div className="text-xs">
                            <div className="font-semibold text-white">
                              Extração Direta Open Graph (OG:Image) do Marketplace (Recomendado)
                            </div>
                            <p className="text-slate-400 mt-0.5 leading-relaxed">
                              Descarta a imagem enviada pelo grupo concorrente e extrai a foto oficial de estúdio em alta resolução diretamente dos metadados <code className="text-emerald-300">og:image</code> do link do produto (Mercado Livre, Shopee, Amazon ou AliExpress).
                            </p>
                          </div>
                        </label>

                        <label
                          className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                            rules.antiWatermark.strategy === 'strip_image'
                              ? 'bg-emerald-950/30 border-emerald-500/50'
                              : 'bg-[#0B0F19] border-slate-800'
                          }`}
                        >
                          <input
                            type="radio"
                            name="imgStrategy"
                            checked={rules.antiWatermark.strategy === 'strip_image'}
                            onChange={() =>
                              setRules((prev) => ({
                                ...prev,
                                antiWatermark: {
                                  ...prev.antiWatermark,
                                  strategy: 'strip_image',
                                },
                              }))
                            }
                            className="mt-1 accent-emerald-500"
                          />
                          <div className="text-xs">
                            <div className="font-semibold text-white">
                              Remover Imagem e Disparar Apenas Texto Comissionado
                            </div>
                            <p className="text-slate-400 mt-0.5">
                              Descarta a foto com marca d’água e permite que o próprio WhatsApp/Telegram gere o preview nativo do link.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">
                          Grupos Fontes Monitorados (Marque os que possuem Marca d’Água):
                        </span>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {rules.antiWatermark.blacklistedRoomIds.length} na Lista Negra
                        </span>
                      </div>

                      <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-[#0B0F19]">
                        {rooms.map((room) => {
                          const isBlacklisted =
                            rules.antiWatermark.blacklistedRoomIds.includes(room.id);
                          return (
                            <div
                              key={room.id}
                              className="p-3.5 flex items-center justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white truncate">
                                  {room.name}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {room.platform.toUpperCase()} · {room.roomCode}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleToggleBlacklistRoom(room.id)}
                                className={`px-3 py-1.5 rounded text-xs font-mono font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                                  isBlacklisted
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {isBlacklisted
                                  ? 'NA LISTA NEGRA (SUBSTITUIR FOTO)'
                                  : 'FOTO LIMPA (MANTER)'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        Inspeção Visual: Concorrente vs. Extração OG:Image
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Veja como o motor substitui a imagem poluída do concorrente pela foto limpa de estúdio do marketplace no momento da conversão.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="text-[11px] font-mono text-red-400 font-semibold">
                          ANTES (FOTO DO GRUPO FONTE)
                        </div>
                        <ProductStudioIllustration
                          preset={liveParsedResult.productPreset}
                          mode="competitor_watermarked"
                          sku={liveParsedResult.productSku}
                        />
                        <p className="text-[11px] text-slate-400">
                          Contém moldura amarela, @arroba do concorrente e telefone na imagem.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="text-[11px] font-mono text-emerald-400 font-semibold">
                          DEPOIS (OG:IMAGE EXTRAÍDA)
                        </div>
                        <ProductStudioIllustration
                          preset={liveParsedResult.productPreset}
                          mode="clean_og_image"
                          sku={liveParsedResult.productSku}
                        />
                        <p className="text-[11px] text-slate-400">
                          Foto oficial 1200×1200px extraída direto do HTML do produto sem ruído.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 text-xs space-y-1.5 font-mono">
                      <div className="text-slate-400">Tag HTML extraída no parser:</div>
                      <div className="text-emerald-300 truncate">
                        {'<meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_' +
                          liveParsedResult.productSku +
                          '-O.webp" />'}
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {replicaSubTab === 'replacement_params' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5 flex flex-col justify-between">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-base font-semibold text-white">
                            Rodapé Obrigatório do Ecossistema
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            Texto e link de captura fixados automaticamente ao final de todas as ofertas convertidas.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setRules((prev) => ({
                              ...prev,
                              replacement: {
                                ...prev.replacement,
                                footerEnabled: !prev.replacement.footerEnabled,
                              },
                            }))
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer whitespace-nowrap ${
                            rules.replacement.footerEnabled
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {rules.replacement.footerEnabled ? 'RODAPÉ ATIVO' : 'DESATIVADO'}
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          Conteúdo do Rodapé Obrigatório
                        </label>
                        <textarea
                          rows={4}
                          value={rules.replacement.mandatoryFooter}
                          onChange={(e) =>
                            setRules((prev) => ({
                              ...prev,
                              replacement: {
                                ...prev.replacement,
                                mandatoryFooter: e.target.value,
                              },
                            }))
                          }
                          className="w-full p-3.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs font-mono text-slate-100 outline-none leading-relaxed"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          setRules((prev) => ({
                            ...prev,
                            replacement: {
                              ...prev.replacement,
                              mandatoryFooter:
                                '👉 Compartilhe com os amigos:\nhttps://biolink.info/atacado-ofertas',
                            },
                          }))
                        }
                        className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        Restaurar Rodapé Padrão (biolink.info/atacado-ofertas)
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          triggerToast('Parâmetros de rodapé e sanitização salvos.')
                        }
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                      >
                        Salvar Rodapé
                      </button>
                    </div>
                  </section>

                  <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5 flex flex-col justify-between">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          Sanitização de Menções e Convites Externos
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          Remove automaticamente qualquer rastro de divulgação do concorrente antes do repasse da oferta.
                        </p>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-semibold text-white">
                              Remoção de Links de Convite Externos
                            </div>
                            <div className="text-slate-400 mt-0.5 font-mono text-[11px]">
                              Bloqueia chat.whatsapp.com/... e t.me/...
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setRules((prev) => ({
                                ...prev,
                                replacement: {
                                  ...prev.replacement,
                                  sanitizeInviteLinks: !prev.replacement.sanitizeInviteLinks,
                                },
                              }))
                            }
                            className={`px-3 py-1.5 rounded font-mono font-semibold cursor-pointer ${
                              rules.replacement.sanitizeInviteLinks
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {rules.replacement.sanitizeInviteLinks ? 'ATIVO' : 'OFF'}
                          </button>
                        </div>

                        <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-semibold text-white">
                              Remoção Automática de Arrobas (@menções)
                            </div>
                            <div className="text-slate-400 mt-0.5 font-mono text-[11px]">
                              Remove @usuarios, @canais e handles de Instagram/Telegram
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setRules((prev) => ({
                                ...prev,
                                replacement: {
                                  ...prev.replacement,
                                  sanitizeMentions: !prev.replacement.sanitizeMentions,
                                },
                              }))
                            }
                            className={`px-3 py-1.5 rounded font-mono font-semibold cursor-pointer ${
                              rules.replacement.sanitizeMentions
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {rules.replacement.sanitizeMentions ? 'ATIVO' : 'OFF'}
                          </button>
                        </div>

                        <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-semibold text-white">
                              Remoção de Números de Telefone & Contatos ADM
                            </div>
                            <div className="text-slate-400 mt-0.5 font-mono text-[11px]">
                              Remove padrões +55 (DD) 9XXXX-XXXX do corpo da promoção
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setRules((prev) => ({
                                ...prev,
                                replacement: {
                                  ...prev.replacement,
                                  sanitizePhones: !prev.replacement.sanitizePhones,
                                },
                              }))
                            }
                            className={`px-3 py-1.5 rounded font-mono font-semibold cursor-pointer ${
                              rules.replacement.sanitizePhones
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {rules.replacement.sanitizePhones ? 'ATIVO' : 'OFF'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 text-xs text-slate-400">
                      <span>Prévia do Rodapé Aplicado:</span>
                      <pre className="mt-1.5 font-mono text-emerald-300 whitespace-pre-wrap">
                        {rules.replacement.mandatoryFooter}
                      </pre>
                    </div>
                  </section>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* MODULE 6: HISTÓRICO DE PRODUTOS ENVIADOS E ERROS BLOQUEADOS    */}
          {/* ============================================================== */}
          {activeModule === 'history' && (
            <div className="space-y-6">
              {/* Filter & Search Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['all', `Todos (${history.length})`],
                      [
                        'mercadoLivre',
                        `Mercado Livre (${
                          history.filter((h) => h.marketplace === 'mercadoLivre').length
                        })`,
                      ],
                      [
                        'shopee',
                        `Shopee (${history.filter((h) => h.marketplace === 'shopee').length})`,
                      ],
                      [
                        'amazon',
                        `Amazon (${history.filter((h) => h.marketplace === 'amazon').length})`,
                      ],
                      [
                        'aliExpress',
                        `AliExpress (${
                          history.filter((h) => h.marketplace === 'aliExpress').length
                        })`,
                      ],
                    ] as const
                  ).map(([tabKey, label]) => (
                    <button
                      key={tabKey}
                      type="button"
                      onClick={() => setHistoryFilter(tabKey)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        historyFilter === tabKey
                          ? 'bg-emerald-500 text-slate-950 font-semibold'
                          : 'bg-[#0B0F19] text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19] border border-slate-800 text-[11px] font-mono text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Auto-limpeza: 8h</span>
                  </span>
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Buscar produto, erro ou link..."
                      className="w-full pl-9 pr-3.5 py-2 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-slate-100 outline-none"
                    />
                  </div>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllHistory}
                      className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpar Histórico</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Products Sent & Blocked List */}
              {filteredHistory.length === 0 ? (
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-12 text-center space-y-3">
                  <Clock className="w-8 h-8 text-slate-500 mx-auto" />
                  <div className="text-sm font-semibold text-white">
                    Nenhum registro encontrado neste filtro
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Assim que uma promoção for interceptada nos seus grupos fontes, ela aparecerá aqui com o link convertido (ou com o aviso de bloqueio caso esteja sem estoque, link quebrado ou API pendente).
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredHistory.map((item) => {
                    const srcRoom = getRoomById(item.sourceRoomId);
                    const dstRoom = getRoomById(item.destinationRoomId);
                    const marketplaceLabels: Record<MarketplaceId, string> = {
                      mercadoLivre: 'MERCADO LIVRE',
                      shopee: 'SHOPEE',
                      amazon: 'AMAZON',
                      aliExpress: 'ALIEXPRESS',
                    };
                    const isError = item.status === 'error';

                    if (isError) {
                      return (
                        <div
                          key={item.id}
                          className="bg-[#111827] border border-red-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="px-2.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-mono font-semibold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                <span>NÃO ENVIADO · {item.errorReason || 'Produto sem estoque'}</span>
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                                {marketplaceLabels[item.marketplace] || item.marketplace.toUpperCase()}
                              </span>
                              <span className="font-mono text-slate-400 tabular-nums text-[11px]">
                                Horário: {item.timestamp}
                              </span>
                            </div>

                            <div className="text-sm font-semibold text-white truncate">
                              {item.productTitle}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                              <span>
                                Link bloqueado:{' '}
                                <span className="text-red-300">{item.originalUrl}</span>
                              </span>
                              <span>·</span>
                              <span>
                                Origem: {srcRoom?.name || item.sourceRoomId}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={resendingHistoryId === item.id}
                              onClick={() => handleResendHistoryItem(item)}
                              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                              title="Tentar enviar novamente após arrumar o erro"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  resendingHistoryId === item.id ? 'animate-spin' : ''
                                }`}
                              />
                              <span>
                                {resendingHistoryId === item.id
                                  ? 'Tentando...'
                                  : 'Tentar Novamente'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteHistoryItem(item.id)}
                              className="p-2 rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition-colors cursor-pointer"
                              title="Remover do histórico"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className="bg-[#111827] border border-slate-800 hover:border-slate-700 rounded-xl p-5 space-y-4 transition-colors"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                          <div className="flex flex-wrap items-center gap-2.5 text-xs">
                            <span className="px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                              ENVIADO COM SUCESSO
                            </span>
                            <span className="px-2.5 py-1 rounded bg-slate-800 text-white font-mono font-semibold">
                              {marketplaceLabels[item.marketplace] || item.marketplace.toUpperCase()}
                            </span>
                            <span className="font-mono text-slate-400 tabular-nums">
                              Horário: {item.timestamp}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-300">
                              Origem:{' '}
                              <strong className="text-white">
                                {srcRoom?.name || item.sourceRoomId}
                              </strong>{' '}
                              → Destino:{' '}
                              <strong className="text-emerald-300">
                                {dstRoom?.name || item.destinationRoomId}
                              </strong>
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={resendingHistoryId === item.id}
                              onClick={() => handleResendHistoryItem(item)}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              {resendingHistoryId === item.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {resendingHistoryId === item.id
                                  ? 'Enviando...'
                                  : 'Enviar Novamente'}
                              </span>
                            </button>

                            {item.convertedUrl && item.convertedUrl.startsWith('http') && (
                              <a
                                href={item.convertedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Testar Link Afiliado</span>
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteHistoryItem(item.id)}
                              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition-colors cursor-pointer"
                              title="Remover este item do histórico"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                          <div className="lg:col-span-7 space-y-3">
                            <div>
                              <div className="text-[11px] font-mono text-slate-400 uppercase">
                                Produto Enviado
                              </div>
                              <h3 className="text-base font-bold text-white mt-0.5">
                                {item.productTitle}
                              </h3>
                            </div>

                            <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 space-y-2 text-xs font-mono">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-slate-500 text-[11px]">
                                  Link do Concorrente (Substituído):
                                </span>
                                <span className="text-red-400/80 line-through truncate max-w-md">
                                  {item.originalUrl}
                                </span>
                              </div>
                              <div className="border-t border-slate-800/80 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-emerald-400 font-semibold text-[11px]">
                                  Seu Link Comissionado Oficial:
                                </span>
                                <span className="text-emerald-300 font-semibold break-all">
                                  {item.convertedUrl}
                                </span>
                              </div>
                            </div>

                            {item.removedElements && item.removedElements.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                                <span className="text-amber-300 font-mono font-medium">
                                  Higienização aplicada:
                                </span>
                                {item.removedElements.map((el, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono"
                                  >
                                    {el}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="lg:col-span-5">
                            <div className="text-[11px] font-mono text-slate-400 uppercase mb-1.5">
                              Texto Completo Disparo no Grupo Destino:
                            </div>
                            <pre className="p-3.5 rounded-lg bg-[#0B0F19] border border-emerald-500/25 text-xs font-mono text-emerald-100 whitespace-pre-wrap break-words max-h-44 overflow-y-auto leading-relaxed">
                              {item.convertedText}
                            </pre>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* =================================================================
              MODULE 7: CENTRAL DE ALERTAS VIA WHATSAPP PRINCIPAL
             ================================================================= */}
          {activeModule === 'alerts' && (
            <div className="space-y-6">
              {/* Top Status Bar */}
              <div className="bg-[#111827] border border-amber-500/30 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-mono text-amber-400 uppercase">
                    <Bell className="w-4 h-4" />
                    <span>Notificação Automática pelo Número Principal Conectado</span>
                  </div>
                  <h2 className="text-base font-bold text-white">
                    Aviso de Erro de Envio Direto no seu WhatsApp
                  </h2>
                  <p className="text-xs text-slate-400 max-w-2xl">
                    Sempre que ocorrer um erro ao enviar para o grupo de destino ou falha que exija correção, o próprio número principal logado na aba <strong>2. Conexões</strong> enviará uma mensagem automática para o número abaixo explicando o que precisa ser verificado.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <span
                    className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold border ${
                      connections.whatsapp.status === 'connected'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : connections.whatsapp.status === 'reconnecting'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-red-500/15 text-red-300 border-red-500/30'
                    }`}
                  >
                    {connections.whatsapp.status === 'connected'
                      ? `WhatsApp Principal ON (${connections.whatsapp.phoneNumber || 'Conectado'})`
                      : connections.whatsapp.status === 'reconnecting'
                      ? `WhatsApp Reconectando... (${connections.whatsapp.phoneNumber || 'Sincronizando'})`
                      : 'WhatsApp Principal Desconectado'}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setAlertSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
                    }
                    className={`px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                      alertSettings.enabled
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {alertSettings.enabled ? 'ALERTAS ATIVOS' : 'ALERTAS PAUSADOS'}
                  </button>
                </div>
              </div>

              {/* Configuration Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left 7 Cols: Phone Number, Custom Message Prefix & Test Button */}
                <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        1. Número para Receber os Alertas & Formato da Mensagem
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Informe o número com DDD (ex: 5511999999999) que receberá os avisos de erro.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-slate-200">
                          Número de WhatsApp de Destino do Alerta (DDI + DDD + Número)
                        </label>
                        {connections.whatsapp.phoneNumber && (
                          <button
                            type="button"
                            onClick={() =>
                              setAlertSettings((prev) => ({
                                ...prev,
                                targetPhone: connections.whatsapp.phoneNumber.replace(/\D/g, ''),
                              }))
                            }
                            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                          >
                            Usar o próprio número conectado ({connections.whatsapp.phoneNumber})
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Smartphone className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={alertSettings.targetPhone}
                          onChange={(e) =>
                            setAlertSettings((prev) => ({
                              ...prev,
                              targetPhone: e.target.value,
                            }))
                          }
                          placeholder="Ex: 5511999999999 ou 11999999999"
                          className="w-full pl-10 pr-4 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs font-mono text-white outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-200 mb-1.5">
                          Texto Inicial do Alerta
                        </label>
                        <input
                          type="text"
                          value={alertSettings.customPrefix}
                          onChange={(e) =>
                            setAlertSettings((prev) => ({
                              ...prev,
                              customPrefix: e.target.value,
                            }))
                          }
                          placeholder="⚠️ Erro de envio, verifique:"
                          className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-white outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-200 mb-1.5">
                          Intervalo Anti-Spam (Mesmo Erro)
                        </label>
                        <select
                          value={alertSettings.cooldownMinutes}
                          onChange={(e) =>
                            setAlertSettings((prev) => ({
                              ...prev,
                              cooldownMinutes: Number(e.target.value),
                            }))
                          }
                          className="w-full px-3.5 py-2.5 bg-[#0B0F19] border border-slate-800 focus:border-emerald-500 rounded-lg text-xs text-white outline-none"
                        >
                          <option value={0}>Sem intervalo (Enviar toda vez)</option>
                          <option value={2}>A cada 2 minutos por erro igual</option>
                          <option value={5}>A cada 5 minutos por erro igual (Recomendado)</option>
                          <option value={15}>A cada 15 minutos por erro igual</option>
                          <option value={30}>A cada 30 minutos por erro igual</option>
                        </select>
                      </div>
                    </div>

                    {/* Preview of the WhatsApp Message */}
                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 space-y-1.5">
                      <div className="text-[11px] font-mono text-slate-400">
                        Exemplo da mensagem que chegará no número cadastrado:
                      </div>
                      <pre className="text-xs font-mono text-amber-300 whitespace-pre-wrap leading-relaxed">
                        {`${alertSettings.customPrefix || '⚠️ Erro de envio, verifique:'} Falha ao entregar no grupo destino "Grupo VIP de Ofertas" — verifique se o número tem permissão de Administrador no grupo ou se a conexão está ativa.\n📍 *Rota:* Fontes Promo → Grupo VIP\n🎯 *Grupo Destino:* Grupo VIP de Ofertas\n⏰ *Horário:* Agora`}
                      </pre>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <span className="text-[11px] text-slate-400">
                        As alterações são salvas e sincronizadas automaticamente com o servidor.
                      </span>
                      <button
                        type="button"
                        onClick={handleSendTestAlertNow}
                        disabled={isSendingTestAlert}
                        className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>
                          {isSendingTestAlert
                            ? 'Enviando no WhatsApp...'
                            : 'Enviar Alerta de Teste Agora'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right 5 Cols: Error Triggers */}
                <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-white">
                      2. Quais Erros Devem Disparar Mensagem
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Escolha em quais situações o sistema deve avisar no seu número.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-white">
                          Erro ao Enviar para o Grupo Destino
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Avisa quando o envio para o grupo destino falhar (grupo fechado para postagens, grupo removido ou queda de sessão).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            alertOnSendError: !prev.alertOnSendError,
                          }))
                        }
                        className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shrink-0 cursor-pointer ${
                          alertSettings.alertOnSendError
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {alertSettings.alertOnSendError ? 'ATIVO' : 'OFF'}
                      </button>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-white">
                          Erro de API ou Cookie Expirado (Para Corrigir)
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Avisa quando uma oferta for bloqueada porque o Cookie do Mercado Livre ou chave de API expirou/falhou.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            alertOnApiError: !prev.alertOnApiError,
                          }))
                        }
                        className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shrink-0 cursor-pointer ${
                          alertSettings.alertOnApiError
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {alertSettings.alertOnApiError ? 'ATIVO' : 'OFF'}
                      </button>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#0B0F19] border border-slate-800 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-white">
                          Link Quebrado ou Produto Sem Estoque
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Avisa também quando uma oferta do grupo concorrente for ignorada por estar esgotada ou com link inválido.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            alertOnBrokenLink: !prev.alertOnBrokenLink,
                          }))
                        }
                        className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shrink-0 cursor-pointer ${
                          alertSettings.alertOnBrokenLink
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {alertSettings.alertOnBrokenLink ? 'ATIVO' : 'OFF'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Alerts Dispatched Log */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Últimos Alertas Disparados pelo Sistema ({(alertSettings.recentAlerts || []).length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Registro em tempo real das mensagens de alerta enviadas para o número configurado.
                    </p>
                  </div>
                  {(alertSettings.recentAlerts || []).length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAlertLogs}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpar Alertas</span>
                    </button>
                  )}
                </div>

                <div className="divide-y divide-slate-800/70">
                  {!(alertSettings.recentAlerts || []).length ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Nenhum alerta precisou ser disparado ainda. Clique em <strong>Enviar Alerta de Teste Agora</strong> acima para testar o recebimento no seu celular!
                    </div>
                  ) : (
                    (alertSettings.recentAlerts || []).map((log) => (
                      <div
                        key={log.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/20"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                                log.status === 'sent'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-red-500/15 text-red-300 border-red-500/30'
                              }`}
                            >
                              {log.status === 'sent' ? 'ENVIADO NO WHATSAPP' : 'FALHA NO ENVIO'}
                            </span>
                            <span className="font-mono text-slate-300">
                              Para: <strong>{log.targetPhone}</strong>
                            </span>
                            {log.routeName && (
                              <span className="text-slate-400">· Rota: {log.routeName}</span>
                            )}
                            <span className="font-mono text-slate-500 tabular-nums">
                              · {log.timestamp}
                            </span>
                          </div>
                          <p className="text-xs text-amber-200 font-mono whitespace-pre-wrap">
                            {log.messageText}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              MODULE 8: CONFIGURAÇÕES (EXPORTAR & BAIXAR DADOS SALVOS)
             ================================================================= */}
          {activeModule === 'settings' && (
            <div className="space-y-6">
              {/* Primary Action Banner: Download Complete Package */}
              <div className="bg-[#111827] border border-emerald-500/30 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 uppercase">
                    <Settings className="w-4 h-4" />
                    <span>Pacote Completo de Configurações</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">
                    Baixar ou Exportar Todas as Configurações Salvas
                  </h2>
                  <p className="text-xs text-slate-400 max-w-2xl">
                    Gera um arquivo <code className="text-emerald-300">.json</code> contendo todas as suas chaves e cookies de <strong>APIs & Chaves</strong>, regras de higienização do <strong>Replica Chat</strong> e rotas de <strong>Fontes de Tráfego</strong>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadSettings('all')}
                    className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar Tudo (.JSON)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopySettingsJson('all')}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4 text-emerald-400" />
                    <span>Copiar Tudo</span>
                  </button>

                  <label className="px-4 py-2.5 rounded-lg bg-[#0B0F19] hover:bg-slate-900 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4 text-emerald-400" />
                    <span>Importar Backup (.JSON)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleImportSettingsFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Individual Module Export Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Card 1: APIs & Chaves */}
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-bold text-white">
                        <KeyRound className="w-4 h-4 text-emerald-400" />
                        <span>1. APIs & Chaves</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]">
                        {activeMarketplacesCount}/4 ativas
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      Inclui Associate Tag da Amazon, Tag e Cookie de Sessão do Mercado Livre, App ID/Secret da Shopee, App Key/Secret do AliExpress e Token do Bot Telegram.
                    </p>

                    <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/90 space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Mercado Livre:</span>
                        <span className={credentials.mercadoLivre.sessionCookie ? 'text-emerald-400' : 'text-slate-500'}>
                          {credentials.mercadoLivre.sessionCookie ? 'Configurado' : 'Vazio'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Shopee API:</span>
                        <span className={credentials.shopee.appId && credentials.shopee.apiSecret ? 'text-emerald-400' : 'text-slate-500'}>
                          {credentials.shopee.appId && credentials.shopee.apiSecret ? 'Configurado' : 'Vazio'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">AliExpress API:</span>
                        <span className={credentials.aliExpress.appKey && credentials.aliExpress.appSecret ? 'text-emerald-400' : 'text-slate-500'}>
                          {credentials.aliExpress.appKey && credentials.aliExpress.appSecret ? 'Configurado' : 'Vazio'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Amazon Tag:</span>
                        <span className={credentials.amazon.associateTag ? 'text-emerald-400' : 'text-slate-500'}>
                          {credentials.amazon.associateTag || 'Vazio'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleDownloadSettings('affiliates')}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar APIs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySettingsJson('affiliates')}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </button>
                  </div>
                </div>

                {/* Card 2: Replica Chat */}
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-bold text-white">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span>2. Replica Chat</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]">
                        Regras Salvas
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      Inclui gatilhos de marketplaces ativos, higienização de links de convite/menções/telefones, estratégia Anti-Marca d’Água (OG:Image) e rodapé obrigatório.
                    </p>

                    <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/90 space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Anti-Marca d’Água:</span>
                        <span className="text-emerald-400">
                          {rules.antiWatermark.enabled ? rules.antiWatermark.strategy.toUpperCase() : 'Desativado'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Remover Links Convite:</span>
                        <span className="text-emerald-400">
                          {rules.replacement.sanitizeInviteLinks ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Descartar CTA Concorrente:</span>
                        <span className="text-emerald-400">
                          {rules.layout.discardCompetitorCta ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Rodapé Obrigatório:</span>
                        <span className={rules.replacement.footerEnabled ? 'text-emerald-400' : 'text-slate-500'}>
                          {rules.replacement.footerEnabled ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleDownloadSettings('replica')}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar Replica Chat</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySettingsJson('replica')}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </button>
                  </div>
                </div>

                {/* Card 3: Fontes de Tráfego */}
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-bold text-white">
                        <GitFork className="w-4 h-4 text-emerald-400" />
                        <span>3. Fontes de Tráfego</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]">
                        {routes.length} rotas
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      Inclui todas as rotas de replicação configuradas (Origem → Destino), mapeamento de grupos e canais sincronizados e permissões salvas.
                    </p>

                    <div className="p-3 rounded-lg bg-[#0B0F19] border border-slate-800/90 space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Rotas Configuradas:</span>
                        <span className="text-emerald-400">{routes.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Rotas Ativas:</span>
                        <span className="text-emerald-400">{activeRoutesCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Grupos/Canais Salvos:</span>
                        <span className="text-slate-200">{rooms.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Salas para Envio:</span>
                        <span className="text-emerald-400">{rooms.length}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleDownloadSettings('routing')}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar Fontes de Tráfego</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySettingsJson('routing')}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Live JSON Preview of All Saved Settings */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Pré-visualização do Arquivo de Exportação (JSON Completo)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Dados em tempo real salvos em APIs & Chaves, Replica Chat e Fontes de Tráfego.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopySettingsJson('all')}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copiar JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadSettings('all')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar Arquivo</span>
                    </button>
                  </div>
                </div>

                <pre className="p-4 rounded-lg bg-[#0B0F19] border border-slate-800 text-xs font-mono text-emerald-200 overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
                  {JSON.stringify(buildExportPayload('all'), null, 2)}
                </pre>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
