import net from 'node:net';

export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'skipped' };

export interface VirusScanner {
  scan(stream: NodeJS.ReadableStream): Promise<ScanResult>;
}

/** Development without ClamAV: files are marked `skipped` (still allowed). Production config must set CLAMAV_HOST. */
export class NoopVirusScanner implements VirusScanner {
  async scan(stream: NodeJS.ReadableStream): Promise<ScanResult> {
    stream.resume?.();
    return { status: 'skipped' };
  }
}

/** clamd INSTREAM protocol over TCP (docs/backend/cross-cutting.md §13). */
export class ClamAvScanner implements VirusScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(stream: NodeJS.ReadableStream): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('ClamAV timeout')));
      socket.on('error', reject);
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim(); // "stream: OK" | "stream: X FOUND"
        if (reply.endsWith('OK')) resolve({ status: 'clean' });
        else if (reply.endsWith('FOUND'))
          resolve({ status: 'infected', signature: reply.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
        else reject(new Error(`Unexpected ClamAV reply: ${reply}`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        stream.on('data', (chunk: Buffer) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        });
        stream.on('end', () => socket.write(Buffer.alloc(4))); // zero-length chunk terminates the stream
        stream.on('error', (err) => socket.destroy(err as Error));
      });
    });
  }
}
