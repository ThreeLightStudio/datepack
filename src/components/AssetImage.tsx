import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getCachedBlob, resolveBlob } from '../store/datepackStore';
import { EVENT_TYPE_ICONS } from './icons';
import { t } from '../i18n/core';
import type { DateEventType } from '../datepack/types';

const urlCache = new Map<string, string>();

function urlFor(packId: string, assetId: string, blob: Blob): string {
  const key = `${packId}:${assetId}`;
  const existing = urlCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

/** Drop cached object URLs for a pack (call when a pack is deleted). */
export function revokeAssetUrls(packId: string): void {
  for (const [key, url] of [...urlCache.entries()]) {
    if (key.startsWith(`${packId}:`)) {
      URL.revokeObjectURL(url);
      urlCache.delete(key);
    }
  }
}

type Props = {
  packId: string;
  assetId?: string | null;
  /** Icon + gradient fallback used when there is no image (image policy). */
  fallbackIcon?: DateEventType | 'image';
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

/**
 * Renders a DatePack asset via an object URL, or a neutral placeholder when
 * the asset is missing. Images are enhancement, never a layout dependency.
 */
export function AssetImage({
  packId,
  assetId,
  fallbackIcon = 'image',
  className,
  style,
  alt,
}: Props) {
  const [src, setSrc] = useState<string | null>(() =>
    assetId && getCachedBlob(packId, assetId)
      ? urlFor(packId, assetId, getCachedBlob(packId, assetId)!)
      : null,
  );

  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setSrc(null);
      return;
    }
    const cached = getCachedBlob(packId, assetId);
    if (cached) {
      setSrc(urlFor(packId, assetId, cached));
      return;
    }
    void resolveBlob(packId, assetId).then((blob) => {
      if (alive && blob) setSrc(urlFor(packId, assetId, blob));
    });
    return () => {
      alive = false;
    };
  }, [packId, assetId]);

  if (src) {
    return <img className={className} style={style} src={src} alt={alt ?? ''} />;
  }
  const Icon = fallbackIcon === 'image' ? EVENT_TYPE_ICONS.place : EVENT_TYPE_ICONS[fallbackIcon];
  return (
    <div
      className={`asset-placeholder ${className ?? ''}`}
      style={style}
      role="img"
      aria-label={alt ?? t('asset.missing')}
    >
      <Icon width={26} height={26} />
    </div>
  );
}
