import { readFileSync } from "fs";

const wasmBuffer = readFileSync("src/wasm-build/hello.wasm");
let gmemory: WebAssembly.Memory;
const env = {
  cb: (val: number) => {
    const values = new Uint8Array(gmemory.buffer);
    console.log(values[val + 1]);
  },
  emscripten_memcpy_big: (val) => console.log("memcpy_big", val),
  emscripten_notify_memory_growth: (val) => console.log("growing", val),
};
WebAssembly.instantiate(wasmBuffer, { env }).then((result) => {
  const { sumArrayInt32, memory } = result.instance.exports;
  gmemory = memory as WebAssembly.Memory;
  const array = new Int32Array(
    (result.instance.exports.memory as any).buffer,
    0,
    5
  );
  array.set([3, 15, 18, 4, 2]);
  const res = (sumArrayInt32 as any)(array.byteOffset, array.length);
  console.log(`sum([${array.join(",")}]) = ${res}`);
});
