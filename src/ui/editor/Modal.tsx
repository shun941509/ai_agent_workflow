import {useLayoutEffect, useRef, type ReactNode} from 'react';
import {Icon} from './Icons';

export function Modal({title, children, onClose}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if ((opener instanceof HTMLElement || opener instanceof SVGElement) && opener.isConnected && document.activeElement === document.body)
        opener.focus({preventScroll:true});
    };
  }, []);
  return <dialog className="ws-modal" ref={ref} aria-label={title}
    onCancel={event => {event.preventDefault(); onClose();}}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header>
      <h2>{title}</h2>
      <button type="button" aria-label="닫기" className="ws-icon-button" onClick={onClose}><Icon name="close"/></button>
    </header>
    <div className="ws-modal-content">{children}</div>
  </dialog>;
}
