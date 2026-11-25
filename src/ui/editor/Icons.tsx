import type { CSSProperties } from 'react';

const paths = {
  workflow: 'M3 3h7v7H3z M14 14h7v7h-7z M6.5 10v4a3 3 0 0 0 3 3H14',
  home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3z',
  folder: 'M3 7V5h7l2 2h9v13H3z',
  layers: 'm12 3 9 5-9 5-9-5z m-9 9 9 5 9-5 m-18 4 9 5 9-5',
  book: 'M12 5C8 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1z M12 5v15',
  users:
    'M14 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2 M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M16 4c5 1 5 6 0 7 M17 15c3 0 5 2 5 6',
  undo: 'm8 5-5 5 5 5 M3 10h12a5 5 0 0 1 0 10',
  redo: 'm16 5 5 5-5 5 M21 10H9a5 5 0 0 0 0 10',
  save: 'M3 3h14l4 4v14H3z M7 3v6h9V3 M7 21v-8h10v8',
  versions: 'M8 6h12v15H8z M16 6V3H4v15h4',
  share:
    'M8 11l8-5 M8 13l8 5 M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  play: 'm6 3 15 9-15 9z',
  stop: 'M5 5h14v14H5z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 m-1 5 6 6',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  bot: 'M4 8h16v12H4z M12 3v5 M8 12v3 m8-3v3 M2 12v4 m20-4v4',
  input: 'M11 3h5l5 5v13H8v-4 M11 3H8v5 m7-5v6h6 M2 12h12 m-4-4 4 4-4 4',
  question: 'M4 4h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 4v-4H3V5a1 1 0 0 1 1-1z',
  send: 'm2 11 20-8-7 19-4-8-9-3z m9 3 11-11',
  filePlus: 'M4 2h10l5 5v6 M14 2v6h5 M4 2v20h9 M18 14v7 m-3.5-3.5h7',
  skill: 'M3 4h18v16H3z m4 5 3 3-3 3 m6 0h4',
  output: 'M9 3h7l5 5v13H8v-4 M15 3v6h6 M2 12h12 m-7-4-5 4 5 4',
  data: 'M4 5c0-4 16-4 16 0s-16 4-16 0z M4 5v14c0 4 16 4 16 0V5 M4 12c0 4 16 4 16 0',
  branch: 'M3 3h6v6H3z M3 15h6v6H3z M6 9v6 M9 6h3q3 0 4 4 M20 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  shield: 'm12 2 8 3v6c0 6-5 9-8 11-4-2-8-5-8-11V5z m-4 10 3 3 5-6',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.1 M3 12h.1 M3 18h.1',
  keyboard: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M6 9h1m3 0h1m3 0h1m3 0h.1M6 12h1m3 0h1m3 0h1m3 0h.1M8 15h8',
  link: 'm9 14 6-6 m-6 2-4 4a4 4 0 0 0 6 6l3-3 m-1-3 5-5a4 4 0 0 0-6-6l-3 3',
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 m4-7v7',
  spark: 'm10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5z M19 2v6 M16 5h6',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  more: 'M4 12h1 M11.5 12h1 M19 12h1',
  close: 'm5 5 14 14 M19 5 5 19',
  plus: 'M12 4v16 M4 12h16',
  minus: 'M4 12h16',
  fit: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  export: 'M12 16V3 m-5 5 5-5 5 5 M3 14v6h18v-6',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0 M12 11v6 M12 7v.1',
  file: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h6',
  settings:
    'M3 6h8 m4 0h6 M3 16h3 m4 0h11 M15 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  back: 'm14 5-7 7 7 7',
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 17,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function blockIcon(type: string): { icon: IconName; color: string } {
  if (type === 'control.trigger') return { icon: 'play', color: 'green' };
  if (type === 'control.terminate') return { icon: 'stop', color: 'red' };
  if (type.startsWith('input.')) return { icon: type === 'input.user_request' ? 'question' : 'input', color: 'teal' };
  if (type === 'file.create') return { icon: 'filePlus', color: 'amber' };
  if (type.startsWith('output.')) return { icon: 'send', color: 'green' };
  if (type === 'resource.context') return { icon: 'book', color: 'blue' };
  if (type === 'instruction.skill') return { icon: 'skill', color: 'purple' };
  if (type.startsWith('agent.') || type.startsWith('ai.'))
    return { icon: type === 'agent.team' ? 'users' : 'bot', color: 'blue' };
  if (type.startsWith('control.') || type.startsWith('workflow.'))
    return { icon: 'branch', color: 'amber' };
  if (/^(quality|review|approval|safety|error)\./.test(type)) return { icon: 'shield', color: 'red' };
  return { icon: 'data', color: 'purple' };
}
export function BlockIcon({ type }: { type: string }) {
  const { icon, color } = blockIcon(type);
  return (
    <span className={'ws-block-icon ws-color-' + color}>
      <Icon name={icon} size={18} />
    </span>
  );
}
