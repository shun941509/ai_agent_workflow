import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, digest, key, now, one, set, tx } from './db';
import { requireThat, stringArg } from './errors';
import { guestWorkSummary, importGuestWork } from './guest-work';
export interface User {
  id: string;
  login: string | null;
}
export interface Session {
  user: User;
  cookie?: string;
}
const cookieName = 'studio_session';
function sessionCookie(secret: string, maxAge: number) {
  return `${cookieName}=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
    (process.env.STUDIO_HTTPS === '1' ? '; Secure' : '');
}
function issue(user: User): Session {
  const secret = key() + key();
  set(
    'INSERT INTO sessions VALUES(?,?,?)',
    digest(secret),
    user.id,
    Date.now() + 90 * 86400000
  );
  return {
    user,
    cookie: sessionCookie(secret, 7776000),
  };
}
function cookieHash(cookie: string) {
  const token = cookie.match(/(?:^|;\s*)studio_session=([\w-]+)/)?.[1];
  return token ? digest(token) : '';
}
export function lookupSession(cookie: string): Session | null {
  const hash = cookieHash(cookie);
  if (!hash) return null;
  const user = one<User>(
    'SELECT p.id,p.login FROM sessions s JOIN people p ON p.id=s.owner WHERE s.hash=? AND s.expires>?',
    hash,
    Date.now()
  );
  return user ? { user } : null;
}
export function logOut(cookie: string) {
  return tx(() => {
    const current = lookupSession(cookie);
    if (!current) return sessionCookie('', 0);
    // A repeated logout must not discard this browser's legacy work awaiting import.
    if (!current.user.login) return undefined;
    const hash = cookieHash(cookie);
    const guest = one<User>(
      `SELECT p.id,p.login FROM parked_guest_workspaces g JOIN sessions s ON s.hash=g.session_hash
       JOIN people p ON p.id=g.guest WHERE s.hash=? AND s.expires>? AND p.login IS NULL`,
      hash, Date.now()
    );
    set('DELETE FROM sessions WHERE hash=?', hash);
    return guest ? issue(guest).cookie : sessionCookie('', 0);
  });
}
function makePassword(pwd: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(pwd, salt, 64).toString('hex');
}
export function authenticate(
  action: 'signup' | 'login',
  loginArg: unknown,
  passwordArg: unknown,
  cookie: string,
  bringGuestWork = false
): Session {
  const current = lookupSession(cookie)?.user;
  const login = stringArg(loginArg, '아이디', 64)
    .normalize('NFKC')
    .toLowerCase();
  requireThat(
    /^[\p{L}\p{N}_.-]{3,40}$/u.test(login),
    400,
    '아이디는 3~40자의 글자·숫자·점·밑줄·붙임표를 사용하세요.'
  );
  requireThat(
    typeof passwordArg === 'string' &&
      passwordArg.length >= 8 &&
      passwordArg.length <= 128,
    400,
    '비밀번호는 8~128자입니다.'
  );
  if (action === 'signup') {
    requireThat(!current?.login, 409, '이미 로그인한 계정입니다.');
    const encoded = makePassword(passwordArg);
    return tx(() => {
      requireThat(
        !one('SELECT 1 FROM people WHERE login=?', login),
        409,
        '이미 사용 중인 아이디입니다.'
      );
      const id = current?.id ?? key();
      if (current) {
        requireThat(lookupSession(cookie)?.user.id === id, 409, '계정 상태가 변경되었습니다. 다시 시도하세요.');
        set('UPDATE people SET login=?,password=? WHERE id=? AND login IS NULL', login, encoded, id);
        set('DELETE FROM sessions WHERE owner=?', id);
      } else {
        set('INSERT INTO people(id,login,password,created) VALUES(?,?,?,?)', id, login, encoded, now());
      }
      return issue({ id, login });
    });
  }
  const bucket = 'login:' + digest(login);
  const limit = one<{ count: number; deadline: number }>(
    'SELECT * FROM throttles WHERE name=?',
    bucket
  );
  requireThat(
    !limit || limit.deadline < Date.now() || limit.count < 12,
    429,
    '잠시 후 다시 로그인하세요.'
  );
  const row = one<User & { password: string }>(
    'SELECT id,login,password FROM people WHERE login=?',
    login
  );
  const [salt, encoded] = (
    row?.password || 'fictitious:' + '00'.repeat(64)
  ).split(':');
  if (
    !timingSafeEqual(
      scryptSync(passwordArg, salt, 64),
      Buffer.from(encoded, 'hex')
    ) ||
    !row
  ) {
    set(
      'INSERT INTO throttles VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET count=CASE WHEN deadline<? THEN 1 ELSE count+1 END,deadline=CASE WHEN deadline<? THEN excluded.deadline ELSE deadline END',
      bucket,
      Date.now() + 600000,
      Date.now(),
      Date.now()
    );
    requireThat(false, 401, '아이디 또는 비밀번호를 확인하세요.');
  }
  return tx(() => {
    set('DELETE FROM throttles WHERE name=?', bucket);
    const previousHash = cookieHash(cookie);
    const guest = current && !current.login && Object.values(guestWorkSummary(current.id)).some(count => count > 0)
      ? current : null;
    if (guest) {
      requireThat(one(`SELECT 1 FROM sessions s JOIN people p ON p.id=s.owner
        WHERE s.hash=? AND p.id=? AND p.login IS NULL AND s.expires>?`, previousHash, guest.id, Date.now()),
        409, '작업실 계정이 변경되었습니다. 화면을 새로 고친 뒤 로그인하세요.');
      if (bringGuestWork) importGuestWork(guest.id, row.id);
    }
    const accountSession = issue({ id: row.id, login: row.login });
    const nextHash = cookieHash(accountSession.cookie!);
    if (guest && !bringGuestWork) {
      set('INSERT INTO parked_guest_workspaces(session_hash,guest) VALUES(?,?)', nextHash, guest.id);
    } else if (current?.login) {
      // Retrying login rotates the cookie. The guest workspace still belongs to this browser.
      set(`UPDATE parked_guest_workspaces SET session_hash=? WHERE session_hash IN (
             SELECT hash FROM sessions WHERE hash=? AND owner=? AND expires>?
           )`, nextHash, previousHash, current.id, Date.now());
    }
    set('DELETE FROM sessions WHERE hash=?', previousHash);
    return accountSession;
  });
}
export function day() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
    new Date()
  );
}
export function quotaMax(category: 'run' | 'design') {
  const raw = Number(
    process.env[
      category === 'run' ? 'STUDIO_GUEST_RUNS' : 'STUDIO_GUEST_DESIGNS'
    ] ?? 3
  );
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 3;
}
export function charge(user: User, category: 'run' | 'design') {
  if (user.login) return;
  const today = day();
  const used =
    one<{ used: number }>(
      'SELECT used FROM quotas WHERE owner=? AND day=? AND category=?',
      user.id,
      today,
      category
    )?.used ?? 0;
  requireThat(
    used < quotaMax(category),
    429,
    '오늘의 게스트 ' +
      (category === 'run' ? '실행' : '설계 제안') +
      ' 횟수를 모두 사용했습니다. 내일 같은 브라우저에서 이어갈 수 있습니다.'
  );
  set(
    'INSERT INTO quotas VALUES(?,?,?,1) ON CONFLICT(owner,day,category) DO UPDATE SET used=used+1',
    user.id,
    today,
    category
  );
}
export function usage(user: User) {
  const rows = all<{ category: string; used: number }>(
    'SELECT category,used FROM quotas WHERE owner=? AND day=?',
    user.id,
    day()
  );
  return Object.fromEntries(
    (['run', 'design'] as const).map((k) => [
      k,
      {
        used: rows.find((r) => r.category === k)?.used ?? 0,
        max: user.login ? null : quotaMax(k),
      },
    ])
  );
}
