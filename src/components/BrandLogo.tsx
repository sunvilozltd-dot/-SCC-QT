import React from 'react';
import { resolveBrandAsset } from '../utils/brandAssets';

interface BrandLogoProps {
  logoDataUrl?: string;
  subtitle?: string;
  variant?: 'dark' | 'light' | 'auth';
  compact?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  logoDataUrl,
  subtitle = 'Order Management',
  variant = 'dark',
  compact = false,
}) => {
  const logoSrc =
    logoDataUrl && logoDataUrl.startsWith('data:image/')
      ? logoDataUrl
      : resolveBrandAsset('/assets/sunviloz/logo.png');

  if (variant === 'auth') {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-16 max-w-[220px] items-center justify-center rounded-2xl bg-white/95 px-4 py-2 shadow-sm">
          <img
            src={logoSrc}
            alt="SUNVILOZ Clean Care"
            className="max-h-12 max-w-[190px] w-auto h-auto object-contain"
          />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white">SUNVILOZ Clean Care</h1>
        {subtitle && <p className="text-xs text-teal-200 mt-1">{subtitle}</p>}
      </div>
    );
  }

  const titleClass = variant === 'dark' ? 'text-white' : 'text-[#0c2340]';
  const subClass = variant === 'dark' ? 'text-teal-300' : 'text-teal-700';

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div
        className={`shrink-0 flex items-center justify-center rounded-xl overflow-hidden ${
          variant === 'dark'
            ? 'bg-white/95 px-2 py-1 border border-white/20'
            : 'bg-white px-1.5 py-1 border border-slate-200'
        } ${compact ? 'h-9 max-w-[120px]' : 'h-11 max-w-[140px]'}`}
      >
        <img
          src={logoSrc}
          alt="SUNVILOZ Clean Care"
          className={`${compact ? 'max-h-7 max-w-[108px]' : 'max-h-9 max-w-[126px]'} w-auto h-auto object-contain`}
        />
      </div>
      <div className="min-w-0 leading-tight">
        <div
          className={`font-bold tracking-tight truncate ${compact ? 'text-sm' : 'text-base'} ${titleClass}`}
        >
          SUNVILOZ Clean Care
        </div>
        {subtitle && <div className={`text-[11px] truncate ${subClass}`}>{subtitle}</div>}
      </div>
    </div>
  );
};
