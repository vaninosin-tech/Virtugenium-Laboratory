import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Tests in older waves rewrite tracked reference files. Restore only those
// generated changes; F4's own evidence lives under wave18f4.
const changed=execFileSync("git",["diff","--name-only","--","docs/night"],{encoding:"utf8"})
  .trim().split(/\r?\n/).filter(path=>path.startsWith("docs/night/")&&!path.startsWith("docs/night/wave18f4/"));
for(const path of changed)fs.writeFileSync(path,execFileSync("git",["show",`HEAD:${path}`],{maxBuffer:100_000_000}));
const stale=execFileSync("git",["status","--short","--","docs/night"],{encoding:"utf8"})
  .split(/\r?\n/).filter(line=>line.startsWith(" M ")).map(line=>line.slice(3))
  .filter(path=>path.startsWith("docs/night/")&&!path.startsWith("docs/night/wave18f4/"));
for(const path of stale){const bytes=fs.readFileSync(path);if(bytes.includes(0)||/\.(?:ppm|png|jpg|jpeg|webp|mp4)$/i.test(path))continue;
  fs.writeFileSync(path,bytes.toString("utf8").replace(/\r?\n/g,"\r\n"));}
console.log(`Restored ${changed.length} tracked diagnostic files; ${stale.length} text files matched CRLF checkout`);
