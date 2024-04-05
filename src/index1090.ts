/* eslint-disable no-loop-func */
import { createServer, Socket } from "net";
import { usb, getDeviceList, WebUSBDevice } from "usb";
import RTL2832U from "./rtl2832u";
import WasmHelper from "./wasm-helper";
const Decoder = require("mode-s-decoder");
const decoder = new Decoder();

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
  const sdr = new RTL2832U(device, 45);
  await sdr.open();
  const actualSampleRate = await sdr.setSampleRate(2000000);
  const actualCenterFrequency = await sdr.setCenterFrequency(1090000000);
  console.log("SR", actualSampleRate, "CF", actualCenterFrequency);

  const wasmHelper = new WasmHelper(
    "src/wasm-build/demod1090.wasm",
    ["demodulate", "malloc", "free"],
    134217728
  );

  const env = {
    callback: (val: number, len: number) => {
      const values = new Uint8Array(wasmHelper.memory.buffer);
      const msg = Buffer.from(values.slice(val, val + len));
      console.log(`${msg.toString("hex")};`);
      const message = decoder.parse(msg);
      console.log(message.icao.toString(16), message.callsign);
      if (socket) {
        socket.write(`*${msg.toString("hex")};\n\r`);
      }
    },
  };
  const { demodulate, malloc, free } = await wasmHelper.init(env);

  await sdr.resetBuffer();
  let readSamples = true;

  while (readSamples) {
    const samples = await sdr.readSamples(1024);
    const heapPointer = (malloc as (ptr: number) => number)(samples.byteLength);
    const array = new Uint8Array(
      wasmHelper.memory.buffer,
      heapPointer,
      samples.byteLength
    );
    array.set(Buffer.from(samples));
    (demodulate as (offset: number, len: number) => void)(
      array.byteOffset,
      samples.byteLength
    );
    (free as (ptr: number) => void)(heapPointer);
  }
  readSamples = false;
});
