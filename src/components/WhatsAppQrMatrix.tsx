import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { RefreshCw, CheckCircle2, Smartphone, Loader2 } from 'lucide-react';

interface WhatsAppQrMatrixProps {
  qrDataUrl: string | null;
  fallbackPayload: string;
  status: 'connected' | 'disconnected' | 'reconnecting' | 'connecting' | 'qr_ready';
  remainingSec: number;
  mode: 'baileys_live' | 'camera_pair';
  onRefreshQr: () => void;
  isRefreshing?: boolean;
}

export const WhatsAppQrMatrix: React.FC<WhatsAppQrMatrixProps> = ({
  qrDataUrl,
  fallbackPayload,
  status,
  remainingSec,
  mode,
  onRefreshQr,
  isRefreshing = false,
}) => {
  const [localQrUrl, setLocalQrUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (qrDataUrl) {
      setLocalQrUrl(qrDataUrl);
      return;
    }
    if (mode === 'camera_pair') {
      QRCode.toDataURL(fallbackPayload, {
        width: 280,
        margin: 2,
        color: {
          dark: '#020617',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      })
        .then((url) => {
          if (active) setLocalQrUrl(url);
        })
        .catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [qrDataUrl, fallbackPayload, mode]);

  const displayUrl = mode === 'baileys_live' ? qrDataUrl : localQrUrl;

  return (
    <div className="flex flex-col items-center space-y-2.5 shrink-0">
      <div className="relative w-[224px] h-[224px] bg-white rounded-xl p-3 border-2 border-slate-700 shadow-lg flex items-center justify-center overflow-hidden">
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="QR Code de Pareamento WhatsApp"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-contain transition-opacity duration-200 ${
              status === 'connected'
                ? 'opacity-15 blur-[1px]'
                : status === 'reconnecting' || isRefreshing
                ? 'opacity-30'
                : 'opacity-100'
            }`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-900 space-y-2 p-4 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
            <span className="text-xs font-semibold">
              {status === 'reconnecting'
                ? 'Finalizando pareamento...'
                : 'Obtendo QR Code do WhatsApp...'}
            </span>
          </div>
        )}

        {/* Handshake / Post-Scan Sync Overlay */}
        {(status === 'reconnecting' || isRefreshing) && status !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-[2px] p-4 text-center">
            <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mb-2" />
            <span className="text-xs font-semibold text-white">
              {isRefreshing
                ? 'Gerando Novo QR Code...'
                : 'Sincronizando com seu Celular...'}
            </span>
            <span className="text-[11px] text-emerald-300 mt-1 font-mono">
              {isRefreshing ? 'Aguarde 1s' : 'Validando chaves Multi-Device'}
            </span>
          </div>
        )}

        {/* Connected State Overlay */}
        {status === 'connected' && !isRefreshing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-[2px] p-4 text-center space-y-2.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            <div>
              <div className="text-xs font-bold text-emerald-400 tracking-wide">
                WHATSAPP CONECTADO
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Sessão Salva & Grupos Sincronizados
              </div>
            </div>
            <button
              type="button"
              onClick={onRefreshQr}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              Trocar Aparelho / Novo QR Code
            </button>
          </div>
        )}

        {/* Subtle Corner Badge when QR is ready */}
        {status !== 'connected' && status !== 'reconnecting' && !isRefreshing && displayUrl && (
          <div className="absolute bottom-1.5 right-1.5 pointer-events-none">
            <div className="w-6 h-6 rounded-md bg-emerald-500 border border-white shadow flex items-center justify-center">
              <Smartphone className="w-3.5 h-3.5 text-slate-950" />
            </div>
          </div>
        )}
      </div>

      {/* Status Bar Below QR */}
      {status !== 'connected' && (
        <div className="w-[224px] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-emerald-400 font-medium">
              {status === 'reconnecting'
                ? 'Pareando Aparelho...'
                : mode === 'baileys_live'
                ? 'WhatsApp Web Oficial'
                : 'QR Câmera Mobile'}
            </span>
            <span className="text-slate-400 tabular-nums">
              {status === 'reconnecting' ? 'Quase pronto' : `Renova em ${remainingSec}s`}
            </span>
          </div>
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{
                width:
                  status === 'reconnecting'
                    ? '92%'
                    : `${Math.min(100, Math.max(8, (remainingSec / 60) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
