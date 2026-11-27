import assert from 'node:assert/strict';
import {test} from 'node:test';
import {preferredList, rememberCanvasMode} from './canvas-preference';

test('작업자가 선택한 보기는 같은 계정의 같은 Workflow에서만 복원한다', () => {
  const values = new Map<string,string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable:true, value:{localStorage:{
    getItem:(key:string) => values.get(key) ?? null,
    setItem:(key:string, value:string) => values.set(key, value),
  }}});
  try {
    assert.equal(preferredList('first', 'library', true), true);
    rememberCanvasMode('first', 'library', 'diagram');
    assert.equal(preferredList('first', 'library', true), false);
    assert.equal(preferredList('second', 'library', true), true);
    assert.equal(preferredList('first', 'other', true), true);
    assert.equal(preferredList('first', 'other', false), false);
    rememberCanvasMode('first', 'library', 'list');
    assert.equal(preferredList('first', 'library', false), true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
