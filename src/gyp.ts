const addon = require("bindings")("hello.node");

const buf = Buffer.from([6, 2, 3]);
console.log("This should be eight:", addon.add(buf));
