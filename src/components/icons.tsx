import type { ReactElement, SVGProps } from 'react';
import type { DateEventType } from '../datepack/types';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  const provided = Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  );
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...provided,
  };
}

export const HeartIcon = (p: IconProps) => (
  <svg {...base(p)} fill={p.fill ?? 'currentColor'} stroke={p.stroke ?? 'none'}>
    <path d="M12 20.5C7 16.6 3.5 13.4 3.5 9.7 3.5 7 5.6 5 8.2 5c1.5 0 3 .7 3.8 2 .8-1.3 2.3-2 3.8-2 2.6 0 4.7 2 4.7 4.7 0 3.7-3.5 6.9-8.5 10.8Z" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth={2.6} />
  </svg>
);

export const DotsIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

export const PinIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.8" />
  </svg>
);

export const MealIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 13v8" />
    <path d="M17 3c-1.5 1.5-2 3.5-2 6 0 2 .8 3 2 3v9M17 3v9" />
  </svg>
);

export const CoffeeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 8h1.5a3.5 3.5 0 0 1 0 7H17" />
    <path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Z" />
    <path d="M7 2.5v2M11 2.5v2" />
  </svg>
);

export const TrainIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 10h14M9.5 20l-1.5 2M14.5 20l1.5 2M8 19h8" />
    <circle cx="9" cy="13.2" r=".9" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13.2" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

export const TicketIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z" />
    <path d="M14 5v2.5M14 11v2M14 16.5V19" strokeDasharray="0.1 3.4" />
  </svg>
);

export const CameraIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.6" />
  </svg>
);

export const NoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="4" width="14" height="16" rx="2.5" />
    <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
  </svg>
);

export const SparkleIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5 13.8 8.2 19.5 10 13.8 11.8 12 17.5 10.2 11.8 4.5 10 10.2 8.2 12 2.5Z" />
    <path d="M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M4.5 12.5 10 18 19.5 6.5" />
  </svg>
);

export const SkipIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M6 5.8v12.4L15 12 6 5.8Z" />
    <rect x="16.5" y="5.5" width="2.2" height="13" rx="1.1" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 5 4 9l4 4" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10.5 12 15.5l5-5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7 7.5 12 2.5l5 5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
  </svg>
);

export const EditIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z" />
    <path d="M13.5 7l3 3" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const UmbrellaIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z" />
    <path d="M12 12v6.5a2 2 0 0 0 4 0" />
  </svg>
);

export const CalendarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="3" />
    <path d="M3.5 10h17M8 2.5V6M16 2.5V6" />
  </svg>
);

export const EVENT_TYPE_ICONS: Record<DateEventType, (p: IconProps) => ReactElement> = {
  place: PinIcon,
  meal: MealIcon,
  cafe: CoffeeIcon,
  transport: TrainIcon,
  reservation: TicketIcon,
  activity: CameraIcon,
  note: NoteIcon,
};

export function eventTypeLabel(type: DateEventType): string {
  const labels: Record<DateEventType, string> = {
    place: '장소',
    meal: '식사',
    cafe: '카페',
    transport: '이동',
    reservation: '예약',
    activity: '활동',
    note: '메모',
  };
  return labels[type];
}
