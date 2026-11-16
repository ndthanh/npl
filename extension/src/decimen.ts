// Independent sender implementation of the Decimen wire-v3 specification.
// Reference: bashalarmistalt/decimen-optical-transfer, commit
// 5301fc2020716b5a97d4edf6e1793c3dedbf6e17, docs/technical/{protocol,golden-vectors,versioning}.md.
// No upstream application/decoder source is bundled. Compatibility is checked
// separately against the upstream receiver, not only our own encoder.
export const DECIMEN_MAX_BYTES = 64 * 1024 * 1024;
export const DECIMEN_HEADER_BYTES = 22;
export function fnv(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}
export async function zipContainer(name: string, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > DECIMEN_MAX_BYTES)
    throw Error("Bộ nhận Decimen hỗ trợ ZIP tối đa 64 MiB.");
  const encoder = new TextEncoder(),
    filename = encoder.encode(name.split(/[\\/]/).at(-1) || "workspace.zip"),
    mime = encoder.encode("application/zip");
  if (filename.length > 65535) throw Error("Tên file quá dài.");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  );
  const output = new Uint8Array(
      49 + filename.length + mime.length + bytes.length,
    ),
    view = new DataView(output.buffer);
  output.set([0x44, 0x43, 0x46, 0x32, 0]); // DCF2, no gzip: ZIP is already compressed.
  view.setUint16(5, filename.length, true);
  view.setUint16(7, mime.length, true);
  view.setUint32(9, bytes.length, true);
  view.setUint32(13, bytes.length, true);
  output.set(digest, 17);
  output.set(filename, 49);
  output.set(mime, 49 + filename.length);
  output.set(bytes, 49 + filename.length + mime.length);
  return output;
}
// PRNG and block selection are part of the wire contract: all arithmetic is
// fixed-width integer arithmetic, so browser engines choose identical blocks.
export function composition(k: number, session: number, seq: number) {
  const position = seq % (2 * k);
  if (position < k) return [position];
  let seed = (Math.imul(session + 1, 0x9e3779b1) ^ (seq + 0x85ebca6b)) | 0;
  seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
  seed ^= seed >>> 16;
  const next = () => {
    seed = (seed + 0x9e3779b9) | 0;
    let value = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
  const degree = Math.min(k, 4 + (next() % 21)),
    result = new Set<number>();
  while (result.size < degree) result.add(next() % k);
  return [...result];
}
export function wireFrame(
  header: {
    sessionId: number;
    seq: number;
    k: number;
    blockLen: number;
    totalLen: number;
    payloadFnv: number;
  },
  block: Uint8Array,
) {
  const frame = new Uint8Array(22 + block.length),
    view = new DataView(frame.buffer);
  frame.set([0xd1, 0xc3, 3, 0]);
  view.setUint16(4, header.sessionId, true);
  view.setUint32(6, header.seq, true);
  view.setUint16(10, header.k, true);
  view.setUint16(12, header.blockLen, true);
  view.setUint32(14, header.totalLen, true);
  view.setUint32(18, header.payloadFnv, true);
  frame.set(block, 22);
  return frame;
}
export class DecimenSender {
  readonly k: number;
  readonly blockLen: number;
  readonly checksum: number;
  constructor(
    readonly container: Uint8Array,
    readonly sessionId = crypto.getRandomValues(new Uint16Array(1))[0],
  ) {
    this.blockLen = Math.max(512, Math.ceil(container.length / 65535 / 4) * 4);
    this.k = Math.ceil(container.length / this.blockLen);
    this.checksum = fnv(container);
    if (!this.k || this.k > 65535 || this.blockLen > 2800)
      throw Error("Payload vượt giới hạn wire format Decimen.");
  }
  frame(seq: number) {
    const block = new Uint8Array(this.blockLen);
    for (const index of composition(this.k, this.sessionId, seq)) {
      const start = index * this.blockLen,
        length = Math.min(this.blockLen, this.container.length - start);
      for (let i = 0; i < length; i++) block[i] ^= this.container[start + i];
    }
    return wireFrame(
      {
        sessionId: this.sessionId,
        seq,
        k: this.k,
        blockLen: this.blockLen,
        totalLen: this.container.length,
        payloadFnv: this.checksum,
      },
      block,
    );
  }
}
