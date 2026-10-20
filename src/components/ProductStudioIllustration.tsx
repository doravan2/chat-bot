import React from 'react';
import { ProductVisualPreset } from '../types';

interface ProductStudioIllustrationProps {
  preset: ProductVisualPreset;
  mode: 'competitor_watermarked' | 'clean_og_image';
  sku?: string;
}

export const ProductStudioIllustration: React.FC<ProductStudioIllustrationProps> = ({
  preset,
  mode,
  sku = 'MLB29481029',
}) => {
  const isWatermarked = mode === 'competitor_watermarked';

  return (
    <div
      className={`relative w-full aspect-square overflow-hidden rounded-lg flex items-center justify-center select-none ${
        isWatermarked
          ? 'bg-slate-900 border-4 border-amber-500/80'
          : 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 border border-slate-700'
      }`}
    >
      {/* Studio Backdrop */}
      <div
        className={`absolute inset-0 ${
          isWatermarked ? 'bg-slate-100 opacity-90' : 'bg-gradient-to-b from-white via-slate-50 to-slate-200/90'
        }`}
      />

      {/* Soft Studio Floor Shadow */}
      <div className="absolute bottom-6 w-3/5 h-5 rounded-full bg-slate-900/15 blur-md" />

      {/* Product Vector Artwork */}
      <div className="relative z-10 w-3/4 h-3/4 flex items-center justify-center">
        {preset === 'headphones' && (
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md" aria-label="Headphones Studio Photo">
            <defs>
              <linearGradient id="hpBody" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#334155" />
                <stop offset="50%" stopColor="#1E293B" />
                <stop offset="100%" stopColor="#0F172A" />
              </linearGradient>
              <linearGradient id="hpAccent" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
            {/* Headband arch */}
            <path
              d="M 45 105 A 55 55 0 0 1 155 105"
              fill="none"
              stroke="url(#hpBody)"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M 52 100 A 48 48 0 0 1 148 100"
              fill="none"
              stroke="#475569"
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Sliders & Copper hinges */}
            <rect x="39" y="100" width="10" height="22" rx="4" fill="#1E293B" />
            <rect x="151" y="100" width="10" height="22" rx="4" fill="#1E293B" />
            <circle cx="44" cy="112" r="3.5" fill="url(#hpAccent)" />
            <circle cx="156" cy="112" r="3.5" fill="url(#hpAccent)" />
            {/* Ear cups */}
            <ellipse cx="48" cy="138" rx="22" ry="30" transform="rotate(-12 48 138)" fill="url(#hpBody)" />
            <ellipse cx="55" cy="138" rx="12" ry="24" transform="rotate(-12 55 138)" fill="#0F172A" />
            <ellipse cx="152" cy="138" rx="22" ry="30" transform="rotate(12 152 138)" fill="url(#hpBody)" />
            <ellipse cx="145" cy="138" rx="12" ry="24" transform="rotate(12 145 138)" fill="#0F172A" />
          </svg>
        )}

        {preset === 'airfryer' && (
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md" aria-label="Air Fryer Studio Photo">
            <defs>
              <linearGradient id="afBody" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1E293B" />
                <stop offset="60%" stopColor="#0F172A" />
                <stop offset="100%" stopColor="#020617" />
              </linearGradient>
              <linearGradient id="afSteel" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#94A3B8" />
                <stop offset="50%" stopColor="#E2E8F0" />
                <stop offset="100%" stopColor="#64748B" />
              </linearGradient>
            </defs>
            {/* Main body */}
            <path d="M 52 38 Q 100 30 148 38 L 156 162 Q 100 172 44 162 Z" fill="url(#afBody)" />
            {/* Brushed steel middle band */}
            <rect x="48" y="96" width="104" height="10" fill="url(#afSteel)" />
            {/* Digital touch panel */}
            <rect x="74" y="50" width="52" height="34" rx="6" fill="#020617" stroke="#334155" strokeWidth="1.5" />
            <text x="100" y="71" textAnchor="middle" fill="#38BDF8" fontSize="14" fontFamily="monospace" fontWeight="bold">
              200°C
            </text>
            {/* Basket handle */}
            <rect x="88" y="106" width="24" height="44" rx="6" fill="url(#afSteel)" />
            <rect x="93" y="112" width="14" height="32" rx="3" fill="#0F172A" />
          </svg>
        )}

        {preset === 'smartwatch' && (
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md" aria-label="Smartwatch Studio Photo">
            {/* Top & Bottom straps */}
            <path d="M 76 22 L 124 22 L 130 62 L 70 62 Z" fill="#334155" />
            <path d="M 70 138 L 130 138 L 124 178 L 76 178 Z" fill="#334155" />
            {/* Titanium case */}
            <rect x="54" y="54" width="92" height="92" rx="22" fill="#94A3B8" stroke="#64748B" strokeWidth="3" />
            {/* Action orange button */}
            <rect x="49" y="88" width="5" height="22" rx="2" fill="#F97316" />
            {/* Crown */}
            <rect x="146" y="74" width="6" height="20" rx="3" fill="#64748B" />
            {/* AMOLED Screen */}
            <rect x="61" y="61" width="78" height="78" rx="16" fill="#090D16" />
            <text x="100" y="95" textAnchor="middle" fill="#10B981" fontSize="18" fontFamily="monospace" fontWeight="bold">
              09:42
            </text>
            <text x="100" y="114" textAnchor="middle" fill="#94A3B8" fontSize="9" fontFamily="sans-serif">
              GPS · 98 BPM
            </text>
          </svg>
        )}

        {preset === 'espresso' && (
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md" aria-label="Espresso Machine Studio Photo">
            {/* Espresso body */}
            <rect x="52" y="34" width="96" height="132" rx="10" fill="#1E293B" />
            <rect x="58" y="42" width="84" height="32" rx="4" fill="#CBD5E1" />
            {/* Group head & portafilter */}
            <rect x="84" y="78" width="32" height="16" rx="3" fill="#64748B" />
            <line x1="100" y1="86" x2="148" y2="94" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
            {/* White espresso cup */}
            <path d="M 84 126 L 116 126 L 112 150 L 88 150 Z" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1.5" />
            {/* Drip tray */}
            <rect x="56" y="152" width="88" height="10" rx="2" fill="#94A3B8" />
          </svg>
        )}
      </div>

      {/* Competitor Watermark Noise Overlay vs Clean OG:Image Tag */}
      {isWatermarked ? (
        <>
          {/* Top Garish Competitor Ribbon */}
          <div className="absolute top-0 inset-x-0 bg-amber-500 text-slate-950 font-extrabold text-[10px] py-1 px-2 text-center tracking-wider">
            🚨 OFERTAS DO JOÃO VIP · NÃO COPIE 🚨
          </div>
          {/* Diagonal Watermark Stamp */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="rotate-[-24deg] bg-red-600/85 text-white font-mono text-[10px] font-bold px-3 py-1 rounded shadow-lg border border-white/40">
              @ACHADINHOS_CONCORRENTE
            </div>
          </div>
          {/* Bottom Competitor Phone Banner */}
          <div className="absolute bottom-0 inset-x-0 bg-slate-950/95 text-amber-300 font-mono text-[9px] py-1 px-2 text-center z-20">
            GRUPO VIP: (11) 99123-4567 · ENTRE JÁ
          </div>
        </>
      ) : (
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between bg-slate-900/85 backdrop-blur-xs text-slate-100 px-2.5 py-1 rounded text-[10px] font-mono z-20">
          <span className="text-emerald-400 font-medium">OG:IMAGE OFICIAL</span>
          <span className="text-slate-300 tabular-nums">{sku} · 1200px</span>
        </div>
      )}
    </div>
  );
};
