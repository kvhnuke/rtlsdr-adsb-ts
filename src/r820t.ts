import RtlCom from "./rtlcom";

class R820T {
  /**
   * Initial values for registers 0x05-0x1f.
   */
  REGISTERS = [
    0x83, 0x32, 0x75, 0xc0, 0x40, 0xd6, 0x6c, 0xf5, 0x63, 0x75, 0x68, 0x6c,
    0x83, 0x80, 0x00, 0x0f, 0x00, 0xc0, 0x30, 0x48, 0xcc, 0x60, 0x00, 0x54,
    0xae, 0x4a, 0xc0,
  ];

  /**
   * Configurations for the multiplexer in different frequency bands.
   */
  MUX_CFGS = [
    [0, 0x08, 0x02, 0xdf],
    [50, 0x08, 0x02, 0xbe],
    [55, 0x08, 0x02, 0x8b],
    [60, 0x08, 0x02, 0x7b],
    [65, 0x08, 0x02, 0x69],
    [70, 0x08, 0x02, 0x58],
    [75, 0x00, 0x02, 0x44],
    [90, 0x00, 0x02, 0x34],
    [110, 0x00, 0x02, 0x24],
    [140, 0x00, 0x02, 0x14],
    [180, 0x00, 0x02, 0x13],
    [250, 0x00, 0x02, 0x11],
    [280, 0x00, 0x02, 0x00],
    [310, 0x00, 0x41, 0x00],
    [588, 0x00, 0x40, 0x00],
  ];

  /**
   * A bit mask to reverse the bits in a byte.
   */
  BIT_REVS = [
    0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7,
    0xf,
  ];

  /**
   * Whether the PLL in the tuner is locked.
   */
  hasPllLock = false;

  /**
   * Shadow registers 0x05-0x1f, for setting values using masks.
   */
  shadowRegs: Uint8Array;

  com: RtlCom;

  xtalFreq: number;

  /**
   * Operations on the R820T tuner chip.
   * @param {RtlCom} com The RTL communications object.
   * @param {number} xtalFreq The frequency of the oscillator crystal.
   * @constructor
   */
  constructor(com: RtlCom, xtalFreq: number) {
    this.com = com;
    this.xtalFreq = xtalFreq;
  }

  /**
   * Initializes the tuner.
   */
  async init() {
    await this.initRegisters(this.REGISTERS);
    await this.initElectronics();
  }

  /**
   * Sets the tuner's frequency.
   * @param {number} freq The frequency to tune to.
   * @return {number} The actual tuned frequency.
   */
  async setFrequency(freq: number) {
    await this.setMux(freq);
    return this.setPll(freq);
  }

  /**
   * Stops the tuner.
   */
  async close() {
    return this.writeEach([
      [0x06, 0xb1, 0xff],
      [0x05, 0xb3, 0xff],
      [0x07, 0x3a, 0xff],
      [0x08, 0x40, 0xff],
      [0x09, 0xc0, 0xff],
      [0x0a, 0x36, 0xff],
      [0x0c, 0x35, 0xff],
      [0x0f, 0x68, 0xff],
      [0x11, 0x03, 0xff],
      [0x17, 0xf4, 0xff],
      [0x19, 0x0c, 0xff],
    ]);
  }

  /**
   * Initializes all the components of the tuner.
   */
  async initElectronics() {
    await this.writeEach([
      [0x0c, 0x00, 0x0f],
      [0x13, 49, 0x3f],
      [0x1d, 0x00, 0x38],
    ]);
    const filterCap = await this.calibrateFilter(true);
    await this.writeEach([
      [0x0a, 0x10 | filterCap, 0x1f],
      [0x0b, 0x6b, 0xef],
      [0x07, 0x00, 0x80],
      [0x06, 0x10, 0x30],
      [0x1e, 0x40, 0x60],
      [0x05, 0x00, 0x80],
      [0x1f, 0x00, 0x80],
      [0x0f, 0x00, 0x80],
      [0x19, 0x60, 0x60],
      [0x1d, 0xe5, 0xc7],
      [0x1c, 0x24, 0xf8],
      [0x0d, 0x53, 0xff],
      [0x0e, 0x75, 0xff],
      [0x05, 0x00, 0x60],
      [0x06, 0x00, 0x08],
      [0x11, 0x38, 0x08],
      [0x17, 0x30, 0x30],
      [0x0a, 0x40, 0x60],
      [0x1d, 0x00, 0x38],
      [0x1c, 0x00, 0x04],
      [0x06, 0x00, 0x40],
      [0x1a, 0x30, 0x30],
      [0x1d, 0x18, 0x38],
      [0x1c, 0x24, 0x04],
      [0x1e, 0x0d, 0x1f],
      [0x1a, 0x20, 0x30],
    ]);
  }

