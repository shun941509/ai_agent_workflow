import {useId, useLayoutEffect, useRef, type ReactNode} from 'react';
import {Icon} from './Icons';
import {cycleDialogFocus} from '../dialog-focus';

export function Modal({title, size = 'standard', children, onClose}: {
  title: string;
  size?: 'confirm' | 'standard' | 'form' | 'settings';
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const headingId = useId();
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
  return <dialog className="ws-modal" data-size={size} ref={ref} aria-labelledby={headingId} onKeyDown={cycleDialogFocus}
    onCancel={event => {event.preventDefault(); onClose();}}
    onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      pressedBackdrop.current = event.target === event.currentTarget && (event.clientX < rect.left ||
        event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    }}
    onPointerCancel={() => { pressedBackdrop.current = false; }}
    onClick={event => {
      // A touch on a canvas output opens this dialog on pointerup. Its trailing
      // click can land on the new backdrop without starting a dismissal there.
      const startedOutside = pressedBackdrop.current;
      pressedBackdrop.current = false;
      if (!startedOutside || event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header>
      <h2 id={headingId}>{title}</h2>
      <button type="button" aria-label="닫기" className="ws-icon-button" onClick={onClose}><Icon name="close"/></button>
    </header>
    <div className="ws-modal-content" role={size === 'settings' ? 'region' : undefined}
      aria-label={size === 'settings' ? title + ' 내용' : undefined}
      tabIndex={size === 'settings' ? 0 : undefined}>{children}</div>
  </dialog>;
}
