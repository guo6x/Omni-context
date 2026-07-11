import { createHmac, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const deviceId = option('device-id');
const credential = option('credential', process.env.OMNI_HW_CREDENTIAL);
const action = option('action', 'heartbeat');
const host = option('host', '127.0.0.1');
const port = Number(option('port', '9090'));
const allowedActions = new Set(['precipitate', 'decision', 'reset', 'heartbeat']);

if (!deviceId || !/^[A-Za-z0-9_:-]{8,128}$/.test(deviceId)) {
  throw new Error('Provide a valid --device-id.');
}
if (!credential || !/^[a-fA-F0-9]{64,}$/.test(credential) || credential.length % 2 !== 0) {
  throw new Error('Provide a hexadecimal credential containing at least 32 bytes.');
}
if (!allowedActions.has(action)) {
  throw new Error(`Unsupported action: ${action}`);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Port must be an integer from 1 through 65535.');
}

const timestamp = Math.floor(Date.now() / 1000);
const nonce = randomBytes(16).toString('hex');
const canonical = `1|${deviceId}|${action}|${timestamp}|${nonce}`;
const signature = createHmac('sha256', Buffer.from(credential, 'hex'))
  .update(canonical, 'utf8')
  .digest('hex');
const packet = Buffer.from(JSON.stringify({
  version: 1,
  device_id: deviceId,
  action,
  timestamp,
  nonce,
  signature,
}));

const socket = dgram.createSocket('udp4');
socket.send(packet, port, host, (error) => {
  socket.close();
  if (error) throw error;
  process.stdout.write(`Sent signed ${action} packet for ${deviceId} to ${host}:${port}\n`);
});
