import { createSocket } from "dgram";

const server = createSocket("udp4");

server.bind(63093);
// When udp server receive message.
server.on("message", (message, a, b, c) => {
  console.log(message.toString("utf8"), a, b, c);
});
