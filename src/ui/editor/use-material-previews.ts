import { useEffect, useState } from 'react';
import type { Graph } from '../../domain/types';
import { api } from '../client';

type Pin = { id: string; version?: number | string; token?: string };
const emptyPreviews: Readonly<Record<string, string>> = {};

export function useMaterialPreviews(graph: Graph): Readonly<Record<string, string>> {
  const references = graph.nodes.flatMap(node => {
    const { assetId, version, assetGrant } = node.config;
    return node.type === 'resource.context' && typeof assetId === 'string' && assetId
      ? [[node.id, { id: assetId, version, token: assetGrant }] as const] : [];
  });
  const key = JSON.stringify(references);
  const [result, setResult] = useState<{ key: string; values: Record<string, string> }>();
  useEffect(() => {
    const entries: [string, Pin][] = JSON.parse(key);
    if (!entries.length) return;
    const pins = new Map(entries.map(([, pin]) => [JSON.stringify(pin), pin]));
    let active = true;
    let sequence = 0;
    async function load() {
      const request = ++sequence;
      const excerpts = await api<string[]>('asset.previews', { pins: [...pins.values()] }).catch(() => []);
      if (!active || request !== sequence) return;
      const byPin = new Map([...pins.keys()].map((pin, index) => [pin, excerpts[index] ?? '']));
      const values = Object.fromEntries(entries.map(([nodeId, pin]) => [nodeId, byPin.get(JSON.stringify(pin)) ?? '']));
      setResult({ key, values });
    }
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [key]);
  return result?.key === key ? result.values : emptyPreviews;
}
