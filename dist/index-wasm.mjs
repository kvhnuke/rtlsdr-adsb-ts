import {
  rtl2832u_default
} from "./chunk-V3U7PJ6R.mjs";

// src/index-wasm.ts
import { createServer } from "net";
import { readFileSync } from "fs";
import { getDeviceList, WebUSBDevice } from "usb";
var wasmMemory;
var HEAPU8;
var updateMemoryViews = () => {
  const b = wasmMemory.buffer;
  HEAPU8 = new Uint8Array(b);
};
var emscriptenDateNow = () => Date.now();
var emscriptenMemcpyBig = (dest, src, num) => {
  dest >>>= 0;
  src >>>= 0;
  num >>>= 0;
  return HEAPU8.copyWithin(dest >>> 0, src >>> 0, src + num >>> 0);
};
var getHeapMax = () => 4294901760;
var growMemory = (size) => {
  const b = wasmMemory.buffer;
  const pages = size - b.byteLength + 65535 >>> 16;
  try {
    wasmMemory.grow(pages);
    updateMemoryViews();
    return 1;
  } catch (e) {
    return 0;
  }
};
var emscriptenResizeHeap = (requestedSize) => {
  requestedSize >>>= 0;
  const oldSize = HEAPU8.length;
  const maxHeapSize = getHeapMax();
  if (requestedSize > maxHeapSize) {
    return false;
  }
  const alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
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
var VENDOR_ID = 3034;
var PRODUCT_ID = 10296;
var socket = null;
var server = createServer((_socket) => {
  socket = _socket;
});
server.listen(30002, "127.0.0.1");
var getWebUSBSDR = () => {
  const devices = getDeviceList();
  for (const dev of devices) {
    if (dev.deviceDescriptor.idVendor === VENDOR_ID && dev.deviceDescriptor.idProduct === PRODUCT_ID) {
      dev.open();
      dev.interfaces.forEach((i) => {
        if (i.isKernelDriverActive())
          i.detachKernelDriver();
      });
      return WebUSBDevice.createInstance(dev);
    }
  }
  throw new Error("RTL-SDR: No devices found");
};
getWebUSBSDR().then(async (device) => {
  await device.open();
  const sdr = new rtl2832u_default(device, 0.5);
  await sdr.open();
  const actualSampleRate = await sdr.setSampleRate(2e6);
  const actualCenterFrequency = await sdr.setCenterFrequency(109e7);
  console.log("SR", actualSampleRate, "CF", actualCenterFrequency);
  const wasmBuffer = readFileSync("src/wasm-build/demodulator.wasm");
  const wasmImports = {
    emscripten_date_now: emscriptenDateNow,
    emscripten_memcpy_big: emscriptenMemcpyBig,
    emscripten_resize_heap: emscriptenResizeHeap,
    emscripten_notify_memory_growth: (val) => console.log("growing", val),
    fd_write: (...val) => console.log("here", val)
  };
  const env = {
    callback: (val, len) => {
      const values = new Uint8Array(wasmMemory.buffer);
      const msg = Buffer.from(values.slice(val, val + len)).toString("hex");
      console.log(`${msg};`);
      if (socket) {
        socket.write(`*${msg};
\r`);
      }
    },
    ...wasmImports
  };
  const { _demodulate, _malloc } = await WebAssembly.instantiate(wasmBuffer, {
    env,
    wasi_snapshot_preview1: wasmImports
  }).then((result) => {
    const { Demodulate, memory, malloc, free } = result.instance.exports;
    wasmMemory = memory;
    updateMemoryViews();
    return {
      _demodulate: Demodulate,
      _malloc: malloc,
      _free: free
    };
  });
  await sdr.resetBuffer();
  let readSamples = true;
  while (readSamples) {
    const samples = await sdr.readSamples(128e3);
    const heapPointer = _malloc(samples.byteLength);
    const array = new Uint8Array(
      wasmMemory.buffer,
      heapPointer,
      samples.byteLength
    );
    array.set(Buffer.from(samples));
    _demodulate(array.byteOffset, samples.byteLength);
  }
  readSamples = false;
});
