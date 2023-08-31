import { readFileSync } from "fs";

class WasmHelper {
  path: string;

  exports: string[];

  memory: WebAssembly.Memory;

  HEAPU8: Uint8Array;

  HEAPU32: Uint32Array;

  UTF8Decoder: TextDecoder = new TextDecoder("utf8");

  printCharBuffers: Array<null | number[]> = [null, [], []];

  maxHeap: number;

  constructor(path: string, exports: string[], maxHeap: number) {
    this.path = path;
    this.exports = exports;
    this.maxHeap = maxHeap;
  }

  updateMemoryViews() {
    const b = this.memory.buffer;
    this.HEAPU8 = new Uint8Array(b);
    this.HEAPU32 = new Uint32Array(b);
  }

  UTF8ArrayToString(heapOrArray: Buffer, idx: number, maxBytesToRead?: number) {
    const endIdx = idx + maxBytesToRead;
    let endPtr = idx;
    while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
    if (endPtr - idx > 16 && heapOrArray.buffer && this.UTF8Decoder) {
      return this.UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    let str = "";
    while (idx < endPtr) {
      let u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      const u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) === 192) {
        str += String.fromCharCode(((u0 & 31) << 6) | u1);
        continue;
      }
      const u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) === 224) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 =
          ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        const ch = u0 - 65536;
        str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
      }
    }
    return str;
  }

  printChar(stream: number, curr: number) {
    const buffer = this.printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? console.log.bind(console) : console.error.bind(console))(
        this.UTF8ArrayToString(Buffer.from(buffer), 0)
      );
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  }

  fdWrite(fd: number, iov: number, iovcnt: number, pnum: number) {
    let num = 0;
    for (let i = 0; i < iovcnt; i++) {
      const ptr = this.HEAPU32[iov >> 2];
      const len = this.HEAPU32[(iov + 4) >> 2];
      iov += 8;
      for (let j = 0; j < len; j++) {
        this.printChar(fd, this.HEAPU8[ptr + j]);
      }
      num += len;
    }
    this.HEAPU32[pnum >> 2] = num;
    return 0;
  }

  static emscriptenDateNow = () => Date.now();

  emscriptenMemcpyBig(dest: number, src: number, num: number) {
    dest >>>= 0;
    src >>>= 0;
    num >>>= 0;
    return this.HEAPU8.copyWithin(dest >>> 0, src >>> 0, (src + num) >>> 0);
  }

  getHeapMax = () => this.maxHeap;

  growMemory(size: number): number {
    const b = this.memory.buffer;
    const pages = (size - b.byteLength + 65535) >>> 16;
    try {
      this.memory.grow(pages);
      this.updateMemoryViews();
      return 1;
    } catch (e) {
      return 0;
    }
  }

  emscriptenResizeHeap(requestedSize: number) {
    requestedSize >>>= 0;
    const oldSize = this.HEAPU8.length;
    const maxHeapSize = this.getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    const alignUp = (x: number, multiple: number) =>
      x + ((multiple - (x % multiple)) % multiple);
    for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
      let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(
        overGrownHeapSize,
        requestedSize + 100663296
      );
      const newSize = Math.min(
        maxHeapSize,
        alignUp(Math.max(requestedSize, overGrownHeapSize), 65536)
      );
      const replacement = this.growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  }

  async init(
    additionalEnv: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const wasmBuffer = readFileSync(this.path);
    const wasmImports = {
      emscripten_date_now: WasmHelper.emscriptenDateNow,
      emscripten_memcpy_big: this.emscriptenMemcpyBig.bind(this),
      emscripten_resize_heap: this.emscriptenResizeHeap.bind(this),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      emscripten_notify_memory_growth: () => {},
      fd_write: this.fdWrite.bind(this),
    };
    const env = {
      ...wasmImports,
      ...additionalEnv,
    };
    return WebAssembly.instantiate(wasmBuffer, {
      env,
      wasi_snapshot_preview1: wasmImports,
    }).then((result) => {
      const allExports = result.instance.exports;
      this.memory = allExports.memory as WebAssembly.Memory;
      this.updateMemoryViews();
      const retObj = {};
      this.exports.forEach((exp) => {
        retObj[exp] = (allExports as unknown)[exp];
      });
      return retObj;
    });
  }
}

export default WasmHelper;
