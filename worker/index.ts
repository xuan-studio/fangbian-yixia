/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  AMAP_JS_KEY?: string;
  AMAP_SECURITY_JS_CODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/map-config") {
      return Response.json(
        {
          provider: env.AMAP_JS_KEY ? "amap" : "maplibre",
          amapKey: env.AMAP_JS_KEY ?? null,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (url.pathname.startsWith("/_AMapService/")) {
      if (!env.AMAP_SECURITY_JS_CODE) {
        return Response.json({ error: "AMap service proxy is not configured" }, { status: 503 });
      }
      const target = new URL(url.pathname.replace("/_AMapService", ""), "https://restapi.amap.com");
      target.search = url.search;
      target.searchParams.set("jscode", env.AMAP_SECURITY_JS_CODE);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cookie");
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "follow",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/slides" || url.pathname === "/slides/") {
      const target = new URL("/slides/index.html", request.url);
      target.search = url.search;
      return Response.redirect(target, 302);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
