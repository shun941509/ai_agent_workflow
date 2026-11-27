import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './project-name-heading.css';

export default function ProjectNameHeading({title, as: Heading = 'h1', id = 'lh-project-name'}: {
  title: ReactNode;
  as?: 'h1' | 'h2';
  id?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  useLayoutEffect(() => {
    const element = heading.current!;
    function measure() {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setNeedsToggle(element.scrollHeight > 2 * lineHeight + 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [title]);
  return <>
    <Heading id={id} className="lh-resume-heading" data-expanded={expanded} ref={heading}>{title}</Heading>
    {needsToggle && <button type="button" className="lh-title-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>{expanded ? '이름 접기' : '전체 이름 보기'}</button>}
  </>;
}
