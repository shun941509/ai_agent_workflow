import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2 } from 'lucide-react';
import { cycleDialogFocus } from './dialog-focus';
import './prompt-textarea.css';

type Props = Omit<ComponentPropsWithRef<'textarea'>, 'value' | 'defaultValue'> & {
  value: string;
  expandLabel: string;
  label?: ReactNode;
};

function fitHeight(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.height = (input.scrollHeight + input.offsetHeight - input.clientHeight) + 'px';
}

export function PromptTextarea({ expandLabel, label, value, ref, ...props }: Props) {
  const inline = useRef<HTMLTextAreaElement>(null);
  const expanded = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useImperativeHandle(ref, () => inline.current!, []);

  useLayoutEffect(() => {
    const input = inline.current;
    if (!input || CSS.supports('field-sizing', 'content')) return;
    fitHeight(input);
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === input.clientWidth) return;
      width = input.clientWidth;
      fitHeight(input);
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = dialog.current!;
    const field = expanded.current!;
    const source = inline.current!;
    panel.showModal();
    // Some mobile browsers shrink only the visual viewport when the keyboard opens.
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!viewport || viewport.scale !== 1) {
        panel.style.removeProperty('--prompt-visible-height');
        panel.style.removeProperty('--prompt-visible-top');
        return;
      }
      panel.style.setProperty('--prompt-visible-height', viewport.height + 'px');
      panel.style.setProperty('--prompt-visible-top', viewport.offsetTop + 'px');
    };
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    field.focus({ preventScroll: true });
    field.setSelectionRange(source.selectionStart, source.selectionEnd, source.selectionDirection);
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      if (panel.open) panel.close();
    };
  }, [open]);

  function finish() {
    const field = expanded.current!;
    inline.current?.setSelectionRange(field.selectionStart, field.selectionEnd, field.selectionDirection);
    dialog.current?.close();
    setOpen(false);
    opener.current?.focus({ preventScroll: true });
  }

  const fieldId = props.id ?? (label ? titleId + '-field' : undefined);
  const expandButton = <button type="button" className="prompt-input-expand" ref={opener} disabled={props.disabled}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Maximize2 size={14} aria-hidden="true" />
      <span className="prompt-input-context">{expandLabel} </span>넓게 쓰기
    </button>;
  return <div className="prompt-input">
    {label && <div className="prompt-input-heading"><label htmlFor={fieldId}>{label}</label>{expandButton}</div>}
    <textarea {...props} id={fieldId} ref={inline} value={value} />
    {!label && expandButton}
    {open && createPortal(
      <dialog className="prompt-writing-dialog" ref={dialog} aria-labelledby={titleId} onKeyDown={cycleDialogFocus}
        onCancel={event => { event.preventDefault(); event.stopPropagation(); finish(); }}>
        <header>
          <h2 id={titleId}>{expandLabel}</h2>
          <button type="button" onClick={finish}>작성 마치기</button>
        </header>
        <textarea ref={expanded} aria-labelledby={titleId} aria-describedby={props['aria-describedby']}
          aria-invalid={props['aria-invalid']} aria-required={props['aria-required']} required={props.required}
          disabled={props.disabled} readOnly={props.readOnly} maxLength={props.maxLength} placeholder={props.placeholder}
          spellCheck={props.spellCheck} value={value} onChange={props.onChange} />
      </dialog>, document.body)}
  </div>;
}
