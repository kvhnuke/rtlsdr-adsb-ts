// src/index1090.ts
var import_net = require("net");
var import_usb = require("usb");

// src/rtlcom.ts
var VERBOSE = false;
var _RtlCom = class {
  constructor(dev) {
    this.VERBOSE = false;
    this.WRITE_FLAG = 16;
    this.conn = dev;
  }
  async writeRegBuffer(block, reg, buffer) {
    return this.writeCtrlMsg(reg, block | this.WRITE_FLAG, buffer);
  }
  readRegBuffer(block, reg, length) {
    return this.readCtrlMsg(reg, block, length);
  }
  async writeReg(block, reg, value, length) {
    return this.writeCtrlMsg(
      reg,
      block | this.WRITE_FLAG,
      _RtlCom.numberToBuffer(value, length)
    );
  }
  async readReg(block, reg, length) {
    return _RtlCom.bufferToNumber(await this.readCtrlMsg(reg, block, length));
  }
  async writeRegMask(block, reg, value, mask) {
    if (mask === 255) {
      await this.writeReg(block, reg, value, 1);
    } else {
      let old = await this.readReg(block, reg, 1);
      value &= mask;
      old &= ~mask;
      value |= old;
      await this.writeReg(block, reg, value, 1);
    }
  }
  readDemodReg(page, addr) {
    return this.readReg(page, addr << 8 | 32, 1);
  }
  async writeDemodReg(page, addr, value, len) {
    await this.writeRegBuffer(
      page,
      addr << 8 | 32,
      _RtlCom.numberToBuffer(value, len, true)
    );
    return this.readDemodReg(10, 1);
  }
  openI2C() {
    return this.writeDemodReg(1, 1, 24, 1);
  }
  async closeI2C() {
    return this.writeDemodReg(1, 1, 16, 1);
  }
  async readI2CReg(addr, reg) {
    await this.writeRegBuffer(
      _RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg]).buffer
    );
    return this.readReg(_RtlCom.BLOCK.I2C, addr, 1);
  }
  async writeI2CReg(addr, reg, value) {
    await this.writeRegBuffer(
      _RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg, value]).buffer
    );
  }
  async readI2CRegBuffer(addr, reg, len) {
    await this.writeRegBuffer(
      _RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg]).buffer
    );
    return this.readRegBuffer(_RtlCom.BLOCK.I2C, addr, len);
  }
  writeI2CRegBuffer(addr, reg, buffer) {
    const data = new Uint8Array(buffer.byteLength + 1);
    data[0] = reg;
    data.set(new Uint8Array(buffer), 1);
    return this.writeRegBuffer(_RtlCom.BLOCK.I2C, addr, data.buffer);
  }
  async readCtrlMsg(value, index, length) {
    const ti = {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value,
      index
    };
    try {
      const data = await this.conn.controlTransferIn(ti, Math.max(8, length));
      const bufdata = data.data.buffer.slice(0, length);
      if (VERBOSE) {
        console.log(
          `IN value 0x${value.toString(16)} index 0x${index.toString(
            16
          )} read -> ${_RtlCom.dumpBuffer(bufdata)}`
        );
      }
      return bufdata;
    } catch (error) {
      throw new Error(
        `USB read failed (value 0x${value.toString(
          16
        )} index 0x${index.toString(16)}), message="${error.message}"`
      );
    }
  }
  async writeCtrlMsg(value, index, buffer) {
    const ti = {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value,
      index
    };
    try {
      await this.conn.controlTransferOut(ti, buffer);
      if (VERBOSE) {
        console.log(
          `OUT value 0x${value.toString(16)} index 0x${index.toString(
            16
          )} data ${_RtlCom.dumpBuffer(buffer)}`
        );
      }
    } catch (error) {
      throw new Error(
        `USB write failed (value 0x${value.toString(
          16
        )} index 0x${index.toString(16)} data ${_RtlCom.dumpBuffer(
          buffer
        )} message=${error.message}`
      );
    }
  }
  async readBulk(length) {
    try {
      const data = await this.conn.transferIn(1, length);
      if (VERBOSE) {
        console.log(
          `IN BULK requested ${length} received ${data.data.buffer.byteLength}`
        );
      }
      return data.data.buffer;
    } catch (error) {
      console.log(error);
      throw new Error(
        `USB bulk read failed (length 0x${length.toString(16)}), error=${error.message}`
      );
    }
  }
  async claimInterface() {
    return this.conn.claimInterface(0);
  }
  async releaseInterface() {
    return this.conn.releaseInterface(0);
  }
  async writeEach(array) {
    for (let index = 0; index < array.length; index++) {
      const line = array[index];
      if (line[0] === _RtlCom.CMD.REG) {
        await this.writeReg(line[1], line[2], line[3], line[4]);
      } else if (line[0] === _RtlCom.CMD.REGMASK) {
        await this.writeRegMask(line[1], line[2], line[3], line[4]);
      } else if (line[0] === _RtlCom.CMD.DEMODREG) {
        await this.writeDemodReg(line[1], line[2], line[3], line[4]);
      } else if (line[0] === _RtlCom.CMD.I2CREG) {
        await this.writeI2CReg(line[1], line[2], line[3]);
      } else {
        throw new Error(`Unsupported operation [${line}]`);
      }
    }
  }
  static dumpBuffer(buffer) {
    const bytes = [];
    const arr = new Uint8Array(buffer);
    for (let i = 0; i < arr.length; ++i) {
      bytes.push(`0x${arr[i].toString(16)}`);
    }
    return `[${bytes}]`;
  }
  static bufferToNumber(buffer) {
    const len = buffer.byteLength;
    const dv = new DataView(buffer);
    if (len === 0) {
      return null;
    }
    if (len === 1) {
      return dv.getUint8(0);
    }
    if (len === 2) {
      return dv.getUint16(0, true);
    }
    if (len === 4) {
      return dv.getUint32(0, true);
    }
    throw new Error(`Cannot parse ${len} byte number`);
  }
};
var RtlCom = _RtlCom;
RtlCom.CMD = {
  REG: 1,
  REGMASK: 2,
  DEMODREG: 3,
  I2CREG: 4
};
RtlCom.BLOCK = {
  DEMOD: 0,
  USB: 256,
  SYS: 512,
  I2C: 1536
};
RtlCom.REG = {
  SYSCTL: 8192,
  EPA_CTL: 8520,
  EPA_MAXPKT: 8536,
  DEMOD_CTL: 12288,
  DEMOD_CTL_1: 12299
};
RtlCom.numberToBuffer = (value, len, optBigEndian = false) => {
  const buffer = new ArrayBuffer(len);
  const dv = new DataView(buffer);
  if (len === 1) {
    dv.setUint8(0, value);
  } else if (len === 2) {
    dv.setUint16(0, value, !optBigEndian);
  } else if (len === 4) {
    dv.setUint32(0, value, !optBigEndian);
  } else {
    throw new Error(`Cannot write ${len}-byte number`);
  }
  return buffer;
};
var rtlcom_default = RtlCom;

