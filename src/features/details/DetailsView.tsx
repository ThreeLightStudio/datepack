import { useRef, useState } from 'react';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import {
  addEventAssets,
  createNewPack,
  deletePackById,
  exportCurrentPack,
  importPackFile,
  switchPack,
  useStore,
} from '../../store/datepackStore';
import { exportFilename, todayISO } from '@datepack/core';
import { version as APP_VERSION } from '../../../package.json';
import { REPO_URL } from '../../app/meta';
import { AssetImage } from '../../components/AssetImage';
import { DownloadIcon, EditIcon, PlusIcon, TrashIcon, UploadIcon } from '../../components/icons';
import { AiSection } from '../ai/AiSection';
import { CreateWithAiSheet } from '../ai/CreateWithAiSheet';
import { PlanMetaSheet } from '../editor/PlanMetaSheet';
import { formatDate, format, setLocale, useLocale, LOCALES } from '../../i18n';
import { showImportError } from '../../app/App';

type Props = { plan: DatePlan; runtime: DatePackRuntimeState | null };

export function DetailsView({ plan, runtime }: Props) {
  const locale = useLocale();
  const { savedPacks } = useStore();
  const [metaOpen, setMetaOpen] = useState(false);
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(todayISO());
  const galleryRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

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
        <p className="eyebrow">DatePack</p>
        <div className="title-row">
          <h1 className="plan-title">{plan.title}</h1>
          <button
            type="button"
            className="icon-btn framed"
            onClick={() => setMetaOpen(true)}
            aria-label={ko ? '데이트 정보 편집' : 'Edit date details'}
          >
            <EditIcon width={17} height={17} />
          </button>
        </div>
      </header>

      <section className="details-section lang-section">
        <p className="eyebrow">{ko ? '언어' : 'Language'}</p>
        <div className="lang-switch" role="group" aria-label={ko ? '언어' : 'Language'}>
          {LOCALES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`lang-btn ${locale === id ? 'active' : ''}`}
              aria-pressed={locale === id}
              onClick={() => setLocale(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="details-section">
        <div className="section-head">
          <h2>{ko ? '사진 & 티켓' : 'Photos & tickets'}</h2>
        </div>
        <div className="gallery">
          {galleryItems.map((item) => (
            <figure key={item.id} className="gallery-item">
              <AssetImage
                packId={plan.id}
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

      <AiSection plan={plan} runtime={runtime} />

      <section className="details-section">
        <div className="section-head">
          <h2>{ko ? '내 데이트 파일들' : 'Your DatePack files'}</h2>
        </div>

        <div className="sub-block">
          <p className="eyebrow">{ko ? '파일 하나로 내보내기' : 'Everything in one file'}</p>
          <p className="hint-text">
            {ko
              ? '이 데이트 전체(일정 + 사진)가 .datepack.json 파일 하나로 저장돼요.'
              : 'The whole date — itinerary and photos — packs into one .datepack.json file.'}
          </p>
          <div className="action-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void exportCurrentPack()}
            >
              <DownloadIcon width={16} height={16} /> {ko ? '내려받기' : 'Download'}
            </button>
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => importRef.current?.click()}
            >
              <UploadIcon width={16} height={16} />{' '}
              {ko ? '.datepack.json 열기' : 'Open .datepack.json'}
            </button>
          </div>
          <p className="hint-text mono">
            {format(locale, 'details.export.filename', { filename: exportFilename({ plan }) })}
          </p>
          <input
            ref={importRef}
            type="file"
            accept=".json,.datepack.json,.datepack,.zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const onDate = plan.date === todayISO();
                const confirmed =
                  !onDate ||
                  window.confirm(
                    ko
                      ? '지금 데이트 중이에요. 다른 DatePack을 열면 이 화면에서 벗어나요. 계속할까요?'
                      : "You're mid-date. Opening another DatePack takes you off this screen — continue?",
                  );
                if (confirmed)
                  void importPackFile(file).catch((error) => showImportError(error, locale));
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="divider" />

        <div className="sub-block">
          <p className="eyebrow">{ko ? '새 데이트 만들기' : 'Start a new date'}</p>
          <div className="action-row">
            <button type="button" className="btn btn-primary" onClick={() => setAiCreateOpen(true)}>
              {format(locale, 'create.btn')}
            </button>
          </div>
          <div className="new-pack-row">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={ko ? '데이트 이름' : 'Date name'}
            />
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => void createNewPack(newTitle, newDate)}
            >
              {ko ? '만들기' : 'Create'}
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="sub-block">
          <p className="eyebrow">{ko ? '이 기기에 저장된 데이트' : 'Saved on this device'}</p>
          <ul className="pack-list">
            {savedPacks.map(({ pack, savedAt }) => {
              const current = pack.plan.id === plan.id;
              return (
                <li key={pack.plan.id} className={`pack-item ${current ? 'current' : ''}`}>
                  <button
                    type="button"
                    className="pack-open"
                    onClick={() => void switchPack(pack.plan.id)}
                  >
                    <span className="pack-title">{pack.plan.title}</span>
                    <span className="pack-meta">
                      {formatDate(locale, pack.plan.date)} ·{' '}
                      {ko
                        ? `일정 ${pack.plan.events.length}개`
                        : `${pack.plan.events.length} stops`}{' '}
                      · {new Date(savedAt).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US')}{' '}
                      {ko ? '저장' : 'saved'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn framed danger"
                    onClick={() => {
                      const message = ko
                        ? `"${pack.plan.title}"을 삭제할까요? 되돌릴 수 없어요.`
                        : `Delete "${pack.plan.title}"? This can't be undone.`;
                      if (confirm(message)) void deletePackById(pack.plan.id);
                    }}
                    aria-label={ko ? '삭제' : 'Delete'}
                  >
                    <TrashIcon width={16} height={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
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
      {aiCreateOpen && <CreateWithAiSheet open onClose={() => setAiCreateOpen(false)} />}
    </div>
  );
}
