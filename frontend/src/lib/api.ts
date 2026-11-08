export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `Something went wrong (${res.status})`;
    try {
      const d = await res.json();
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = d.detail.map((x: { msg: string }) => x.msg).join("; ");
    } catch {}
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const money = (n: number | null | undefined, opts: { sign?: boolean } = {}) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = Math.abs(n) >= 10000 ? `$${(Math.abs(n) / 1000).toFixed(1)}k` : `$${Math.round(Math.abs(n)).toLocaleString()}`;
  return `${n < 0 ? "−" : opts.sign ? "+" : ""}${s}`;
};

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
