import { WebUSBDevice } from "usb";
import RtlCom from "./rtlcom";
import R820T from "./r820t";

class RTL2832U {
  /**
   * Frequency of the oscillator crystal.
   */
  XTAL_FREQ = 28800000;

  /**
   * Tuner intermediate frequency.
   */
  IF_FREQ = 3570000;

  /**
   * The number of bytes for each sample.
   */
  BYTES_PER_SAMPLE = 2;

  /**
   * Communications with the demodulator via USB.
   */
  com: RtlCom;

  /**
   * The tuner used by the dongle.
   */
  tuner: R820T;

  ppm: number;

  optGain: number | null;

  /**
   * Operations on the RTL2832U demodulator.
   * @param {ConnectionHandle} conn The USB connection handle.
   * @param {number} ppm The frequency correction factor, in parts per million.
   * @param {number=} opt_gain The optional gain in dB. If unspecified or null, sets auto gain.
   * @constructor
   */
  constructor(conn: WebUSBDevice, ppm: number, optGain: number = null) {
    this.com = new RtlCom(conn);
    this.ppm = ppm;
    this.optGain = optGain;
  }

  /**
   * Initialize the demodulator.
   */
  async open() {
    await this.com.writeEach([
      [RtlCom.CMD.REG, RtlCom.BLOCK.USB, RtlCom.REG.SYSCTL, 0x09, 1],
      [RtlCom.CMD.REG, RtlCom.BLOCK.USB, RtlCom.REG.EPA_MAXPKT, 0x0200, 2],
      [RtlCom.CMD.REG, RtlCom.BLOCK.USB, RtlCom.REG.EPA_CTL, 0x0210, 2],
    ]);
    await this.com.claimInterface();
    await this.com.writeEach([
      [RtlCom.CMD.REG, RtlCom.BLOCK.SYS, RtlCom.REG.DEMOD_CTL_1, 0x22, 1],
      [RtlCom.CMD.REG, RtlCom.BLOCK.SYS, RtlCom.REG.DEMOD_CTL, 0xe8, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x01, 0x14, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x01, 0x10, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x15, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x16, 0x0000, 2],
      [RtlCom.CMD.DEMODREG, 1, 0x16, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x17, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x18, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x19, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1a, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1b, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1c, 0xca, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1d, 0xdc, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1e, 0xd7, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1f, 0xd8, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x20, 0xe0, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x21, 0xf2, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x22, 0x0e, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x23, 0x35, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x24, 0x06, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x25, 0x50, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x26, 0x9c, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x27, 0x0d, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x28, 0x71, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x29, 0x11, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2a, 0x14, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2b, 0x71, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2c, 0x74, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2d, 0x19, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2e, 0x41, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x2f, 0xa5, 1],
      [RtlCom.CMD.DEMODREG, 0, 0x19, 0x05, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x93, 0xf0, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x94, 0x0f, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x11, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x04, 0x00, 1],
      [RtlCom.CMD.DEMODREG, 0, 0x61, 0x60, 1],
      [RtlCom.CMD.DEMODREG, 0, 0x06, 0x80, 1],
      [RtlCom.CMD.DEMODREG, 1, 0xb1, 0x1b, 1],
      [RtlCom.CMD.DEMODREG, 0, 0x0d, 0x83, 1],
    ]);

    const xtalFreq = Math.floor(this.XTAL_FREQ * (1 + this.ppm / 1000000));
    await this.com.openI2C();
    const found = await R820T.check(this.com);
    if (found) {
      this.tuner = new R820T(this.com, xtalFreq);
    }
    if (!this.tuner) {
      throw new Error(
        "Sorry, your USB dongle has an unsupported tuner chip. " +
          "Only the R820T chip is supported."
      );
    }
    const multiplier = -1 * Math.floor((this.IF_FREQ * (1 << 22)) / xtalFreq);
    await this.com.writeEach([
      [RtlCom.CMD.DEMODREG, 1, 0xb1, 0x1a, 1],
      [RtlCom.CMD.DEMODREG, 0, 0x08, 0x4d, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x19, (multiplier >> 16) & 0x3f, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1a, (multiplier >> 8) & 0xff, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x1b, multiplier & 0xff, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x15, 0x01, 1],
    ]);
    await this.tuner.init();
    await this.setGain(this.optGain);
    await this.com.closeI2C();
  }

  /**
   * Sets the requested gain.
   * @param {number|null|undefined} gain The gain in dB, or null/undefined
   *     for automatic gain.
   */
  async setGain(gain: number | null) {
    if (gain == null) {
      await this.tuner.setAutoGain();
    } else {
      await this.tuner.setManualGain(gain);
    }
  }

  /**
   * Set the sample rate.
   * @param {number} rate The sample rate, in samples/sec.
   * @return {number} The sample rate that was actually set as its first parameter.
   */
  async setSampleRate(rate: number) {
    let ratio = Math.floor((this.XTAL_FREQ * (1 << 22)) / rate);
    ratio &= 0x0ffffffc;
    const realRate = Math.floor((this.XTAL_FREQ * (1 << 22)) / ratio);
    const ppmOffset = -1 * Math.floor((this.ppm * (1 << 24)) / 1000000);
    await this.com.writeEach([
      [RtlCom.CMD.DEMODREG, 1, 0x9f, (ratio >> 16) & 0xffff, 2],
      [RtlCom.CMD.DEMODREG, 1, 0xa1, ratio & 0xffff, 2],
      [RtlCom.CMD.DEMODREG, 1, 0x3e, (ppmOffset >> 8) & 0x3f, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x3f, ppmOffset & 0xff, 1],
    ]);
    await this.resetDemodulator();
    return realRate;
  }

  /**
   * Resets the demodulator.
   */
  async resetDemodulator() {
    await this.com.writeEach([
      [RtlCom.CMD.DEMODREG, 1, 0x01, 0x14, 1],
      [RtlCom.CMD.DEMODREG, 1, 0x01, 0x10, 1],
    ]);
  }

  /**
   * Tunes the device to the given frequency.
   * @param {number} freq The frequency to tune to, in Hertz.
   * @return {number} The actual tuned frequency.
   */
  async setCenterFrequency(freq: number) {
    await this.com.openI2C();
    const actualFreq = await this.tuner.setFrequency(freq + this.IF_FREQ);
    await this.com.closeI2C();
    return actualFreq - this.IF_FREQ;
  }

  /**
   * Resets the sample buffer. Call this before starting to read samples.
   */
  async resetBuffer() {
    await this.com.writeEach([
      [RtlCom.CMD.REG, RtlCom.BLOCK.USB, RtlCom.REG.EPA_CTL, 0x0210, 2],
      [RtlCom.CMD.REG, RtlCom.BLOCK.USB, RtlCom.REG.EPA_CTL, 0x0000, 2],
    ]);
  }

  /**
   * Reads a block of samples off the device.
   * @param {number} length The number of samples to read.
   * @return {ArrayBuffer} An ArrayBuffer containing the read samples, which you
   *     can interpret as pairs of unsigned 8-bit integers; the first one is
   *     the sample's I value, and the second one is its Q value.
   */
  async readSamples(length: number) {
    return this.com.readBulk(length * this.BYTES_PER_SAMPLE);
  }

  /**
   * Stops the demodulator.
   */
  async close() {
    await this.com.openI2C();
    await this.tuner.close();
    await this.com.closeI2C();
    await this.com.releaseInterface();
  }
}

export default RTL2832U;