// src/r820t.ts
var R820T = class {
  constructor(com, xtalFreq) {
    this.REGISTERS = [
      131,
      50,
      117,
      192,
      64,
      214,
      108,
      245,
      99,
      117,
      104,
      108,
      131,
      128,
      0,
      15,
      0,
      192,
      48,
      72,
      204,
      96,
      0,
      84,
      174,
      74,
      192
    ];
    this.MUX_CFGS = [
      [0, 8, 2, 223],
      [50, 8, 2, 190],
      [55, 8, 2, 139],
      [60, 8, 2, 123],
      [65, 8, 2, 105],
      [70, 8, 2, 88],
      [75, 0, 2, 68],
      [90, 0, 2, 52],
      [110, 0, 2, 36],
      [140, 0, 2, 20],
      [180, 0, 2, 19],
      [250, 0, 2, 17],
      [280, 0, 2, 0],
      [310, 0, 65, 0],
      [588, 0, 64, 0]
    ];
    this.BIT_REVS = [
      0,
      8,
      4,
      12,
      2,
      10,
      6,
      14,
      1,
      9,
      5,
      13,
      3,
      11,
      7,
      15
    ];
    this.hasPllLock = false;
    this.com = com;
    this.xtalFreq = xtalFreq;
  }
  async init() {
    await this.initRegisters(this.REGISTERS);
    await this.initElectronics();
  }
  async setFrequency(freq) {
    await this.setMux(freq);
    return this.setPll(freq);
  }
  async close() {
    return this.writeEach([
      [6, 177, 255],
      [5, 179, 255],
      [7, 58, 255],
      [8, 64, 255],
      [9, 192, 255],
      [10, 54, 255],
      [12, 53, 255],
      [15, 104, 255],
      [17, 3, 255],
      [23, 244, 255],
      [25, 12, 255]
    ]);
  }
  async initElectronics() {
    await this.writeEach([
      [12, 0, 15],
      [19, 49, 63],
      [29, 0, 56]
    ]);
    const filterCap = await this.calibrateFilter(true);
    await this.writeEach([
      [10, 16 | filterCap, 31],
      [11, 107, 239],
      [7, 0, 128],
      [6, 16, 48],
      [30, 64, 96],
      [5, 0, 128],
      [31, 0, 128],
      [15, 0, 128],
      [25, 96, 96],
      [29, 229, 199],
      [28, 36, 248],
      [13, 83, 255],
      [14, 117, 255],
      [5, 0, 96],
      [6, 0, 8],
      [17, 56, 8],
      [23, 48, 48],
      [10, 64, 96],
      [29, 0, 56],
      [28, 0, 4],
      [6, 0, 64],
      [26, 48, 48],
      [29, 24, 56],
      [28, 36, 4],
      [30, 13, 31],
      [26, 32, 48]
    ]);
  }
  async setAutoGain() {
    return this.writeEach([
      [5, 0, 16],
      [7, 16, 16],
      [12, 11, 159]
    ]);
  }
  async setManualGain(gain) {
    let step = 0;
    if (gain <= 15) {
      step = Math.round(
        1.36 + gain * (1.1118 + gain * (-0.0786 + gain * 27e-4))
      );
    } else {
      step = Math.round(
        1.2068 + gain * (0.6875 + gain * (-0.01011 + gain * 1587e-7))
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
      [5, 16, 16],
      [7, 0, 16],
      [12, 8, 159],
      [5, lnaValue, 15],
      [7, mixerValue, 15]
    ]);
  }
  async calibrateFilter(firstTry) {
    await this.writeEach([
      [11, 107, 96],
      [15, 4, 4],
      [16, 0, 3]
    ]);
    await this.setPll(56e6);
    if (!this.hasPllLock) {
      throw new Error(
        "PLL not locked -- cannot tune to the selected frequency."
      );
    }
    await this.writeEach([
      [11, 16, 16],
      [11, 0, 16],
      [15, 0, 4]
    ]);
    const data = await this.readRegBuffer(0, 5);
    const arr = new Uint8Array(data);
    let filterCap = arr[4] & 15;
    if (filterCap === 15) {
      filterCap = 0;
    }
    if (filterCap !== 0 && firstTry) {
      return this.calibrateFilter(false);
    }
    return filterCap;
  }
  async setMux(freq) {
    const freqMhz = freq / 1e6;
    let i = 0;
    for (; i < this.MUX_CFGS.length - 1; ++i) {
      if (freqMhz < this.MUX_CFGS[i + 1][0]) {
        break;
      }
    }
    const cfg = this.MUX_CFGS[i];
    await this.writeEach([
      [23, cfg[1], 8],
      [26, cfg[2], 195],
      [27, cfg[3], 255],
      [16, 0, 11],
      [8, 0, 63],
      [9, 0, 63]
    ]);
  }
  async setPll(freq) {
    const pllRef = Math.floor(this.xtalFreq);
    await this.writeEach([
      [16, 0, 16],
      [26, 0, 12],
      [18, 128, 224]
    ]);
    let divNum = Math.min(
      6,
      Math.floor(Math.log(177e7 / freq) / Math.LN2)
    );
    const mixDiv = 1 << divNum + 1;
    const data = await this.readRegBuffer(0, 5);
    const arr = new Uint8Array(data);
    const vcoFineTune = (arr[4] & 48) >> 4;
    if (vcoFineTune > 2) {
      --divNum;
    } else if (vcoFineTune < 2) {
      ++divNum;
    }
    await this.writeRegMask(16, divNum << 5, 224);
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
      [20, ni + (si << 6), 255],
      [18, vcoFra === 0 ? 8 : 0, 8]
    ]);
    const sdm = Math.min(65535, Math.floor(32768 * vcoFra / pllRef));
    await this.writeEach([
      [22, sdm >> 8, 255],
      [21, sdm & 255, 255]
    ]);
    await this.getPllLock(true);
    await this.writeRegMask(26, 8, 8);
    const actualFreq = 2 * pllRef * (nint + sdm / 65536) / mixDiv;
    return actualFreq;
  }
  async getPllLock(firstTry) {
    const data = await this.readRegBuffer(0, 3);
    const arr = new Uint8Array(data);
    if (arr[2] & 64) {
      this.hasPllLock = true;
      return this.hasPllLock;
    }
    if (firstTry) {
      await this.writeRegMask(18, 96, 224);
      return this.getPllLock(false);
    }
    this.hasPllLock = false;
    return this.hasPllLock;
  }
  initRegisters(regs) {
    this.shadowRegs = new Uint8Array(regs);
    const cmds = [];
    for (let i = 0; i < regs.length; ++i) {
      cmds.push([rtlcom_default.CMD.I2CREG, 52, i + 5, regs[i]]);
    }
    return this.com.writeEach(cmds);
  }
  async readRegBuffer(addr, length) {
    const data = await this.com.readI2CRegBuffer(52, addr, length);
    const buf = new Uint8Array(data);
    for (let i = 0; i < buf.length; ++i) {
      const b = buf[i];
      buf[i] = this.BIT_REVS[b & 15] << 4 | this.BIT_REVS[b >> 4];
    }
    return buf.buffer;
  }
  async writeRegMask(addr, value, mask) {
    const rc = this.shadowRegs[addr - 5];
    const val = rc & ~mask | value & mask;
    this.shadowRegs[addr - 5] = val;
    return this.com.writeI2CReg(52, addr, val);
  }
  async writeEach(array) {
    for (let index = 0; index < array.length; index++) {
      const line = array[index];
      await this.writeRegMask(line[0], line[1], line[2]);
    }
  }
  static async check(com) {
    const data = await com.readI2CReg(52, 0);
    return data === 105;
  }
};
var r820t_default = R820T;

