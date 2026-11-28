import { useId, useRef, useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import StudioDialog from '../StudioDialog';
import styles from './GuideVisual.module.css';

type Props = {
  title: string;
  description: string;
  children: ReactNode;
  compact?: boolean;
  dialogSize?: 'standard' | 'form' | 'settings';
};

export function GuideVisual({title, description, children, compact = false, dialogSize = 'settings'}: Props) {
  const [open, setOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const dialogDescriptionId = useId();
  const label = title + ' 크게 보기';

  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({preventScroll:true}));
  }

  return <>
    <figure className={styles.figure} aria-labelledby={captionId}>
      {children}
      <figcaption className={styles.caption}>
        <span>
          <strong id={captionId} className={compact ? styles.visuallyHidden : undefined}>{title}</strong>
          {description}
        </span>
        <button type="button" ref={trigger} className={styles.expand}
          aria-label={label} aria-haspopup="dialog" onClick={() => {
            setEnlarged(false);
            setOpen(true);
          }}>
          <Maximize2 aria-hidden="true" size={16} />크게 보기
        </button>
      </figcaption>
    </figure>
    {open && <StudioDialog size={dialogSize} title={label} displayHeading={title} descriptionId={dialogDescriptionId} onClose={close}>
      <div className={styles.tools}>
        <p id={dialogDescriptionId}>{description}</p>
        <button type="button" className="btn" aria-pressed={enlarged} onClick={() => {
          setEnlarged(!enlarged);
          viewport.current?.scrollTo(0, 0);
        }}>1.5배 확대</button>
      </div>
      <div className={styles.viewport} ref={viewport} tabIndex={0} role="region" aria-label={title + ' 상세 그림'}>
        <div className={styles.canvas} data-enlarged={enlarged}>{children}</div>
      </div>
    </StudioDialog>}
  </>;
}
