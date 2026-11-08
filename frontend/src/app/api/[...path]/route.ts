// Same-origin proxy to the FastAPI backend: the browser only ever talks to this app,
// so the auth cookie stays first-party and the backend URL / secrets never reach the client.
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // SSE streams for live agent runs

const BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const PASS_REQ = ["content-type", "cookie", "last-event-id", "accept"];
const PASS_RES = ["content-type", "cache-control", "set-cookie"];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${BACKEND}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of PASS_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  if (ip) headers.set("x-client-ip", ip);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return Response.json({ detail: "The StackSmith server is waking up - try again in a few seconds." }, { status: 503 });
  }

  const out = new Headers();
  for (const h of PASS_RES) {
    if (h === "set-cookie") {
      for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
    } else {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
  }
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
