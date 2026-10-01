import { useLocale } from '../../i18n';
import type { OutingForm } from './conditions';

export function OutingFields({
  value,
  change,
  disabled = false,
  includeDate = true,
  includeTimes = true,
  compact = true,
}: {
  value: OutingForm;
  change: (field: keyof OutingForm, text: string) => void;
  disabled?: boolean;
  includeDate?: boolean;
  includeTimes?: boolean;
  compact?: boolean;
}) {
  const ko = useLocale() === 'ko';
  return (
    <fieldset className="outing-fields" disabled={disabled}>
      <legend>{ko ? '외출 조건' : 'Outing brief'}</legend>
      <div
        className="chip-row wrap"
        role="group"
        aria-label={ko ? '빠른 조건' : 'Quick preferences'}
      >
        {(
          [
            ['nearby', 'yes', ko ? '가까운 곳' : 'Nearby'],
            ['durationMinutes', '120', ko ? '한두 시간' : 'An hour or two'],
            ['budget', '10000', ko ? '적게 쓰기' : 'Spend less'],
            ['singleStop', 'yes', ko ? '한 곳만' : 'One stop'],
          ] as const
        ).map(([field, chosen, label]) => (
          <button
            key={field}
            type="button"
            className={`chip chip-btn ${value[field] === chosen ? 'chip-selected' : ''}`}
            aria-pressed={value[field] === chosen}
            onClick={() => change(field, value[field] === chosen ? '' : chosen)}
          >
            {label}
          </button>
        ))}
      </div>
      {value.budget && (
        <p className="hint-text">
          {ko ? '예산' : 'Budget'}: {value.budget} {ko ? '원 이내' : 'KRW ceiling'} ·{' '}
          {value.budgetBasis === 'per-person'
            ? ko
              ? '한 사람당'
              : 'per person'
            : ko
              ? '전체'
              : 'total'}
        </p>
      )}
      <label className="field">
        <span>{ko ? '누구와 가나요? (선택)' : 'Who is going? (optional)'}</span>
        <select value={value.party} onChange={(e) => change('party', e.target.value)}>
          <option value="">{ko ? '아직 미정' : 'Undecided'}</option>
          <option value="solo">{ko ? '혼자' : 'Solo'}</option>
          <option value="together">{ko ? '함께' : 'Together'}</option>
        </select>
      </label>
      <details open={compact ? undefined : true} className="outing-details">
        <summary>{ko ? '세부 조건 편집' : 'Edit detailed conditions'}</summary>
        <label className="field">
          <span>{ko ? '지역 (선택)' : 'Area (optional)'}</span>
          <input
            value={value.region}
            onChange={(e) => change('region', e.target.value)}
            placeholder={ko ? '예: 성수동' : 'e.g. Seongsu'}
            maxLength={200}
          />
        </label>
        {includeDate && (
          <label className="field">
            <span>{ko ? '날짜 (선택)' : 'Date (optional)'}</span>
            <input
              type="date"
              value={value.date}
              onChange={(e) => change('date', e.target.value)}
            />
          </label>
        )}
        <div className="field-row">
          <label className="field">
            <span>{ko ? '예산 (원, 선택)' : 'Budget (KRW, optional)'}</span>
            <input
              inputMode="numeric"
              value={value.budget}
              onChange={(e) => change('budget', e.target.value)}
              placeholder="10000"
            />
          </label>
          <label className="field">
            <span>{ko ? '소요 시간 (분, 선택)' : 'Duration (min, optional)'}</span>
            <input
              inputMode="numeric"
              value={value.durationMinutes}
              onChange={(e) => change('durationMinutes', e.target.value)}
              placeholder="120"
            />
          </label>
        </div>
        <label className="field">
          <span>{ko ? '예산 기준' : 'Budget basis'}</span>
          <select value={value.budgetBasis} onChange={(e) => change('budgetBasis', e.target.value)}>
            <option value="total">{ko ? '전체' : 'Total'}</option>
            <option value="per-person">{ko ? '한 사람당' : 'Per person'}</option>
          </select>
        </label>
      </details>
      <p className="hint-text">
        {ko
          ? '활동 하나만 넣어도 괜찮아요. 정확한 시각은 나중에 정할 수 있어요.'
          : 'One stop is enough. Quick picks start at 120 min and 10,000 KRW; change them in detailed conditions.'}
      </p>
      {includeTimes && (
        <details className="outing-times">
          <summary>
            {ko ? '시작·마감 시각 정하기 (선택)' : 'Set start and wrap-up times (optional)'}
          </summary>
          <div className="field-row">
            <label className="field">
              <span>{ko ? '시작 시각' : 'Start time'}</span>
              <input
                type="time"
                value={value.startTime}
                onChange={(e) => change('startTime', e.target.value)}
              />
            </label>
            <label className="field">
              <span>{ko ? '마감 시각' : 'Wrap-up time'}</span>
              <input
                type="time"
                value={value.endTime}
                onChange={(e) => change('endTime', e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>{ko ? '마감 날짜' : 'Wrap-up day'}</span>
            <select value={value.endDay} onChange={(e) => change('endDay', e.target.value)}>
              <option value="0">{ko ? '같은 날' : 'Same day'}</option>
              <option value="1">{ko ? '다음 날' : 'Next day'}</option>
            </select>
          </label>
        </details>
      )}
    </fieldset>
  );
}
