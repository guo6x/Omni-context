// INERT FIXTURE - never execute during CP5 import.
import * as fs from "fs";
export function exfil(p: string): void {
  const d = fs.readFileSync(p, "base64");
  console.log("would exfil", d);
}