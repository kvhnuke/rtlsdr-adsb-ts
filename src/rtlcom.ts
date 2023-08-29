import { WebUSBDevice } from "usb";

const VERBOSE = false;
/**
 * Low-level communications with the RTL2832U-based dongle.
 * @param {ConnectionHandle} conn The USB connection handle.
 * @constructor
 */
class RtlCom {
  /**
   * Whether to log all USB transfers.
   */
  VERBOSE = false;

  /**
   * Set in the control messages' index field for write operations.
   */
  WRITE_FLAG = 0x10;

  conn: WebUSBDevice;

  constructor(dev: WebUSBDevice) {
    this.conn = dev;
  }

  /**
   * Writes a buffer into a dongle's register.
   * @param {number} block The register's block number.
   * @param {number} reg The register number.
   * @param {ArrayBuffer} buffer The buffer to write.
   */
  async writeRegBuffer(
    block: number,
    reg: number,
    buffer: ArrayBuffer
  ): Promise<void> {
    return this.writeCtrlMsg(reg, block | this.WRITE_FLAG, buffer);
  }

  /**
   * Reads a buffer from a dongle's register.
   * @param {number} block The register's block number.
   * @param {number} reg The register number.
   * @param {number} length The length in bytes of the buffer to read.
   * @return {ArrayBuffer} The read buffer.
   */
  readRegBuffer(
    block: number,
    reg: number,
    length: number
  ): Promise<ArrayBuffer> {
    return this.readCtrlMsg(reg, block, length);
  }

  /**
   * Writes a value into a dongle's register.
   * @param {number} block The register's block number.
   * @param {number} reg The register number.
   * @param {number} value The value to write.
   * @param {number} length The width in bytes of this value.
   */
  async writeReg(
    block: number,
    reg: number,
    value: number,
    length: number
  ): Promise<void> {
    return this.writeCtrlMsg(
      reg,
      block | this.WRITE_FLAG,
      RtlCom.numberToBuffer(value, length)
    );
  }

  /**
   * Reads a value from a dongle's register.
   * @param {number} block The register's block number.
   * @param {number} reg The register number.
   * @param {number} length The width in bytes of the value to read.
   * @return {number} The decoded value.
   */
  async readReg(block: number, reg: number, length: number): Promise<number> {
    return RtlCom.bufferToNumber(await this.readCtrlMsg(reg, block, length));
  }

  /**
   * Writes a masked value into a dongle's register.
   * @param {number} block The register's block number.
   * @param {number} reg The register number.
   * @param {number} value The value to write.
   * @param {number} mask The mask for the value to write.
   */
  async writeRegMask(
    block: number,
    reg: number,
    value: number,
    mask: number
  ): Promise<void> {
    if (mask === 0xff) {
      await this.writeReg(block, reg, value, 1);
    } else {
      let old = await this.readReg(block, reg, 1);
      value &= mask;
      old &= ~mask;
      value |= old;
      await this.writeReg(block, reg, value, 1);
    }
  }

  /**
   * Reads a value from a demodulator register.
   * @param {number} page The register page number.
   * @param {number} addr The register's address.
   * @return {number} The decoded value.
   */
  readDemodReg(page, addr): Promise<number> {
    return this.readReg(page, (addr << 8) | 0x20, 1);
  }

  /**
   * Writes a value into a demodulator register.
   * @param {number} page The register page number.
   * @param {number} addr The register's address.
   * @param {number} value The value to write.
   * @param {number} len The width in bytes of this value.
   */
  async writeDemodReg(
    page: number,
    addr: number,
    value: number,
    len: number
  ): Promise<number> {
    await this.writeRegBuffer(
      page,
      (addr << 8) | 0x20,
      RtlCom.numberToBuffer(value, len, true)
    );
    return this.readDemodReg(0x0a, 0x01);
  }

  /**
   * Opens the I2C repeater.
   */
  openI2C() {
    return this.writeDemodReg(1, 1, 0x18, 1);
  }

  /**
   * Closes the I2C repeater.
   */
  async closeI2C() {
    return this.writeDemodReg(1, 1, 0x10, 1);
  }