// src/rtl2832u.ts
var RTL2832U = class {
  constructor(conn, ppm, optGain = null) {
    this.XTAL_FREQ = 288e5;
    this.IF_FREQ = 357e4;
    this.BYTES_PER_SAMPLE = 2;
    this.com = new rtlcom_default(conn);
    this.ppm = ppm;
    this.optGain = optGain;
  }
  async open() {
    await this.com.writeEach([
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.USB, rtlcom_default.REG.SYSCTL, 9, 1],
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.USB, rtlcom_default.REG.EPA_MAXPKT, 512, 2],
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.USB, rtlcom_default.REG.EPA_CTL, 528, 2]
    ]);
    await this.com.claimInterface();
    await this.com.writeEach([
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.SYS, rtlcom_default.REG.DEMOD_CTL_1, 34, 1],
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.SYS, rtlcom_default.REG.DEMOD_CTL, 232, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 1, 20, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 1, 16, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 21, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 22, 0, 2],
      [rtlcom_default.CMD.DEMODREG, 1, 22, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 23, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 24, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 25, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 26, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 27, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 28, 202, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 29, 220, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 30, 215, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 31, 216, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 32, 224, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 33, 242, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 34, 14, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 35, 53, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 36, 6, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 37, 80, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 38, 156, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 39, 13, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 40, 113, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 41, 17, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 42, 20, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 43, 113, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 44, 116, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 45, 25, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 46, 65, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 47, 165, 1],
      [rtlcom_default.CMD.DEMODREG, 0, 25, 5, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 147, 240, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 148, 15, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 17, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 4, 0, 1],
      [rtlcom_default.CMD.DEMODREG, 0, 97, 96, 1],
      [rtlcom_default.CMD.DEMODREG, 0, 6, 128, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 177, 27, 1],
      [rtlcom_default.CMD.DEMODREG, 0, 13, 131, 1]
    ]);
    const xtalFreq = Math.floor(this.XTAL_FREQ * (1 + this.ppm / 1e6));
    await this.com.openI2C();
    const found = await r820t_default.check(this.com);
    if (found) {
      this.tuner = new r820t_default(this.com, xtalFreq);
    }
    if (!this.tuner) {
      throw new Error(
        "Sorry, your USB dongle has an unsupported tuner chip. Only the R820T chip is supported."
      );
    }
    const multiplier = -1 * Math.floor(this.IF_FREQ * (1 << 22) / xtalFreq);
    await this.com.writeEach([
      [rtlcom_default.CMD.DEMODREG, 1, 177, 26, 1],
      [rtlcom_default.CMD.DEMODREG, 0, 8, 77, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 25, multiplier >> 16 & 63, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 26, multiplier >> 8 & 255, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 27, multiplier & 255, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 21, 1, 1]
    ]);
    await this.tuner.init();
    await this.setGain(this.optGain);
    await this.com.closeI2C();
  }
  async setGain(gain) {
    if (gain == null) {
      await this.tuner.setAutoGain();
    } else {
      await this.tuner.setManualGain(gain);
    }
  }
  async setSampleRate(rate) {
    let ratio = Math.floor(this.XTAL_FREQ * (1 << 22) / rate);
    ratio &= 268435452;
    const realRate = Math.floor(this.XTAL_FREQ * (1 << 22) / ratio);
    const ppmOffset = -1 * Math.floor(this.ppm * (1 << 24) / 1e6);
    await this.com.writeEach([
      [rtlcom_default.CMD.DEMODREG, 1, 159, ratio >> 16 & 65535, 2],
      [rtlcom_default.CMD.DEMODREG, 1, 161, ratio & 65535, 2],
      [rtlcom_default.CMD.DEMODREG, 1, 62, ppmOffset >> 8 & 63, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 63, ppmOffset & 255, 1]
    ]);
    await this.resetDemodulator();
    return realRate;
  }
  async resetDemodulator() {
    await this.com.writeEach([
      [rtlcom_default.CMD.DEMODREG, 1, 1, 20, 1],
      [rtlcom_default.CMD.DEMODREG, 1, 1, 16, 1]
    ]);
  }
  async setCenterFrequency(freq) {
    await this.com.openI2C();
    const actualFreq = await this.tuner.setFrequency(freq + this.IF_FREQ);
    await this.com.closeI2C();
    return actualFreq - this.IF_FREQ;
  }
  async resetBuffer() {
    await this.com.writeEach([
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.USB, rtlcom_default.REG.EPA_CTL, 528, 2],
      [rtlcom_default.CMD.REG, rtlcom_default.BLOCK.USB, rtlcom_default.REG.EPA_CTL, 0, 2]
    ]);
  }
  async readSamples(length) {
    return this.com.readBulk(length * this.BYTES_PER_SAMPLE);
  }
  async close() {
    await this.com.openI2C();
    await this.tuner.close();
    await this.com.closeI2C();
    await this.com.releaseInterface();
  }
};
var rtl2832u_default = RTL2832U;

