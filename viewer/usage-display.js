function quotaLabel(seconds) {
  if (seconds === 18000) return '5-hour';
  if (seconds === 604800) return 'Weekly';
  for (const [unit, size] of [['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (seconds % size === 0) return `${seconds / size}-${unit}`;
  return `${seconds}-second`;
}

function usageDisplay(usage, now = Date.now(), locale = undefined, timeZone = undefined) {
  const snapshotTime = usage?.observedAt ? usage.observedAt * 1000 : null;
  const ageMinutes = snapshotTime ? Math.max(0, Math.floor((now - snapshotTime) / 60000)) : null;
  const age = ageMinutes === null ? '' : ageMinutes < 1 ? 'just now' : ageMinutes < 60
    ? `${ageMinutes}m ago` : ageMinutes < 1440 ? `${Math.floor(ageMinutes / 60)}h ago` : `${Math.floor(ageMinutes / 1440)}d ago`;
  const source = usage?.source === 'remote' ? 'Remote Vitals' : 'Local Vitals';
  const provenance = snapshotTime ? `${source} · updated ${age}` : 'No Vitals usage snapshot';
  if (usage?.status !== 'available' || !usage.windows?.length) return {
    windows: [], provenance, stale: true,
    message: usage?.status === 'error' ? 'Vitals could not refresh usage. Refresh the account in Vitals.' : 'Usage unavailable. Refresh the account in Vitals.',
  };
  const date = new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? {timeZone} : {})});
  const percent = new Intl.NumberFormat(locale, {maximumFractionDigits: 1});
  return {provenance, stale: ageMinutes === null || ageMinutes > 15,
    windows: usage.windows.map(window => {
      const passed = window.resetsAt !== null && window.resetsAt * 1000 <= now;
      return {label: quotaLabel(window.limitSeconds), percent: window.remainingPercent,
        remaining: `${percent.format(window.remainingPercent)}% ${passed ? 'at last check' : 'left'}`,
        reset: !window.resetsAt ? 'Reset time unavailable' : passed
          ? 'Reset time passed · refresh Vitals' : `Resets ${date.format(window.resetsAt * 1000)}`,
        resetPassed: passed};
    })};
}

if (typeof module !== 'undefined') module.exports = {quotaLabel, usageDisplay};