  /**
   * Sets the tuner to automatic gain.
   */
  async setAutoGain() {
    return this.writeEach([
      [0x05, 0x00, 0x10],
      [0x07, 0x10, 0x10],
      [0x0c, 0x0b, 0x9f],
    ]);
  }

  /**
   * Sets the tuner's manual gain.
   * @param {number} gain The tuner's gain, in dB.
   */
  async setManualGain(gain: number) {
    let step = 0;
    if (gain <= 15) {
      step = Math.round(
        1.36 + gain * (1.1118 + gain * (-0.0786 + gain * 0.0027))
      );
    } else {
      step = Math.round(
        1.2068 + gain * (0.6875 + gain * (-0.01011 + gain * 0.0001587))
      );
    }
    if (step < 0) {
      step = 0;
    } else if (step > 30) {
      step = 30;
    }
    const lnaValue = Math.floor(step / 2);
    const mixerValue = Math.floor((step - 1) / 2);
    return this.writeEach([
      [0x05, 0x10, 0x10],
      [0x07, 0x00, 0x10],
      [0x0c, 0x08, 0x9f],
      [0x05, lnaValue, 0x0f],
      [0x07, mixerValue, 0x0f],
    ]);
  }

  /**
   * Calibrates the filters.
   * @param {boolean} firstTry Whether this is the first try to calibrate.
   */
  async calibrateFilter(firstTry: boolean) {
    await this.writeEach([
      [0x0b, 0x6b, 0x60],
      [0x0f, 0x04, 0x04],
      [0x10, 0x00, 0x03],
    ]);
    await this.setPll(56000000);
    if (!this.hasPllLock) {
      throw new Error(
        "PLL not locked -- cannot tune to the selected frequency."
      );
    }
    await this.writeEach([
      [0x0b, 0x10, 0x10],
      [0x0b, 0x00, 0x10],
      [0x0f, 0x00, 0x04],
    ]);
    const data = await this.readRegBuffer(0x00, 5);
    const arr = new Uint8Array(data);
    let filterCap = arr[4] & 0x0f;
    if (filterCap === 0x0f) {
      filterCap = 0;
    }
    if (filterCap !== 0 && firstTry) {
      return this.calibrateFilter(false);
    }
    return filterCap;
  }

  /**
   * Sets the multiplexer's frequency.
   * @param {number} freq The frequency to set.
   */
  async setMux(freq) {
    const freqMhz = freq / 1000000;
    let i = 0;
    for (; i < this.MUX_CFGS.length - 1; ++i) {
      if (freqMhz < this.MUX_CFGS[i + 1][0]) {
        break;
      }
    }
    const cfg = this.MUX_CFGS[i];
    await this.writeEach([
      [0x17, cfg[1], 0x08],
      [0x1a, cfg[2], 0xc3],
      [0x1b, cfg[3], 0xff],
      [0x10, 0x00, 0x0b],
      [0x08, 0x00, 0x3f],
      [0x09, 0x00, 0x3f],
    ]);
  }