// src/wasm-helper.ts
var import_fs = require("fs");
var _WasmHelper = class {
  constructor(path, exports, maxHeap) {
    this.UTF8Decoder = new TextDecoder("utf8");
    this.printCharBuffers = [null, [], []];
    this.getHeapMax = () => this.maxHeap;
    this.path = path;
    this.exports = exports;
    this.maxHeap = maxHeap;
  }
  updateMemoryViews() {
    const b = this.memory.buffer;
    this.HEAPU8 = new Uint8Array(b);
    this.HEAPU32 = new Uint32Array(b);
  }
  UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
    const endIdx = idx + maxBytesToRead;
    let endPtr = idx;
    while (heapOrArray[endPtr] && !(endPtr >= endIdx))
      ++endPtr;
    if (endPtr - idx > 16 && heapOrArray.buffer && this.UTF8Decoder) {
      return this.UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
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
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      const u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) === 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        const ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
    return str;
  }
  printChar(stream, curr) {
    const buffer = this.printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? console.log.bind(console) : console.error.bind(console))(
        this.UTF8ArrayToString(Buffer.from(buffer), 0)
      );
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  }
  fdWrite(fd, iov, iovcnt, pnum) {
    let num = 0;
    for (let i = 0; i < iovcnt; i++) {
      const ptr = this.HEAPU32[iov >> 2];
      const len = this.HEAPU32[iov + 4 >> 2];
      iov += 8;
      for (let j = 0; j < len; j++) {
        this.printChar(fd, this.HEAPU8[ptr + j]);
      }
      num += len;
    }
    this.HEAPU32[pnum >> 2] = num;
    return 0;
  }
  emscriptenMemcpyBig(dest, src, num) {
    dest >>>= 0;
    src >>>= 0;
    num >>>= 0;
    return this.HEAPU8.copyWithin(dest >>> 0, src >>> 0, src + num >>> 0);
  }
  growMemory(size) {
    const b = this.memory.buffer;
    const pages = size - b.byteLength + 65535 >>> 16;
    try {
      this.memory.grow(pages);
      this.updateMemoryViews();
      return 1;
    } catch (e) {
      return 0;
    }
  }
  emscriptenResizeHeap(requestedSize) {
    requestedSize >>>= 0;
    const oldSize = this.HEAPU8.length;
    const maxHeapSize = this.getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    const alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
    for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
      let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(
        overGrownHeapSize,
        requestedSize + 100663296
      );
      const newSize = Math.min(
        maxHeapSize,
        alignUp(Math.max(requestedSize, overGrownHeapSize), 65536)
      );
      const replacement = this.growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  }
  async init(additionalEnv) {
    const wasmBuffer = (0, import_fs.readFileSync)(this.path);
    const wasmImports = {
      emscripten_date_now: _WasmHelper.emscriptenDateNow,
      emscripten_memcpy_big: this.emscriptenMemcpyBig.bind(this),
      emscripten_resize_heap: this.emscriptenResizeHeap.bind(this),
      emscripten_notify_memory_growth: () => {
      },
      fd_write: this.fdWrite.bind(this)
    };
    const env = {
      ...wasmImports,
      ...additionalEnv
    };
    return WebAssembly.instantiate(wasmBuffer, {
      env,
      wasi_snapshot_preview1: wasmImports
    }).then((result) => {
      const allExports = result.instance.exports;
      this.memory = allExports.memory;
      this.updateMemoryViews();
      const retObj = {};
      this.exports.forEach((exp) => {
        retObj[exp] = allExports[exp];
      });
      return retObj;
    });
  }
};
var WasmHelper = _WasmHelper;
WasmHelper.emscriptenDateNow = () => Date.now();
var wasm_helper_default = WasmHelper;

// src/index1090.ts
var VENDOR_ID = 3034;
var PRODUCT_ID = 10296;
var socket = null;
var server = (0, import_net.createServer)((_socket) => {
  socket = _socket;
});
server.listen(30002, "127.0.0.1");
var getWebUSBSDR = () => {
  const devices = (0, import_usb.getDeviceList)();
  for (const dev of devices) {
    if (dev.deviceDescriptor.idVendor === VENDOR_ID && dev.deviceDescriptor.idProduct === PRODUCT_ID) {
      dev.open();
      dev.interfaces.forEach((i) => {
        if (i.isKernelDriverActive())
          i.detachKernelDriver();
      });
      return import_usb.WebUSBDevice.createInstance(dev);
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
