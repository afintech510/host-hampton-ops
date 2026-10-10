const { chromium } = require('playwright');
const fs = require('fs');
const f = p => 'data:font/woff2;base64,' + fs.readFileSync('node_modules/@fontsource/' + p).toString('base64');
const img = p => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const fonts = `
@font-face{font-family:Monoton;src:url(${f('monoton/files/monoton-latin-400-normal.woff2')})}
@font-face{font-family:BungeeO;src:url(${f('bungee-outline/files/bungee-outline-latin-400-normal.woff2')})}
@font-face{font-family:Neon;src:url(${f('neonderthaw/files/neonderthaw-latin-400-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:400;src:url(${f('poppins/files/poppins-latin-400-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:600;src:url(${f('poppins/files/poppins-latin-600-normal.woff2')})}`;
const d = { name:'MIA', age:'7th', date:'Saturday, November 14 · 2–4 PM', place:'Host Hampton · 295 Montauk Hwy, Speonk', host:'Allie', phone:'631-998-9325' };
const glow = c => `0 0 6px ${c},0 0 18px ${c},0 0 40px ${c}`;
const invite = `<html><head><style>${fonts}
*{margin:0}body{width:1085px;height:1530px;position:relative;background:url(${img('../assets/glow/background-plain.png')}) 0 0/100% 100%;color:#fbf9f1;font-family:Poppins,sans-serif;overflow:hidden}

.bar{position:absolute;left:170px;width:745px;top:653px;height:7px;border-radius:4px;background:linear-gradient(90deg,#ff2bd6,#b45cff 55%,#3d8bff);box-shadow:0 0 8px #ff2bd6,0 0 22px #a24bff,0 0 40px #5b6bff}
.br{position:absolute;top:1285px;width:30px;height:148px;border:5px solid #ff3df2;box-shadow:0 0 10px #ff3df2,0 0 24px #c92bff,inset 0 0 8px #ff3df2}
.brl{left:135px;border-right:none;border-radius:32px 0 0 32px}.brr{left:920px;border-left:none;border-radius:0 32px 32px 0}
.sq{position:absolute;height:120px}
.c{position:absolute;left:0;right:0;text-align:center}
.inv{top:118px;font-size:30px;letter-spacing:.33em;text-transform:uppercase;opacity:.95}
.glow{top:160px;font-family:Monoton;font-size:250px;line-height:1;color:#fff;background:linear-gradient(90deg,#ff3df2,#ffd23f 35%,#3dd9ff 70%,#b84dff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 10px #ff3df2) drop-shadow(0 0 26px #8a3dff)}
.party{top:470px;font-family:BungeeO;font-size:138px;line-height:1;color:#ff5a6e;text-shadow:${glow('#ff3355')}}
.icons{top:700px}.icons img{width:820px}
.name{top:835px;font-family:BungeeO;font-size:165px;line-height:1;color:#fff028;text-shadow:${glow('#ffe100')}}
.bday{top:1035px;display:flex;justify-content:center;align-items:baseline;gap:22px}
.age{font-family:BungeeO;font-size:128px;color:#fff;text-shadow:${glow('#c77dff')}}
.script{font-family:Neon;font-size:132px;color:#fff;text-shadow:${glow('#ff4fd8')}}
.date{top:1292px;font-weight:600;font-size:36px;letter-spacing:.04em;text-transform:uppercase}
.place{top:1345px;font-size:25px;letter-spacing:.06em}
.q{top:1388px;font-size:25px;letter-spacing:.06em;color:#ffd6f6}
</style></head><body>
<div class="bar"></div><div class="br brl"></div><div class="br brr"></div><img class="sq" style="left:70px;top:430px;height:210px;transform:rotate(-40deg)" src="${img('../assets/glow/squiggle.png')}"><img class="sq" style="left:960px;top:-10px;height:170px;transform:rotate(10deg)" src="${img('../assets/glow/squiggle.png')}">
<div class="c inv">You're invited to a</div>
<div class="c glow">GLOW</div>
<div class="c party">PARTY</div>
<div class="c icons"><img src="${img("../assets/glow/icon-strip.png")}"></div>
<div class="c name">${d.name}</div>
<div class="c bday"><span class="age">${d.age}</span><span class="script">Birthday!</span></div>
<div class="c date">${d.date}</div>
<div class="c place">${d.place}</div>
<div class="c q">Any questions? Ask ${d.host} · ${d.phone}</div>
</body></html>`;
(async()=>{
 const b = await chromium.launch(); fs.mkdirSync('out',{recursive:true});
 let p = await b.newPage({viewport:{width:1085,height:1530},deviceScaleFactor:1});
 await p.setContent(invite); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
 await p.screenshot({path:'out/invite.png'});
 const inv = 'data:image/png;base64,'+fs.readFileSync('out/invite.png').toString('base64');
 const og = `<html><head><style>${fonts}*{margin:0}body{width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 64px;box-sizing:border-box;background:url(${img('../assets/glow/background-plain.png')}) center/cover;color:#fbf9f1;font-family:Poppins,sans-serif;overflow:hidden}
img{height:560px;border-radius:14px;box-shadow:0 0 40px #b84dff88,0 10px 30px #0008}
.k{font-size:24px;letter-spacing:.3em;text-transform:uppercase;opacity:.85}
h1{font-family:BungeeO;font-weight:400;font-size:74px;line-height:1.05;color:#fff028;text-shadow:${glow('#ffe100')};margin:14px 0 26px}
.l{font-size:30px;line-height:1.5}.cta{margin-top:24px;display:inline-block;font-weight:600;font-size:28px;padding:14px 30px;border-radius:999px;background:#ff3df2;color:#1b0630;box-shadow:0 0 24px #ff3df2}
</style></head><body><img src="${inv}"><div><div class="k">You're invited</div><h1>MIA'S GLOW PARTY</h1><div class="l">Sat, Nov 14 · 2–4 PM</div><div class="l">Host Hampton, Speonk</div><div class="l" style="font-size:24px;color:#ffd6f6;margin-top:6px">Questions? Ask ${d.host} · ${d.phone}</div><div class="cta">Tap to RSVP</div></div></body></html>`;
 p = await b.newPage({viewport:{width:1200,height:630}});
 await p.setContent(og); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
 await p.screenshot({path:'out/og.jpg',type:'jpeg',quality:82});
 await b.close();
})();
