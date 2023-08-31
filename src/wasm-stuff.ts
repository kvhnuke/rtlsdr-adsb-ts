let wasmMemory: WebAssembly.Memory;
// const Module: any = {};

// let HEAP8: Int8Array;
let HEAPU8: Uint8Array;
// let HEAP16: Int16Array;
// let HEAPU16: Uint16Array;
// let HEAP32: Int32Array;
let HEAPU32: Uint32Array;
// let HEAPF32: Float32Array;
// let HEAPF64: Float64Array;

const updateMemoryViews = () => {
  const b = wasmMemory.buffer;
  HEAPU8 = new Uint8Array(b);
  //   Module.HEAP8 = HEAP8 = new Int8Array(b);
  //   Module.HEAP16 = HEAP16 = new Int16Array(b);
  // HEAP32 = new Int32Array(b);
  //   Module.HEAPU8 = HEAPU8 = new Uint8Array(b);
  //   Module.HEAPU16 = HEAPU16 = new Uint16Array(b);
  HEAPU32 = new Uint32Array(b);
  //   Module.HEAPF32 = HEAPF32 = new Float32Array(b);
  //   Module.HEAPF64 = HEAPF64 = new Float64Array(b);
};
const UTF8Decoder =
  typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : undefined;

const UTF8ArrayToString = (
  heapOrArray: Buffer,
  idx: number,
  maxBytesToRead?: number
) => {
  const endIdx = idx + maxBytesToRead;
  let endPtr = idx;
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
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
};
const printCharBuffers: Array<null | number[]> = [null, [], []];
const printChar = (stream: number, curr: number) => {
  const buffer = printCharBuffers[stream];
  if (curr === 0 || curr === 10) {
    (stream === 1 ? console.log.bind(console) : console.error.bind(console))(
      UTF8ArrayToString(Buffer.from(buffer), 0)
    );
    buffer.length = 0;
  } else {
    buffer.push(curr);
  }
};

const fdWrite = (fd: number, iov: number, iovcnt: number, pnum: number) => {
  let num = 0;
  for (let i = 0; i < iovcnt; i++) {
    const ptr = HEAPU32[iov >> 2];
    const len = HEAPU32[(iov + 4) >> 2];
    iov += 8;
    for (let j = 0; j < len; j++) {
      printChar(fd, HEAPU8[ptr + j]);
    }
    num += len;
  }
  HEAPU32[pnum >> 2] = num;
  return 0;
};

export const emscriptenDateNow = () => Date.now();

export const emscriptenMemcpyBig = (dest: number, src: number, num: number) => {
  dest >>>= 0;
  src >>>= 0;
  num >>>= 0;
  return HEAPU8.copyWithin(dest >>> 0, src >>> 0, (src + num) >>> 0);
};
const getHeapMax = () => 4294901760;
const growMemory = (size: number): number => {
  const b = wasmMemory.buffer;
  const pages = (size - b.byteLength + 65535) >>> 16;
  try {
    wasmMemory.grow(pages);
    updateMemoryViews();
    return 1;
  } catch (e) {
    return 0;
  }
};
export const emscriptenResizeHeap = (requestedSize: number) => {
  requestedSize >>>= 0;
  const oldSize = HEAPU8.length;
  const maxHeapSize = getHeapMax();
  if (requestedSize > maxHeapSize) {
    return false;
  }
  const alignUp = (x: number, multiple: number) =>
    x + ((multiple - (x % multiple)) % multiple);
  for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
    let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    const newSize = Math.min(
      maxHeapSize,
      alignUp(Math.max(requestedSize, overGrownHeapSize), 65536)
    );
    const replacement = growMemory(newSize);
    if (replacement) {
      return true;
    }
  }
  return false;
};
