'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api, message } from './client';
import StudioMark from './StudioMark';
import './account-entry.css';

type GuestWork = { projects: number; assets: number; conversations: number; links: number };

export default function AccountEntry({ returnTo, guestWork }: { returnTo: string; guestWork: GuestWork | null }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [choice, setChoice] = useState<'import' | 'keep' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const loginField = useRef<HTMLInputElement>(null);
  const signup = mode === 'signup';
  const hasGuestWork = guestWork && Object.values(guestWork).some(count => count > 0);
  const title = signup ? '계정 만들기' : '로그인';

  function switchMode() {
    setMode(signup ? 'login' : 'signup');
    setPassword('');
    setChoice(null);
    setError('');
    loginField.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError('');
    setBusy(true);
    try {
      await api('auth.' + mode, { login, password, importGuestWork: choice === 'import' });
      const destination = new URL(returnTo, window.location.origin);
      if (!destination.hash) destination.hash = window.location.hash;
      window.location.replace(destination.href);
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <div className="account-entry">
      <header className="account-masthead">
        <StudioMark />
        <span>Workflow Studio</span>
      </header>
      <main className="account-main">
        <div className="account-intro">
          <h1 id="account-title">{title}</h1>
          <p>{signup ? '작업실에 사용할 아이디와 비밀번호를 정해주세요.' : 'AI Agent 작업실을 열려면 로그인하세요.'}</p>
        </div>
        <form className="account-form" method="post" aria-labelledby="account-title" onSubmit={submit}>
          <div className="account-field">
            <label htmlFor="account-login">아이디</label>
            <input id="account-login" name="login" ref={loginField} type="text"
              autoComplete="username" autoCapitalize="none" spellCheck={false}
              maxLength={64} required readOnly={busy} value={login}
              onChange={e => setLogin(e.target.value)} aria-describedby={signup ? 'account-id-rule' : undefined} />
            {signup && <small id="account-id-rule">글자, 숫자, 점(.), 밑줄(_), 붙임표(-)로 3~40자</small>}
          </div>
          <div className="account-field">
            <label htmlFor="account-password">비밀번호</label>
            <input id="account-password" name="password" type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={8} maxLength={128} required readOnly={busy} value={password}
              onChange={e => setPassword(e.target.value)} aria-describedby={signup ? 'account-password-rule' : undefined} />
            {signup && <small id="account-password-rule">8~128자</small>}
          </div>
          {hasGuestWork && (
            <fieldset className="account-migration" disabled={busy}>
              <legend>이 브라우저의 이전 게스트 작업</legend>
              <p>Agent {guestWork.projects}개 · 자료 {guestWork.assets}개 · 대화 {guestWork.conversations}개
                {guestWork.links > 0 && ` · 공유받은 링크 ${guestWork.links}개`} (휴지통 포함)</p>
              {signup ? <p>계정을 만들면 이 작업이 새 계정에 보관됩니다.</p> : <>
                <label><input name="guest-work" type="radio" value="import" checked={choice === 'import'}
                  onChange={() => setChoice('import')} required />계정으로 가져오기</label>
                <label><input name="guest-work" type="radio" value="keep" checked={choice === 'keep'}
                  onChange={() => setChoice('keep')} required />이 브라우저에 보관</label>
                <small>브라우저에 보관하면 이 기기에서 다음에 로그인할 때 다시 선택할 수 있습니다.</small>
              </>}
            </fieldset>
          )}
          {error && <p className="account-error" role="alert">{error}</p>}
          <button className="account-submit" type="submit" disabled={busy}>
            {busy ? (signup ? '계정 만드는 중…' : '로그인 중…') : title}
          </button>
        </form>
        <div className="account-switch">
          <span>{signup ? '이미 계정이 있으신가요?' : '처음 방문하셨나요?'}</span>
          <button type="button" onClick={switchMode} disabled={busy}>{signup ? '로그인' : '계정 만들기'}</button>
        </div>
      </main>
    </div>
  );
}
