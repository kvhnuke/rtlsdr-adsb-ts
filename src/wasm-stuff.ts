let wasmMemory: WebAssembly.Memory;
// const Module: any = {};

// let HEAP8: Int8Array;
let HEAPU8: Uint8Array;
// let HEAP16: Int16Array;
// let HEAPU16: Uint16Array;
// let HEAP32: Int32Array;
// let HEAPU32: Uint32Array;
// let HEAPF32: Float32Array;
// let HEAPF64: Float64Array;

const updateMemoryViews = () => {
  const b = wasmMemory.buffer;
  HEAPU8 = new Uint8Array(b);
  //   Module.HEAP8 = HEAP8 = new Int8Array(b);
  //   Module.HEAP16 = HEAP16 = new Int16Array(b);
  //   Module.HEAP32 = HEAP32 = new Int32Array(b);
  //   Module.HEAPU8 = HEAPU8 = new Uint8Array(b);
  //   Module.HEAPU16 = HEAPU16 = new Uint16Array(b);
  //   Module.HEAPU32 = HEAPU32 = new Uint32Array(b);
  //   Module.HEAPF32 = HEAPF32 = new Float32Array(b);
  //   Module.HEAPF64 = HEAPF64 = new Float64Array(b);
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
