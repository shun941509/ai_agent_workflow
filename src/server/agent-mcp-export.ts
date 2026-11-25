import {BlockList,isIP} from 'node:net';
import type {ExportMcp,ExportPackage} from '../domain/agent-export';
import type {Payload} from './assets';

const localNetworks = new BlockList();
const localIpv4Ranges = [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4],
] as const;
for (const [address, prefix] of localIpv4Ranges) localNetworks.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::',3,'ipv6');

function portableUrl(value?: string) {
  if (!value || !URL.canParse(value)) return;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$|\.$/g, '');
  if (isIP(host) === 6) return globalV6.check(host, 'ipv6') ? url.href : undefined;
  if (isIP(host) === 4) return localNetworks.check(host, 'ipv4') ? undefined : url.href;
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/.test(host)) return;
  return url.href;
}

export function exportMcp(key: string, name: string, payload?: Payload): ExportMcp {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'mcp';
  const id = stem + '-' + key.slice(2, 14);
  const tools = [...new Set(payload?.tools ?? [])];
  const url = payload?.builtin ? undefined : portableUrl(payload?.url);
  if (!url) return {id, tools};
  const connection: ExportMcp = {id, url, tools};
  if (payload?.credentialEnv) connection.tokenEnv = 'MCP_' + id.toUpperCase().replace(/-/g, '_') + '_TOKEN';
  return connection;
}

export function mcpConfigFiles(resources: ExportPackage['resources']): Record<string, string> {
  const codex: string[] = [], claude: Record<string, unknown> = {}, opencode: Record<string, unknown> = {};
  for (const {included, mcp} of resources) {
    if (!included || !mcp?.url) continue;
    const {id, url, tokenEnv, tools} = mcp;
    codex.push('[mcp_servers.' + JSON.stringify(id) + ']', 'url = ' + JSON.stringify(url));
    if (tools.length) codex.push('enabled_tools = ' + JSON.stringify(tools));
    if (tokenEnv) codex.push('bearer_token_env_var = ' + JSON.stringify(tokenEnv));
    codex.push('');
    const claudeAuth = tokenEnv ? {headers: {Authorization: 'Bearer ${' + tokenEnv + '}'}} : {};
    const opencodeAuth = tokenEnv ? {oauth: false, headers: {Authorization: 'Bearer {env:' + tokenEnv + '}'}} : {};
    claude[id] = {type: 'http', url, ...claudeAuth};
    opencode[id] = {type: 'remote', url, ...opencodeAuth};
  }
  if (!codex.length) return {};
  return {
    '.codex/config.toml': codex.join('\n'),
    '.mcp.json': JSON.stringify({mcpServers: claude}, null, 2) + '\n',
    'opencode.json': JSON.stringify({mcp: opencode}, null, 2) + '\n',
  };
}
