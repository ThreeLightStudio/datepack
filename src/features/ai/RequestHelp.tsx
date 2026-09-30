import { useLocale } from '../../i18n';

export function DraftSaveError({ retry }: { retry: () => void }) {
  const ko = useLocale() === 'ko';
  return (
    <div className="form-warning" role="alert">
      <p>
        {ko
          ? '입력을 저장하지 못했어요. 이 화면에는 남아 있어요. 앱을 종료하기 전에 다시 저장해주세요.'
          : 'Your input is still here, but could not be saved. Retry before closing the app.'}
      </p>
      <button type="button" className="btn btn-soft" onClick={retry}>
        {ko ? '다시 저장' : 'Retry saving'}
      </button>
    </div>
  );
}

export function RequestHelp({ correction = false }: { correction?: boolean }) {
  const ko = useLocale() === 'ko';
  return (
    <p className="hint-text">
      {correction
        ? ko
          ? '형식 오류라면 AI에게 “같은 요청의 식별값을 유지하고, 승인한 결과를 요청문의 JSON 형식 하나로만 다시 주세요”라고 알려주세요. 다른 요청의 답이면 새 요청을 사용하세요.'
          : 'For a format error, ask your AI: “Keep this request’s identity and return the approved result as one JSON object in the requested format.” Use a new request for a different reply.'
        : ko
          ? '요청을 복사하거나 공유 → 쓰는 AI에서 대화하고 승인 → 답안을 이곳에 붙여넣기. 입력은 기기에 저장되고, 확인 적용 전에는 계획이 바뀌지 않아요.'
          : 'Copy or share → discuss and approve in your AI → paste the reply here. Entries stay on this device. Review and apply to change the plan.'}
    </p>
  );
}
