import { NextRequest } from "next/server";
import { runScan } from "@/lib/scan/orchestrator";
import { VALID_SOURCES } from "@/lib/scrapers/registry";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function handleGET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const onlySource = searchParams.get("source")?.toLowerCase() ?? null;
  const restrictedSource =
    onlySource && VALID_SOURCES.includes(onlySource) ? onlySource : null;

  const encoder = new TextEncoder();
  // Client parti (onglet fermé, bouton « Précédent ») : on n'écrit plus dans le
  // flux, mais le scan va au bout — sinon la source en cours reste à moitié
  // scannée, les suivantes jamais, et scan_runs reste figé à « running ».
  let clientGone = false;
  const stream = new ReadableStream({
    async start(controller) {
      const write = (chunk: string) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          clientGone = true;
        }
      };
      const send = (data: unknown) => write(`data: ${JSON.stringify(data)}\n\n`);
      const log = (line: string) => send({ kind: "log", line });

      // 1. Force-flush 2KB of SSE comment so Next.js / proxies stop buffering immediately.
      //    Comments (lines starting with ":") are ignored by EventSource clients.
      write(`: ${" ".repeat(2048)}\n\n`);
      // 2. Heartbeat ping every 10s so the client knows we're alive even if scrapers are slow.
      const heartbeat = setInterval(() => write(`: ping\n\n`), 10000);

      // 3. Immediate "scan-started" event so the UI shows progress instantly
      send({
        kind: "scan-started",
        at: new Date().toISOString(),
        onlySource: restrictedSource,
      });

      try {
        for await (const ev of runScan(log, restrictedSource ? { onlySource: restrictedSource } : undefined)) send(ev);
      } catch (e) {
        send({
          kind: "error",
          source: "orchestrator",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        clearInterval(heartbeat);
        send({ kind: "close" });
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // flux déjà annulé par le client
          }
        }
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // Tell reverse proxies (nginx, fly, vercel) and Next.js NOT to buffer this response.
      "x-accel-buffering": "no",
      // Disable Content-Encoding negotiation — gzip would buffer
      "content-encoding": "identity",
    },
  });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