  /**
   * Reads a value from an I2C register.
   * @param {number} addr The device's address.
   * @param {number} reg The register number.
   */
  async readI2CReg(addr: number, reg: number) {
    await this.writeRegBuffer(
      RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg]).buffer
    );
    return this.readReg(RtlCom.BLOCK.I2C, addr, 1);
  }

  /**
   * Writes a value to an I2C register.
   * @param {number} addr The device's address.
   * @param {number} reg The register number.
   * @param {number} value The value to write.
   */
  async writeI2CReg(addr: number, reg: number, value: number) {
    await this.writeRegBuffer(
      RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg, value]).buffer
    );
  }

  /**
   * Reads a buffer from an I2C register.
   * @param {number} addr The device's address.
   * @param {number} reg The register number.
   * @param {number} len The number of bytes to read.
   */
  async readI2CRegBuffer(addr: number, reg: number, len: number) {
    await this.writeRegBuffer(
      RtlCom.BLOCK.I2C,
      addr,
      new Uint8Array([reg]).buffer
    );
    return this.readRegBuffer(RtlCom.BLOCK.I2C, addr, len);
  }

  /**
   * Writes a buffer to an I2C register.
   * @param {number} addr The device's address.
   * @param {number} reg The register number.
   * @param {ArrayBuffer} buffer The buffer to write.
   */
  writeI2CRegBuffer(addr: number, reg: number, buffer: ArrayBuffer) {
    const data = new Uint8Array(buffer.byteLength + 1);
    data[0] = reg;
    data.set(new Uint8Array(buffer), 1);
    return this.writeRegBuffer(RtlCom.BLOCK.I2C, addr, data.buffer);
  }

  /**
   * Sends a USB control message to read from the device.
   * @param {number} value The value field of the control message.
   * @param {number} index The index field of the control message.
   * @param {number} length The number of bytes to read.
   */
  async readCtrlMsg(value: number, index: number, length: number) {
    const ti: USBControlTransferParameters = {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value,
      index,
    };
    try {
      const data = await this.conn.controlTransferIn(ti, Math.max(8, length));
      const bufdata = data.data.buffer.slice(0, length);
      if (VERBOSE) {
        console.log(
          `IN value 0x${value.toString(16)} index 0x${index.toString(
            16
          )} read -> ${RtlCom.dumpBuffer(bufdata)}`
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

  /**
   * Sends a USB control message to write to the device.
   * @param {number} value The value field of the control message.
   * @param {number} index The index field of the control message.
   * @param {ArrayBuffer} buffer The buffer to write to the device.
   */
  async writeCtrlMsg(value: number, index: number, buffer: ArrayBuffer) {
    const ti: USBControlTransferParameters = {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value,
      index,
    };
    try {
      await this.conn.controlTransferOut(ti, buffer);
      if (VERBOSE) {
        console.log(
          `OUT value 0x${value.toString(16)} index 0x${index.toString(
            16
          )} data ${RtlCom.dumpBuffer(buffer)}`
        );
      }
    } catch (error) {
      throw new Error(
        `USB write failed (value 0x${value.toString(
          16
        )} index 0x${index.toString(16)} data ${RtlCom.dumpBuffer(
          buffer
        )} message=${error.message}`
      );
    }
  }

  /**
   * Does a bulk transfer from the device.
   * @param {number} length The number of bytes to read.
   * @return {ArrayBuffer} The received buffer.
   */
  async readBulk(length: number) {
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
        `USB bulk read failed (length 0x${length.toString(16)}), error=${
          error.message
        }`
      );
    }
  }

  /**
   * Claims the USB interface.
   */
  async claimInterface() {
    return this.conn.claimInterface(0);
  }

  /**
   * Releases the USB interface.
   */
  async releaseInterface() {
    return this.conn.releaseInterface(0);
  }

  /**
   * Performs several write operations as specified in an array.
   * @param {Array.<Array.<number>>} array The operations to perform.
   */
  async writeEach(array) {
    for (let index = 0; index < array.length; index++) {
      const line = array[index];
      if (line[0] === RtlCom.CMD.REG) {
        await this.writeReg(line[1], line[2], line[3], line[4]);
      } else if (line[0] === RtlCom.CMD.REGMASK) {
        await this.writeRegMask(line[1], line[2], line[3], line[4]);
      } else if (line[0] === RtlCom.CMD.DEMODREG) {
        await this.writeDemodReg(line[1], line[2], line[3], line[4]);
      } else if (line[0] === RtlCom.CMD.I2CREG) {
        await this.writeI2CReg(line[1], line[2], line[3]);
      } else {
        throw new Error(`Unsupported operation [${line}]`);
      }
    }
  }

  /**
   * Returns a string representation of a buffer.
   * @param {ArrayBuffer} buffer The buffer to display.
   * @return {string} The string representation of the buffer.
   */
  static dumpBuffer(buffer) {
    const bytes = [];
    const arr = new Uint8Array(buffer);
    for (let i = 0; i < arr.length; ++i) {
      bytes.push(`0x${arr[i].toString(16)}`);
    }
    return `[${bytes}]`;
  }
  /**
   * Commands for writeEach.
   */

  static CMD = {
    REG: 1,
    REGMASK: 2,
    DEMODREG: 3,
    I2CREG: 4,
  };

  /**
   * Register blocks.
   */
  static BLOCK = {
    DEMOD: 0x000,
    USB: 0x100,
    SYS: 0x200,
    I2C: 0x600,
  };

  /**
   * Device registers.
   */
  static REG = {
    SYSCTL: 0x2000,
    EPA_CTL: 0x2148,
    EPA_MAXPKT: 0x2158,
    DEMOD_CTL: 0x3000,
    DEMOD_CTL_1: 0x300b,
  };

  /**
   * Decodes a buffer as a little-endian number.
   * @param {ArrayBuffer} buffer The buffer to decode.
   * @return {number} The decoded number.
   */
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

  /**
   * Encodes a number into a buffer.
   * @param {number} value The number to encode.
   * @param {number} len The number of bytes to encode into.
   * @param {boolean=} opt_bigEndian Whether to use a big-endian encoding.
   */
  static numberToBuffer = (value, len, optBigEndian = false) => {
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
}

export default RtlCom;
