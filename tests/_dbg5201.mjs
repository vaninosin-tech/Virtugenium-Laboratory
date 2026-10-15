import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, channel:"chrome" });
const p = await b.newPage({ viewport:{width:1200,height:900} });
p.on("pageerror", e=>console.log("pageerror", e.message.slice(0,500)));
p.on("console", m=>{ if(m.type()==="error"||m.type()==="warning") console.log(m.type(), m.text().slice(0,600)); });
await p.goto("http://127.0.0.1:5201");
await p.waitForTimeout(20000);
console.log((await p.locator("body").innerText()).slice(0,200));
await b.close();
