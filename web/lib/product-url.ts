const fallbackProductUrl = "http://127.0.0.1:4319";

export function productUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_VOW_APP_URL ?? fallbackProductUrl).replace(/\/$/, "");
  const suffix = path.length === 0 || path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
