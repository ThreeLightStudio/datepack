import { conditionsText } from '../outing/conditions';
import { useRef, useState } from 'react';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { addEventAssets, useStore } from '../../store/datepackStore';
import { version as APP_VERSION } from '../../../package.json';
import { REPO_URL } from '../../app/meta';
import { AssetImage } from '../../components/AssetImage';
import { EditIcon, PlusIcon } from '../../components/icons';

import { PlanMetaSheet } from '../editor/PlanMetaSheet';
import { useLocale } from '../../i18n';

type Props = {
  plan: DatePlan;
  runtime: DatePackRuntimeState | null;
  onOpenCreate: () => void;
  onOpenAi: () => void;
};

export function DetailsView({ plan, runtime, onOpenAi }: Props) {
  const locale = useLocale();
  const { pack: selectedPack } = useStore();
  const [metaOpen, setMetaOpen] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);

  const ko = locale === 'ko';

  const galleryItems: Array<{ id: string; label: string }> = [];
  if (plan.coverAssetId) galleryItems.push({ id: plan.coverAssetId, label: ko ? '커버' : 'Cover' });
  plan.galleryAssetIds?.forEach((id) => galleryItems.push({ id, label: ko ? '사진' : 'Photo' }));
  plan.events.forEach((event) =>
    event.assetIds?.forEach((id) => galleryItems.push({ id, label: event.title })),
  );

  return (
    <div className="view details-view">
      <header className="view-head">
        <div className="title-row">
          <h1 className="plan-title">{plan.title}</h1>
          <button
            type="button"
            className="icon-btn framed"
            onClick={() => setMetaOpen(true)}
            aria-label={ko ? '외출 정보 편집' : 'Edit outing details'}
          >
            <EditIcon width={17} height={17} />
          </button>
        </div>
      </header>

      <section className="details-section">
        <div className="section-head">
          <h2>{ko ? '사진 & 티켓' : 'Photos & tickets'}</h2>
        </div>
        <div className="gallery">
          {galleryItems.map((item) => (
            <figure key={item.id} className="gallery-item">
              <AssetImage
                packId={selectedPack?.id ?? plan.id}
                assetId={item.id}
                className="gallery-img"
                alt={item.label}
              />
              <figcaption>{item.label}</figcaption>
            </figure>
          ))}
          <button type="button" className="gallery-add" onClick={() => galleryRef.current?.click()}>
            <PlusIcon width={22} height={22} />
            <span>{ko ? '사진 추가' : 'Add photos'}</span>
          </button>
        </div>
        <input
          ref={galleryRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addEventAssets(null, e.target.files);
            e.target.value = '';
          }}
        />
        {plan.memo && <p className="sub-line">{plan.memo}</p>}
      </section>

      <section className="details-section">
        <p className="meta-line">{conditionsText(plan, ko)}</p>
        <button type="button" className="btn btn-soft" onClick={onOpenAi}>
          {ko ? 'AI로 다시 계획하기' : 'Replan with AI'}
        </button>
      </section>

      {import.meta.env.DEV && (
        <section className="details-section debug-section">
          <div className="section-head">
            <h2>Debug (dev only)</h2>
          </div>
          <details>
            <summary>plan.json</summary>
            <pre className="debug-json">{JSON.stringify(plan, null, 2)}</pre>
          </details>
          <details>
            <summary>runtime state</summary>
            <pre className="debug-json">{JSON.stringify(runtime, null, 2)}</pre>
          </details>
        </section>
      )}

      <footer className="app-footnote">
        <p>
          {ko
            ? 'DatePack — 모든 데이터는 이 기기에만 저장돼요'
            : 'DatePack — everything stays on this device'}
        </p>
        <p>
          v{APP_VERSION} · Public Beta ·{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </p>
      </footer>

      {metaOpen && <PlanMetaSheet plan={plan} onClose={() => setMetaOpen(false)} />}
    </div>
  );
}
