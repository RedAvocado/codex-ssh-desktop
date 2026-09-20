// Electron accepts cyclic structured-clone values. Our JSON bridge does not.
// Third-party diagnostic errors can reference themselves; normalize only logs,
// never task requests, so a logging failure cannot block the control channel.
export function prepareIpcArgs(args: unknown[]): unknown[] {
  const message = args[0] as {type?: unknown} | undefined;
  if (message?.type !== 'log-message') return args;
  const seen = new WeakSet<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return value.length > 16384 ? value.slice(0,16384) + ' [truncated]' : value;
    if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return '[Function]';
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    if (depth > 10) return '[Depth limit]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0,200).map(item => copy(item,depth+1));
    const result: Record<string, unknown> = Object.create(null);
    // Preserve useful Error fields, which are normally non-enumerable.
    const keys = [...new Set([...(value instanceof Error ? ['name','message','stack'] : []),...Object.keys(value)])].slice(0,200);
    for (const key of keys) {
      try { result[key] = copy((value as Record<string, unknown>)[key],depth+1); }
      catch { result[key] = '[Unreadable]'; }
    }
    return result;
  };
  try { return copy(args,0) as unknown[]; }
  catch { return [{type:'log-message',level:'warn',message:'Remote diagnostic could not be serialized'}]; }
}
