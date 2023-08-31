/* eslint-disable no-loop-func */
// @ts-nocheck
import { createServer, Socket } from "net";
import { readFileSync } from "fs";
import { usb, getDeviceList, WebUSBDevice } from "usb";
import RTL2832U from "./rtl2832u";

let wasmMemory: WebAssembly.Memory;
let HEAPU8: Uint8Array;
let HEAPU32: Uint32Array;
const updateMemoryViews = () => {
  const b = wasmMemory.buffer;
  HEAPU8 = new Uint8Array(b);
  HEAPU32 = new Uint32Array(b);
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

const emscriptenDateNow = () => Date.now();
const emscriptenMemcpyBig = (dest: number, src: number, num: number) => {
  dest >>>= 0;
  src >>>= 0;
  num >>>= 0;
  return HEAPU8.copyWithin(dest >>> 0, src >>> 0, (src + num) >>> 0);
};
const getHeapMax = () => 134217728;
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
const emscriptenResizeHeap = (requestedSize: number) => {
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

const VENDOR_ID = 0x0bda;
const PRODUCT_ID = 0x2838;
let socket: Socket | null = null;
const server = createServer((_socket) => {
  socket = _socket;
});

server.listen(30002, "127.0.0.1");

const getWebUSBSDR = (): Promise<WebUSBDevice> => {
  const devices: usb.Device[] = getDeviceList();
  for (const dev of devices) {
    if (
      dev.deviceDescriptor.idVendor === VENDOR_ID &&
      dev.deviceDescriptor.idProduct === PRODUCT_ID
    ) {
      dev.open();
      dev.interfaces.forEach((i) => {
        if (i.isKernelDriverActive()) i.detachKernelDriver();
      });
      return WebUSBDevice.createInstance(dev);
    }
  }
  throw new Error("RTL-SDR: No devices found");
};

getWebUSBSDR().then(async (device) => {
  await device.open();
  const sdr = new RTL2832U(device, 48);
  await sdr.open();
  const actualSampleRate = await sdr.setSampleRate(2083334);
  const actualCenterFrequency = await sdr.setCenterFrequency(978000000);
  console.log("SR", actualSampleRate, "CF", actualCenterFrequency);

  const wasmBuffer = readFileSync("src/wasm-build/demod978.wasm");
  const wasmImports = {
    emscripten_date_now: emscriptenDateNow,
    emscripten_memcpy_big: emscriptenMemcpyBig,
    emscripten_resize_heap: emscriptenResizeHeap,
    emscripten_notify_memory_growth: (val) => console.log("growing", val),
    fd_write: fdWrite,
  };
  const env = {
    callback: (
      updown: string,
      bufptr: number,
      len: number,
      rsErrors: number
    ) => {
      const values = new Uint8Array(wasmMemory.buffer);
      const msg = Buffer.from(values.slice(bufptr, bufptr + len)).toString(
        "hex"
      );
      console.log(`${msg};`, updown, bufptr, len, rsErrors);
      if (socket) {
        socket.write(`*${updown};\n\r`);
      }
    },
    ...wasmImports,
  };
  const { _demodulate, _malloc, _init, _free } = await WebAssembly.instantiate(
    wasmBuffer,
    {
      env,
      wasi_snapshot_preview1: wasmImports,
    }
  ).then((result) => {
    const { demodulate, init, memory, malloc, free } = result.instance.exports;
    wasmMemory = memory as WebAssembly.Memory;
    updateMemoryViews();
    return {
      _demodulate: demodulate,
      _init: init,
      _malloc: malloc,
      _free: free,
    };
  });

  await sdr.resetBuffer();
  let readSamples = true;

  while (readSamples) {
    const samples = await sdr.readSamples(128000);
    // console.log("samples:", samples.byteLength);
    const heapPointer = (_malloc as any)(samples.byteLength);
    const array = new Uint8Array(
      wasmMemory.buffer,
      heapPointer,
      samples.byteLength
    );
    array.set(Buffer.from(samples));
    (_init as any)();
    (_demodulate as any)(array.byteOffset, samples.byteLength);
    _free(heapPointer);
  }
  readSamples = false;
});
