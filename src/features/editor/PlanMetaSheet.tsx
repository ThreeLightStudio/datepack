import { useState } from 'react';
import type { DatePlan, PlanConstraints } from '@datepack/core';
import { isValidDateISO } from '@datepack/core';
import { updatePlan } from '../../store/datepackStore';
import { Sheet } from '../../components/Sheet';
import { CheckIcon } from '../../components/icons';
import { useLocale } from '../../i18n';

type Props = { plan: DatePlan; onClose: () => void };

function linesToText(lines: string[] | undefined): string {
  return (lines ?? []).join('\n');
}

function textToLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function PlanMetaSheet({ plan, onClose }: Props) {
  const locale = useLocale();
  const [title, setTitle] = useState(plan.title);
  const [date, setDate] = useState(plan.date);
  const [memo, setMemo] = useState(plan.memo ?? '');
  const [must, setMust] = useState(linesToText(plan.constraints?.must));
  const [prefer, setPrefer] = useState(linesToText(plan.constraints?.prefer));
  const [avoid, setAvoid] = useState(linesToText(plan.constraints?.avoid));
  const [error, setError] = useState<string | null>(null);

  const L =
    locale === 'ko'
      ? {
          title: '데이트 정보',
          name: '데이트 이름',
          date: '날짜',
          memo: '한 줄 메모',
          memoPh: '예: 기차 시간만 지키면 돼요',
          promise: '이 데이트의 약속 (AI 재계획 때 함께 보내요)',
          must: '반드시 지키기 · 줄마다 한 항목',
          mustPh: '예: 22:42 KTX 타기',
          prefer: '가능하면 하기',
          preferPh: '예: 감성 카페',
          avoid: '피하기',
          avoidPh: '예: 매운 음식',
          errName: '데이트 이름을 입력해주세요.',
          errDate: '날짜는 YYYY-MM-DD 형식이어야 해요.',
          save: '저장',
        }
      : {
          title: 'Date details',
          name: 'Date name',
          date: 'Date',
          memo: 'One-line note',
          memoPh: 'e.g. just make the train times',
          promise: 'Ground rules (sent along when replanning)',
          must: 'Must · one per line',
          mustPh: 'e.g. catch the last train home',
          prefer: 'Nice to have',
          preferPh: 'e.g. cozy cafés',
          avoid: 'Avoid',
          avoidPh: 'e.g. spicy food',
          errName: 'Give the date a name.',
          errDate: 'The date must be in YYYY-MM-DD format.',
          save: 'Save',
        };

  function save(): void {
    if (!title.trim()) {
      setError(L.errName);
      return;
    }
    if (!isValidDateISO(date)) {
      setError(L.errDate);
      return;
    }
    const constraints: PlanConstraints = {
      must: textToLines(must).length > 0 ? textToLines(must) : undefined,
      prefer: textToLines(prefer).length > 0 ? textToLines(prefer) : undefined,
      avoid: textToLines(avoid).length > 0 ? textToLines(avoid) : undefined,
    };
    updatePlan(locale === 'ko' ? '데이트 정보 수정' : 'Date details', (draft) => {
      draft.title = title.trim();
      draft.date = date;
      draft.memo = memo.trim() || undefined;
      draft.constraints = constraints;
      return draft;
    });
    onClose();
  }

  return (
    <Sheet open title={L.title} onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>{L.name}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.date}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.memo}</span>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder={L.memoPh}
          />
        </label>

        <div className="divider" />
        <p className="eyebrow">{L.promise}</p>
        <label className="field">
          <span>{L.must}</span>
          <textarea
            value={must}
            onChange={(e) => setMust(e.target.value)}
            rows={2}
            placeholder={L.mustPh}
          />
        </label>
        <label className="field">
          <span>{L.prefer}</span>
          <textarea
            value={prefer}
            onChange={(e) => setPrefer(e.target.value)}
            rows={2}
            placeholder={L.preferPh}
          />
        </label>
        <label className="field">
          <span>{L.avoid}</span>
          <textarea
            value={avoid}
            onChange={(e) => setAvoid(e.target.value)}
            rows={2}
            placeholder={L.avoidPh}
          />
        </label>

        {error && <p className="form-error">{error}</p>}
        <div className="sheet-footer">
          <button type="button" className="btn btn-primary grow" onClick={save}>
            <CheckIcon width={16} height={16} /> {L.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
