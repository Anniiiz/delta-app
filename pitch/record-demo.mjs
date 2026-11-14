// Records the Delta demo: drives the real app in Chrome, captures frames with captions, writes a concat list for ffmpeg.
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const DIR = new URL("./frames/", import.meta.url).pathname;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const FPS = 30;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });

const frames = [];
let n = 0;
async function shot(dur) {
  const f = `f${String(n++).padStart(5, "0")}.jpg`;
  await page.screenshot({ path: DIR + f, type: "jpeg", quality: 92 });
  frames.push([f, dur]);
}
const hold = (s) => shot(s);

async function overlay(tag, text) {
  await page.evaluate(
    ([tag, text]) => {
      if (!document.getElementById("__cap_style")) {
        const st = document.createElement("style");
        st.id = "__cap_style";
        st.textContent = `html{scroll-behavior:auto!important} nextjs-portal{display:none!important}
          #__cap{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:99999;max-width:1180px;display:flex;align-items:center;gap:14px;
            background:rgba(13,14,16,.96);border:1px solid #33363d;border-radius:12px;padding:14px 20px;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:Inter,system-ui,sans-serif}
          #__cap b{flex:none;font-size:12px;letter-spacing:.08em;font-weight:600;color:#fff;background:#5e6ad2;border-radius:6px;padding:5px 9px;white-space:nowrap}
          #__cap span{font-size:19px;line-height:1.35;color:#f7f8f8}`;
        document.head.appendChild(st);
      }
      let el = document.getElementById("__cap");
      if (!el) {
        el = document.createElement("div");
        el.id = "__cap";
        document.body.appendChild(el);
      }
      el.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = tag;
      const s = document.createElement("span");
      s.textContent = text;
      if (tag) el.append(b, s); else el.append(s);
    },
    [tag, text],
  );
}

async function go(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1200);
}

// The element that actually scrolls (the document, or a scrollable ancestor of <main>).
const scrollerJs = `(() => { let e = document.querySelector('main'); while (e) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4) return e; e = e.parentElement; } return document.scrollingElement; })()`;
const getY = () => page.evaluate(`${scrollerJs}.scrollTop`);
const setY = (y) => page.evaluate(`${scrollerJs}.scrollTop = ${Math.round(y)}`);
const maxY = () => page.evaluate(`(() => { const s = ${scrollerJs}; return s.scrollHeight - s.clientHeight; })()`);

async function scrollTo(target, secs) {
  const y0 = await getY();
  const y1 = Math.max(0, Math.min(target, await maxY()));
  const steps = Math.max(1, Math.round(secs * FPS));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await setY(y0 + (y1 - y0) * e);
    await shot(1 / FPS);
  }
}
const scrollBy = async (dy, secs) => scrollTo((await getY()) + dy, secs);
async function topOf(selector, offset = 70) {
  return page.evaluate(
    ([sel, off, sjs]) => {
      const s = eval(sjs);
      const el = document.querySelector(sel);
      if (!el) return null;
      const base = s === document.scrollingElement ? 0 : s.getBoundingClientRect().top;
      return el.getBoundingClientRect().top - base + s.scrollTop - off;
    },
    [selector, offset, scrollerJs],
  );
}
async function scrollToEl(selector, secs) {
  const y = await topOf(selector);
  if (y == null) return console.log("missing", selector);
  await scrollTo(y, secs);
}

async function card(title, sub, secs) {
  await page.setContent(`<html><body style="margin:0;background:#08090a;color:#f7f8f8;font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 140px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:44px"><div style="width:44px;height:44px;border-radius:11px;background:#5e6ad2;display:grid;place-items:center;font-weight:700;font-size:24px">Δ</div><div style="font-size:28px;font-weight:600">delta.</div></div>
    <div style="font-size:92px;font-weight:600;letter-spacing:-2.5px;line-height:1.06">${title}</div>
    <div style="font-size:28px;color:#b4b8c0;margin-top:36px;max-width:1150px;line-height:1.4">${sub}</div></body></html>`);
  await page.waitForTimeout(300);
  await hold(secs);
}

