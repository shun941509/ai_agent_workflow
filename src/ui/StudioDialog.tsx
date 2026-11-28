import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cycleDialogFocus } from './dialog-focus';

export default function StudioDialog({
  title, displayHeading = title, onClose, children, footer, wide = false, size = wide ? 'form' : 'standard', initialFocus, descriptionId, dismissDisabled = false,
}: {
  title: string;
  displayHeading?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'confirm' | 'standard' | 'form' | 'settings' | 'workspace';
  wide?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  descriptionId?: string;
  dismissDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected && document.activeElement === document.body)
        opener.focus({preventScroll: true});
    };
  }, [initialFocus]);

  return (
    <dialog ref={ref} className={'studio-dialog' + (wide ? ' wide' : '')} data-size={size} onKeyDown={cycleDialogFocus}
      onCancel={event => {
        event.preventDefault();
        if (!dismissDisabled) onClose();
      }}
      aria-label={title} aria-describedby={descriptionId}>
      <header>
        <h2>{displayHeading}</h2>
        <button className="icon-btn" type="button" aria-label="닫기" disabled={dismissDisabled} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">{children}</div>
      {footer && <footer className="dialog-actions">{footer}</footer>}
    </dialog>
  );
}
