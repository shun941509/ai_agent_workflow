import { useRef } from 'react';
import { Icon } from './Icons';

const tabs = ['properties', 'results'] as const;
export type InspectorTab = (typeof tabs)[number];
const labels = { properties: '속성', results: '실행 결과' };

export function InspectorTabs({ selected, onSelect, onClose }: {
  selected: InspectorTab;
  onSelect: (tab: InspectorTab) => void;
  onClose: () => void;
}) {
  const tabList = useRef<HTMLDivElement>(null);
  return <div className="ws-inspector-header">
    <div ref={tabList} role="tablist" aria-label="편집 패널" onKeyDown={event => {
      let next: InspectorTab;
      if (event.key === 'Home') next = 'properties';
      else if (event.key === 'End') next = 'results';
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = selected === 'properties' ? 'results' : 'properties';
      else return;
      event.preventDefault();
      onSelect(next);
      tabList.current?.querySelector<HTMLButtonElement>('#ws-tab-' + next)?.focus();
    }}>
      {tabs.map(tab => <button key={tab} id={'ws-tab-' + tab} role="tab" type="button"
        aria-controls={'ws-panel-' + tab} aria-selected={tab === selected} tabIndex={tab === selected ? 0 : -1}
        onClick={() => onSelect(tab)}>{labels[tab]}</button>)}
    </div>
    {selected === 'results' && <button type="button" className="ws-icon-button" aria-label="실행 화면 닫기" onClick={onClose}><Icon name="close" /></button>}
  </div>;
}