// ---------------------------------------------------------------- scenes
const cap = (text) => overlay("", text);
const IMG = new URL("./deck-images/", import.meta.url).pathname;
const KRUOKA = IMG + "r-kruoka-citymarket.webp";
const furl = (f) => "file://" + encodeURI(f);
// A still built from real retailer screenshots, shown from a local file so the images load.
async function still(name, body, secs) {
  const f = new URL(`./${name}.html`, import.meta.url).pathname;
  fs.writeFileSync(f, `<!doctype html><html><body style="margin:0;background:#08090a;color:#f7f8f8;font-family:Inter,system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box">${body}</body></html>`);
  await page.goto("file://" + f, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await hold(secs);
}
const pic = (src, w, h) => `<img src="${furl(src)}" style="width:${w}px;height:${h}px;object-fit:cover;object-position:top;border-radius:14px;display:block">`;
const price = (amount, where) => `<div style="margin-top:22px;display:flex;align-items:baseline;gap:16px"><span style="font-size:64px;font-weight:700;letter-spacing:-1.5px">${amount}</span><span style="font-size:26px;color:#8a8f98">${where}</span></div>`;

// why: the problem, on real retailer pages
await card("delta.<br>Know what changed.", "", 3);
await still("why1", `<div style="font-size:60px;font-weight:600;letter-spacing:-1.5px;margin-bottom:40px">The same box of chocolates.</div>
  <div style="display:flex;gap:40px"><div>${pic(IMG + "r-skaupat.png", 670, 377)}${price("€5.95", "S-kaupat")}</div><div>${pic(KRUOKA, 670, 377)}${price("€6.29", "K-Ruoka")}</div></div>`, 4.5);
await still("why2", `<div style="font-size:60px;font-weight:600;letter-spacing:-1.5px;margin-bottom:40px">Offers change every week.</div>${pic(IMG + "r-lidl.png", 1380, 560)}`, 3.5);
await card("Your competitors change prices.<br>You find out too late.", "", 4);
await card("Built around each customer.", "Your products. Your competitors. Your retailers. Your alerts.", 4);

await go("/");
await cap("Set up for Fazer: its own shelf on one screen.");
await hold(4);
await scrollBy(520, 3);
await hold(1.5);

await go("/account");
const drill = await page.locator('main a[href*="/account?p="]').first().getAttribute("href");
await cap("Every product, every store.");
await hold(3.5);
await cap("Where it is sold.");
await scrollToEl("#presence", 1.5);
await hold(2);
await scrollBy(520, 3);
await hold(1);

await cap("What it costs there.");
await scrollToEl("#prices", 2);
await hold(2.5);
await scrollBy(420, 2.5);
await hold(1);

await go(drill);
await cap("One product, store by store.");
await hold(3.5);
await scrollBy(330, 1.5);
await hold(1.5);
const cb = page.locator("label", { hasText: "Off the most common price" }).locator("input");
if (await cb.count()) {
  await cb.first().check();
  await page.waitForTimeout(400);
  await cap("The outliers.");
  await hold(3);
  await scrollBy(300, 2);
  await hold(1);
}

await go("/account");
await cap("What is discounted.");
await setY((await topOf("#promotions")) ?? 0);
await hold(3.5);
await scrollBy(420, 2.5);
await hold(1);
await cap("What competitors are running.");
await scrollToEl("#competitors", 2);
await hold(3.5);
await scrollBy(380, 2.5);

await go("/area");
await cap("Favourite products and categories. Follow your own area.");
await hold(4.5);
await scrollBy(380, 2.5);
await hold(1.5);

await go("/monitor");
await cap("Pages watched every hour.");
await hold(4);
const check = page.locator("button", { hasText: "Check for changes" });
if (await check.count()) {
  await check.first().click();
  await page.waitForTimeout(2500);
}
await cap("Only real changes become alerts.");
await scrollBy(430, 2);
await hold(3.5);
await cap("A real change, detected.");
await scrollTo(await maxY(), 2.5);
await hold(4);

// ask: type a real question, wait for the grounded answer
await go("/ask");
await cap("Ask about your own data.");
await hold(2.5);
const box = page.locator("main textarea, main input[type='text'], main input:not([type])").first();
if (await box.count()) {
  const q = "Where is the Dumle advent calendar most expensive?";
  await box.click();
  for (let i = 0; i < q.length; i += 3) {
    await box.pressSequentially(q.slice(i, i + 3));
    await shot(0.07);
  }
  await hold(0.8);
  const answered = page.waitForResponse((r) => r.url().includes("/api/ask"), { timeout: 60000 }).catch(() => null);
  await box.press("Enter");
  await hold(1.2);
  await answered;
  await page.waitForTimeout(1200);
  await cap("Answered from the captured data, with links to the source screens.");
  await hold(7);
}

await card("delta.<br>Know what changed.", "", 4);

await browser.close();

// concat list for ffmpeg (the last file is repeated, as the demuxer requires)
const lines = frames.map(([f, d]) => `file 'frames/${f}'\nduration ${d.toFixed(4)}`);
lines.push(`file 'frames/${frames[frames.length - 1][0]}'`);
fs.writeFileSync(new URL("./list.txt", import.meta.url).pathname, lines.join("\n") + "\n");
console.log(`${frames.length} frames, ${frames.reduce((s, [, d]) => s + d, 0).toFixed(1)} s`);
