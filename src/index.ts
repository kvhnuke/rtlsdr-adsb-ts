/* eslint-disable no-loop-func */
import { createServer, Socket } from "net";
import { usb, getDeviceList, WebUSBDevice } from "usb";
import RTL2832U from "./rtl2832u";

const addon = require("bindings")("demodulator.node");

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

  await sdr.resetBuffer();
  let readSamples = true;

  while (readSamples) {
    const samples = await sdr.readSamples(128000);
    addon.Demodulate(
      Buffer.from(samples),
      samples.byteLength,
      (msg: Buffer) => {
        console.log(`${msg.toString("hex")};`);
        if (socket) {
          socket.write(`*${msg.toString("hex").toUpperCase()};\n\r`);
        }
      }
    );
  }
  readSamples = false;
});
