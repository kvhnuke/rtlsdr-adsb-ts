/* eslint-disable no-loop-func */
import { createServer, Socket } from "net";
import { readFileSync } from "fs";
import { usb, getDeviceList, WebUSBDevice } from "usb";
import RTL2832U from "./rtl2832u";

let wasmMemory: WebAssembly.Memory;
let HEAPU8: Uint8Array;
const updateMemoryViews = () => {
  const b = wasmMemory.buffer;
  HEAPU8 = new Uint8Array(b);
};
const emscriptenDateNow = () => Date.now();
const emscriptenMemcpyBig = (dest: number, src: number, num: number) => {
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
      console.log(dev.interfaces);
      if (dev.interfaces) {
        dev.interfaces.forEach((i) => {
          if (i.isKernelDriverActive()) i.detachKernelDriver();
        });
      }
      return WebUSBDevice.createInstance(dev);
    }
  }
  throw new Error("RTL-SDR: No devices found");
};

getWebUSBSDR().then(async (device) => {
  await device.open();
  const sdr = new RTL2832U(device, 0.5);
  await sdr.open();
  const actualSampleRate = await sdr.setSampleRate(2000000);
  const actualCenterFrequency = await sdr.setCenterFrequency(1090000000);
  console.log("SR", actualSampleRate, "CF", actualCenterFrequency);

  const wasmBuffer = readFileSync("src/wasm-build/demodulator.wasm");
  const wasmImports = {
    emscripten_date_now: emscriptenDateNow,
    emscripten_memcpy_big: emscriptenMemcpyBig,
    emscripten_resize_heap: emscriptenResizeHeap,
    emscripten_notify_memory_growth: (val) => console.log("growing", val),
    fd_write: (...val) => console.log("here", val),
  };
  const env = {
    callback: (val: number, len: number) => {
      const values = new Uint8Array(wasmMemory.buffer);
      const msg = Buffer.from(values.slice(val, val + len)).toString("hex");
      console.log(`${msg};`);
      if (socket) {
        socket.write(`*${msg};\n\r`);
      }
    },
    ...wasmImports,
  };
  const { _demodulate, _malloc } = await WebAssembly.instantiate(wasmBuffer, {
    env,
    wasi_snapshot_preview1: wasmImports,
  }).then((result) => {
    const { Demodulate, memory, malloc, free } = result.instance.exports;
    wasmMemory = memory as WebAssembly.Memory;
    updateMemoryViews();
    return {
      _demodulate: Demodulate,
      _malloc: malloc,
      _free: free,
    };
  });

  await sdr.resetBuffer();
  let readSamples = true;

  while (readSamples) {
    const samples = await sdr.readSamples(128000);
    const heapPointer = (_malloc as any)(samples.byteLength);
    const array = new Uint8Array(
      wasmMemory.buffer,
      heapPointer,
      samples.byteLength
    );
    array.set(Buffer.from(samples));
    (_demodulate as any)(array.byteOffset, samples.byteLength);
  }
  readSamples = false;
});
