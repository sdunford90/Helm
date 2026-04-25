import net from "node:net";

// ---------------------------------------------------------------------------
// clamd TCP client (INSTREAM)
//
// Talks the clamd wire protocol directly so we don't pull a 2-MB npm wrapper
// for what is functionally a 60-line TCP exchange. Operators run a clamd
// daemon (in a sidecar container, on a host, or via Cloudflare Worker that
// shells out to it) and point CLAMD_HOST + CLAMD_PORT at it.
//
// Protocol — from clamd(8):
//   write  "zINSTREAM\0"
//   loop:  write  <4-byte BE length>  <chunk bytes>
//   end:   write  <4 zero bytes>
//   read   "stream: OK\0"        → clean
//          "stream: <name> FOUND\0" → infected
// ---------------------------------------------------------------------------

export interface ScanResult {
  clean: boolean;
  virus?: string;
  /** Set when a scan was attempted but the daemon was unreachable / errored. */
  skipped?: boolean;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CHUNK = 64 * 1024;

function host(): string | null {
  return process.env.CLAMD_HOST?.trim() || null;
}
function port(): number {
  return parseInt(process.env.CLAMD_PORT ?? "3310", 10);
}
function isRequired(): boolean {
  return process.env.AV_REQUIRED === "true";
}

/**
 * Scan a Buffer with clamd. Returns clean=true / virus=name / skipped=true.
 * When CLAMD_HOST isn't configured: skipped (with reason "not_configured").
 *   - If AV_REQUIRED=true, the caller should treat skipped as a failure and
 *     refuse to mark the file ready.
 *   - Otherwise (dev / local), skipped passes through and the file is
 *     considered clean by callers that want to fall through.
 */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  const h = host();
  if (!h) {
    return { clean: !isRequired(), skipped: true, reason: "not_configured" };
  }

  return new Promise<ScanResult>((resolve) => {
    const socket = new net.Socket();
    let response = "";
    let settled = false;

    const finish = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };

    socket.setTimeout(DEFAULT_TIMEOUT_MS);
    socket.on("timeout", () =>
      finish({ clean: !isRequired(), skipped: true, reason: "timeout" }),
    );
    socket.on("error", (err) =>
      finish({
        clean: !isRequired(),
        skipped: true,
        reason: `socket: ${err.message}`,
      }),
    );
    socket.on("data", (data) => {
      response += data.toString("utf8");
    });
    socket.on("close", () => {
      const text = response.replace(/\0/g, "").trim();
      if (/stream: OK$/i.test(text)) {
        finish({ clean: true });
        return;
      }
      const found = text.match(/stream:\s+(.+)\s+FOUND/i);
      if (found) {
        finish({ clean: false, virus: found[1] });
        return;
      }
      finish({
        clean: !isRequired(),
        skipped: true,
        reason: `unexpected response: ${text.slice(0, 120)}`,
      });
    });

    socket.connect(port(), h, () => {
      socket.write("zINSTREAM\0");
      // Stream chunks
      for (let i = 0; i < buf.length; i += MAX_CHUNK) {
        const end = Math.min(i + MAX_CHUNK, buf.length);
        const chunk = buf.subarray(i, end);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(header);
        socket.write(chunk);
      }
      // Terminator
      const term = Buffer.alloc(4);
      term.writeUInt32BE(0, 0);
      socket.write(term);
    });
  });
}
