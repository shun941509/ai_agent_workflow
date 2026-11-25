import { digest, key, now, set, tx } from '../src/server/db';

/** A browser identity created by older Studio releases, before login was required. */
export function legacyGuestSession() {
  return tx(() => {
    const user = { id: key(), login: null };
    const token = key() + key();
    set('INSERT INTO people VALUES(?,NULL,NULL,?)', user.id, now());
    set('INSERT INTO sessions VALUES(?,?,?)', digest(token), user.id, Date.now() + 86400000);
    return { user, cookie: 'studio_session=' + token };
  });
}
