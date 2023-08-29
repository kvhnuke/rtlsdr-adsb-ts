import {
  __require,
  rtl2832u_default
} from "./chunk-V3U7PJ6R.mjs";

// src/index.ts
import { createServer } from "net";
import { getDeviceList, WebUSBDevice } from "usb";
var addon = __require("bindings")("demodulator.node");
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
  await sdr.resetBuffer();
  let readSamples = true;
  while (readSamples) {
    const samples = await sdr.readSamples(128e3);
    addon.Demodulate(
      Buffer.from(samples),
      samples.byteLength,
      (msg) => {
        console.log(`${msg.toString("hex")};`);
        if (socket) {
          socket.write(`*${msg.toString("hex").toUpperCase()};
\r`);
        }
      }
    );
  }
  readSamples = false;
});
