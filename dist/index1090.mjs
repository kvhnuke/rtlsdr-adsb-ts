import {
  wasm_helper_default
} from "./chunk-AESVSTEE.mjs";
import {
  rtl2832u_default
} from "./chunk-V3U7PJ6R.mjs";

// src/index1090.ts
import { createServer } from "net";
import { getDeviceList, WebUSBDevice } from "usb";
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
  const wasmHelper = new wasm_helper_default(
    "src/wasm-build/demod1090.wasm",
    ["demodulate", "malloc", "free"],
    134217728
  );
  const env = {
    callback: (val, len) => {
      const values = new Uint8Array(wasmHelper.memory.buffer);
      const msg = Buffer.from(values.slice(val, val + len)).toString("hex");
      console.log(`${msg};`);
      if (socket) {
        socket.write(`*${msg};
\r`);
      }
    }
  };
  const { demodulate, malloc, free } = await wasmHelper.init(env);
  await sdr.resetBuffer();
  let readSamples = true;
  while (readSamples) {
    const samples = await sdr.readSamples(128e3);
    const heapPointer = malloc(samples.byteLength);
    const array = new Uint8Array(
      wasmHelper.memory.buffer,
      heapPointer,
      samples.byteLength
    );
    array.set(Buffer.from(samples));
    demodulate(
      array.byteOffset,
      samples.byteLength
    );
    free(heapPointer);
  }
  readSamples = false;
});
