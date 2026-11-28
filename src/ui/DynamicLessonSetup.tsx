'use client';

import { useId, useState } from 'react';
import { ClipboardCopy } from 'lucide-react';
import { dynamicLessonChecks, dynamicLessonExample, dynamicLessonLimits, isDynamicLessonPolicy, type DynamicLessonPolicy } from '../domain/dynamic-lesson-policy';
import type { Lesson } from '../domain/types';
import LessonHandout from './guide/LessonHandout';
import { readLessonPolicy, rememberLessonPolicy, type LessonPolicyDraft } from './workspace-history';

export default function DynamicLessonSetup({ lesson, busy, label, onStart }: {
  lesson: Omit<Lesson, 'graph'>;
  busy: boolean;
  label: string;
  onStart: (policy: DynamicLessonPolicy) => void;
}) {
  const [draft, setDraft] = useState(readLessonPolicy);
  const formId = useId();
  const limitHintId = useId();
  const checksId = useId();
  const { total, simultaneous, failurePolicy } = draft;
  function update(change: Partial<LessonPolicyDraft>) {
    const next = {...draft, ...change};
    setDraft(next);
    rememberLessonPolicy(next);
  }
  const policy = { maxCreatedAgents: Number(total), maxInFlightAgents: Number(simultaneous), failurePolicy };
  const ready = isDynamicLessonPolicy(policy);
  const simultaneousLimit = Math.min(Number(total), dynamicLessonLimits.simultaneous);
  const limitHint = !simultaneous && draft.reselectLimit
    ? (total ? '총 생성 한도가 ' + total + '명으로 바뀌었습니다. 동시 실행 한도를 다시 선택해 주세요.'
      : '총 생성 한도를 정한 뒤 동시 실행 한도를 다시 선택해 주세요.') : '';

  const form = <form id={formId} className="form-stack lesson-policy" onSubmit={event => {
    event.preventDefault();
    if (!busy && ready) onStart(policy);
  }}>
    <fieldset disabled={busy}>
      <legend>내 사본의 조사 정책</legend>
      <div className="lesson-policy-limits">
        <label className="field">총 생성 한도
          <select required value={total} onChange={event => {
            const next = event.target.value;
            if (Number(simultaneous) > Number(next)) update({total:next, simultaneous:'', reselectLimit:true});
            else update({total:next});
          }}>
            <option value="">선택하세요</option>
            {Array.from({ length: dynamicLessonLimits.total }, (_, i) => <option key={i+1} value={i+1}>{i+1}명</option>)}
          </select>
        </label>
        <label className="field">동시 실행 한도
          <select required disabled={!total} value={simultaneous} aria-describedby={limitHint ? limitHintId : undefined}
            onChange={event => update({simultaneous:event.target.value, reselectLimit:false})}>
            <option value="">선택하세요</option>
            {Array.from({ length: simultaneousLimit }, (_, i) => <option key={i+1} value={i+1}>{i+1}명</option>)}
          </select>
        </label>
      </div>
      <p id={limitHintId} role="status" className="lesson-limit-hint">{limitHint}</p>
      <label className="field">지점 조사 실패 시
        <select required value={failurePolicy} onChange={event => update({failurePolicy:event.target.value})}>
          <option value="">선택하세요</option>
          <option value="collect">확인한 지점 결과를 보존하고 계속</option>
          <option value="stop">후속 조사를 중단하고 원인 확인</option>
        </select>
      </label>
    </fieldset>
    <section aria-labelledby={checksId}>
      <h3 id={checksId}>선택한 정책의 완료 기준</h3>
      {ready
        ? <ul>{dynamicLessonChecks(policy).map(check => <li key={check}>{check}</li>)}</ul>
        : <p>생성 한도와 실패 처리를 선택하면 네 지점 시험에서 확인할 결과가 표시됩니다.</p>}
      <p>{dynamicLessonExample}</p>
    </section>
  </form>;
  return <LessonHandout lesson={lesson} setup={form}
    actionHint={ready ? `총 ${total}명 · 동시 ${simultaneous}명` : '조사 정책 세 항목을 골라주세요.'}
    action={<button type="submit" form={formId} className="btn primary" disabled={busy || !ready}>
      <ClipboardCopy size={16} aria-hidden="true" />{label}
    </button>} />;
}
