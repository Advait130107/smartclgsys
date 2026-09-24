export function nowUtc() {
  return new Date().toISOString();
}

export function toUtcDateOnly(value) {
  if (!value) return nowUtc().slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function toUtcIso(value) {
  if (!value) return nowUtc();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return nowUtc();
  return d.toISOString();
}