  /**
   * Sets the PLL's frequency.
   * @param {number} freq The frequency to set.
   */
  async setPll(freq): Promise<number> {
    const pllRef = Math.floor(this.xtalFreq);
    await this.writeEach([
      [0x10, 0x00, 0x10],
      [0x1a, 0x00, 0x0c],
      [0x12, 0x80, 0xe0],
    ]);
    let divNum = Math.min(
      6,
      Math.floor(Math.log(1770000000 / freq) / Math.LN2)
    );
    const mixDiv = 1 << (divNum + 1);
    const data = await this.readRegBuffer(0x00, 5);
    const arr = new Uint8Array(data);
    const vcoFineTune = (arr[4] & 0x30) >> 4;
    if (vcoFineTune > 2) {
      --divNum;
    } else if (vcoFineTune < 2) {
      ++divNum;
    }
    await this.writeRegMask(0x10, divNum << 5, 0xe0);
    const vcoFreq = freq * mixDiv;
    const nint = Math.floor(vcoFreq / (2 * pllRef));
    const vcoFra = vcoFreq % (2 * pllRef);
    if (nint > 63) {
      this.hasPllLock = false;
      return 0;
    }
    const ni = Math.floor((nint - 13) / 4);
    const si = (nint - 13) % 4;
    await this.writeEach([
      [0x14, ni + (si << 6), 0xff],
      [0x12, vcoFra === 0 ? 0x08 : 0x00, 0x08],
    ]);
    const sdm = Math.min(65535, Math.floor((32768 * vcoFra) / pllRef));
    await this.writeEach([
      [0x16, sdm >> 8, 0xff],
      [0x15, sdm & 0xff, 0xff],
    ]);
    await this.getPllLock(true);
    await this.writeRegMask(0x1a, 0x08, 0x08);
    const actualFreq = (2 * pllRef * (nint + sdm / 65536)) / mixDiv;
    return actualFreq;
  }

  /**
   * Checks whether the PLL has achieved lock.
   * @param {boolean} firstTry Whether this is the first try to achieve lock.
   */
  async getPllLock(firstTry: boolean) {
    const data = await this.readRegBuffer(0x00, 3);
    const arr = new Uint8Array(data);
    if (arr[2] & 0x40) {
      this.hasPllLock = true;
      return this.hasPllLock;
    }
    if (firstTry) {
      await this.writeRegMask(0x12, 0x60, 0xe0);
      return this.getPllLock(false);
    }
    this.hasPllLock = false;
    return this.hasPllLock;
  }

  /**
   * Sets the initial values of the 0x05-0x1f registers.
   * @param {Array.<number>} regs The values for the registers.
   */
  initRegisters(regs) {
    this.shadowRegs = new Uint8Array(regs);
    const cmds = [];
    for (let i = 0; i < regs.length; ++i) {
      cmds.push([RtlCom.CMD.I2CREG, 0x34, i + 5, regs[i]]);
    }
    return this.com.writeEach(cmds);
  }

  /**
   * Reads a series of registers into a buffer.
   * @param {number} addr The first register's address to read.
   * @param {number} length The number of registers to read.
   * @return {ArrayBuffer} An ArrayBuffer with the data.
   */
  async readRegBuffer(addr: number, length: number) {
    const data = await this.com.readI2CRegBuffer(0x34, addr, length);
    const buf = new Uint8Array(data);
    for (let i = 0; i < buf.length; ++i) {
      const b = buf[i];
      buf[i] = (this.BIT_REVS[b & 0xf] << 4) | this.BIT_REVS[b >> 4];
    }
    return buf.buffer;
  }

  /**
   * Writes a masked value into a register.
   * @param {number} addr The address of the register to write into.
   * @param {number} value The value to write.
   * @param {number} mask A mask that specifies which bits to write.
   */
  async writeRegMask(addr: number, value: number, mask: number) {
    const rc = this.shadowRegs[addr - 5];
    const val = (rc & ~mask) | (value & mask);
    this.shadowRegs[addr - 5] = val;
    return this.com.writeI2CReg(0x34, addr, val);
  }

  /**
   * Perform the write operations given in the array.
   * @param {Array.<Array.<number>>} array The operations.
   */
  async writeEach(array: Array<number[]>) {
    for (let index = 0; index < array.length; index++) {
      const line = array[index];
      await this.writeRegMask(line[0], line[1], line[2]);
    }
  }

  /**
   * Checks if the R820T tuner is present.
   * @param {RtlCom} com The RTL communications object.
   * @return {boolean} A boolean that tells whether the tuner is present.
   */
  static async check(com) {
    const data = await com.readI2CReg(0x34, 0);
    return data === 0x69;
  }
}

export default R820T;
