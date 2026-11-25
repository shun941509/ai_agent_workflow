import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

export default function StudioDialog({
  title, onClose, children, wide = false, initialFocus, descriptionId, dismissDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  initialFocus?: RefObject<HTMLButtonElement | null>;
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
    <dialog ref={ref} className={'studio-dialog' + (wide ? ' wide' : '')}
      onCancel={event => {
        event.preventDefault();
        if (!dismissDisabled) onClose();
      }}
      aria-label={title} aria-describedby={descriptionId}>
      <header>
        <h2>{title}</h2>
        <button className="icon-btn" type="button" aria-label="닫기" disabled={dismissDisabled} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
