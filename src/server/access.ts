import {timingSafeEqual} from 'node:crypto';

export const viewerOrigin = 'http://127.0.0.1:18214';
const allowedHosts = new Set(['127.0.0.1:18214','127.0.0.1:18314']);
export function tokenMatches(value: string | undefined, token: string): boolean {
  if(!value)return false;
  const actual=Buffer.from(value),expected=Buffer.from(token);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function bearerToken(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ')?header.slice(7):undefined;
}
export function sessionToken(cookie: string | undefined): string | undefined {
  return cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('remote_session='))?.slice('remote_session='.length);
}
export function validHost(host: string | undefined): boolean {
  return host!==undefined && allowedHosts.has(host);
}
export function authorized(headers: {host?:string;cookie?:string;origin?:string}, token:string):boolean {
  return validHost(headers.host) && (!headers.origin || headers.origin===viewerOrigin) && tokenMatches(sessionToken(headers.cookie),token);
}
