// Near Cash server: zero dependencies (Node 18+). REST + Server-Sent Events, JSON-file database.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,CC=process.env.DEFAULT_COUNTRY_CODE||'91',DEV=process.env.NODE_ENV!=='production'||process.env.DEV_OTP==='true',ADMIN=process.env.ADMIN_KEY||'';
const PUB=__dirname,DBF=path.join(__dirname,'data','db.json');
fs.mkdirSync(path.dirname(DBF),{recursive:true});
const db={users:{},sessions:{},otps:{},listings:[],threads:[],messages:[],reports:[],blocks:[]};
try{Object.assign(db,JSON.parse(fs.readFileSync(DBF,'utf8')))}catch{}
let pt;const save=()=>{clearTimeout(pt);pt=setTimeout(()=>{fs.writeFileSync(DBF+'.tmp',JSON.stringify(db));fs.renameSync(DBF+'.tmp',DBF)},150)};
const id=()=>crypto.randomBytes(8).toString('hex'),sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const hits=new Map(),ok=(k,n,ms)=>{const t=Date.now(),h=hits.get(k);if(!h||h.r<t){hits.set(k,{c:1,r:t+ms});return true}return++h.c<=n};
const bad=(m,c=400)=>{const e=new Error(m);e.c=c;throw e};
const rad=x=>x*Math.PI/180;
const dist=(a,b)=>{const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 12742*Math.asin(Math.sqrt(h))};
const bearing=(a,b)=>{const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));return(Math.atan2(y,x)*180/Math.PI+360)%360};
const streams=new Map(),push=(u,o)=>{for(const r of streams.get(u)||[])r.write('data: '+JSON.stringify(o)+'\n\n')},pushAll=o=>{for(const u of streams.keys())push(u,o)};
const blocked=(a,b)=>db.blocks.some(x=>(x.by===a&&x.who===b)||(x.by===b&&x.who===a));
const pubU=u=>({id:u.id,name:u.name,done:u.done||0});
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const readBody=req=>new Promise((y,n)=>{let d='';req.on('data',c=>{d+=c;if(d.length>10000){n(Object.assign(new Error('Request too large'),{c:413}));req.destroy()}});req.on('end',()=>{try{y(d?JSON.parse(d):{})}catch{n(Object.assign(new Error('Invalid JSON'),{c:400}))}})});
const norm=p=>{p=String(p||'').replace(/[\s-]/g,'');return p[0]==='+'?p:/^\d{10}$/.test(p)?'+'+CC+p:'+'+p};
async function sendSms(to,code){
  const sid=process.env.TWILIO_ACCOUNT_SID,tk=process.env.TWILIO_AUTH_TOKEN,from=process.env.TWILIO_FROM;
  if(sid&&tk&&from){const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+tk).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:to,From:from,Body:'Your Near Cash code is '+code})});
    if(!r.ok){console.error('Twilio error',r.status,await r.text());bad('Could not send the code',502)}return}
const u=process.env.SMS_WEBHOOK_URL;if(!u)bad('SMS provider not configured',501);const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env.SMS_WEBHOOK_TOKEN||'')},body:JSON.stringify({to,message:'Your Near Cash code is '+code})});if(!r.ok)bad('Could not send the code',502)}
const openL=()=>db.listings.filter(l=>l.status==='open'&&l.exp>Date.now());
const myThread=(u,tid)=>{const t=db.threads.find(x=>x.id===tid);if(!t||(t.a!==u.id&&t.b!==u.id))bad('Not found',404);return t};
const other=(t,u)=>db.users[t.a===u.id?t.b:t.a];

async function api(req,res,p,q){
  if(!ok('ip'+req.socket.remoteAddress,400,60000))bad('Too many requests',429);
  const m=req.method,b=m==='POST'?await readBody(req):{},P=p.split('/');
  if(p==='otp'&&m==='POST'){
    const ph=norm(b.phone);if(!/^\+\d{11,14}$/.test(ph))bad('Enter a valid phone number');
    if(!ok('otp'+ph,3,600000))bad('Too many codes requested. Try again in 10 minutes.',429);
    const code=String(crypto.randomInt(100000,1000000));db.otps[ph]={h:sha(code+ph),exp:Date.now()+300000,tries:0};save();
    if(DEV){console.log('[dev] OTP for',ph,code);return send(res,200,{ok:true,devCode:code})}
    await sendSms(ph,code);return send(res,200,{ok:true})}
  if(p==='verify'&&m==='POST'){
    const ph=norm(b.phone),o=db.otps[ph];
    if(!o||o.exp<Date.now())bad('Code expired. Request a new one.');
    if(++o.tries>5){delete db.otps[ph];bad('Too many attempts. Request a new code.',429)}
    if(o.h!==sha(String(b.code)+ph))bad('That code is wrong');
    if(b.adult!==true)bad('You must be 18 or older');
    let u=Object.values(db.users).find(x=>x.phone===ph);const nm=String(b.name||'').trim().slice(0,40);
    if(!u&&!nm)bad('Enter your name');
    delete db.otps[ph];if(!u){u={id:id(),phone:ph,name:nm,done:0,created:Date.now()};db.users[u.id]=u}
    const t=crypto.randomBytes(24).toString('hex');db.sessions[sha(t)]={uid:u.id,exp:Date.now()+2592e6};save();
    return send(res,200,{token:t,me:pubU(u)})}
  const tok=(req.headers.authorization||'').slice(7)||q.get('token')||'',s=db.sessions[sha(tok)],u=s&&s.exp>Date.now()&&db.users[s.uid];
  if(!u)bad('Please sign in',401);
  if(p==='me')return send(res,200,pubU(u));
  if(p==='stream'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write('retry: 3000\n\n');
    if(!streams.has(u.id))streams.set(u.id,new Set());streams.get(u.id).add(res);const hb=setInterval(()=>res.write(': hb\n\n'),25000);
    return req.on('close',()=>{clearInterval(hb);const S=streams.get(u.id);S&&S.delete(res);if(S&&!S.size)streams.delete(u.id)})}
  if(p==='location'&&m==='POST'){const la=+b.lat,lo=+b.lng;if(!(Math.abs(la)<=90&&Math.abs(lo)<=180)||b.lat==null)bad('Invalid location');
    u.lat=+la.toFixed(3);u.lng=+lo.toFixed(3);u.at=Date.now();save();return send(res,200,{ok:true})}
  if(p==='nearby'){const R=Math.min(+q.get('r')||3,10),mine=openL().filter(l=>l.uid===u.id);if(u.lat==null)return send(res,200,{items:[],mine});
    const items=openL().filter(l=>l.uid!==u.id&&!blocked(u.id,l.uid)).map(l=>{const o=db.users[l.uid];if(!o||o.lat==null)return null;const d=dist(u,o);
      return d<=R?{id:l.id,type:l.type,amount:l.amount,mins:Math.ceil((l.exp-Date.now())/60000),km:Math.max(.1,Math.ceil(d*10)/10),brg:Math.round(bearing(u,o)/10)*10,name:o.name,done:o.done||0}:null}).filter(Boolean).sort((a,b)=>a.km-b.km);
    return send(res,200,{items,mine})}
  if(p==='listings'&&m==='POST'){if(u.lat==null)bad('Turn on location first');const amt=Math.floor(+b.amount),mins=Math.floor(+b.minutes);
    if(!['have','need'].includes(b.type)||!(amt>=1&&amt<=5000)||!(mins>=5&&mins<=240))bad('Invalid post');
    if(openL().filter(l=>l.uid===u.id).length>=3)bad('You can have up to 3 live posts');
    const l={id:id(),uid:u.id,type:b.type,amount:amt,exp:Date.now()+mins*60000,status:'open'};db.listings.push(l);save();pushAll({t:'listings'});return send(res,200,l)}
  if(p==='listings/cancel'&&m==='POST'){const l=db.listings.find(x=>x.id===b.id&&x.uid===u.id&&x.status==='open');if(!l)bad('Not found',404);l.status='cancelled';save();pushAll({t:'listings'});return send(res,200,{ok:true})}
  if(p==='threads'&&m==='POST'){const l=openL().find(x=>x.id===b.listingId);if(!l||l.uid===u.id||blocked(u.id,l.uid))bad('This post is no longer available',409);
    const t={id:id(),lid:l.id,amount:l.amount,type:l.type,a:l.uid,b:u.id,status:'open',confirmed:[],created:Date.now()};l.status='matched';db.threads.push(t);save();
    pushAll({t:'listings'});push(l.uid,{t:'thread'});return send(res,200,{id:t.id})}
  if(p==='threads')return send(res,200,{items:db.threads.filter(t=>t.a===u.id||t.b===u.id).sort((x,y)=>y.created-x.created).map(t=>{const ms=db.messages.filter(x=>x.tid===t.id);return{id:t.id,amount:t.amount,status:t.status,other:pubU(other(t,u)),last:ms.length?ms[ms.length-1].text.slice(0,60):''}})});
  if(P[0]==='threads'&&P[1]){const t=myThread(u,P[1]),o=other(t,u);
    if(!P[2])return send(res,200,{id:t.id,amount:t.amount,status:t.status,confirmed:t.confirmed,other:pubU(o),msgs:db.messages.filter(x=>x.tid===t.id).slice(-200)});
    if(P[2]==='messages'&&m==='POST'){const text=String(b.text||'').trim().slice(0,500);if(!text)bad('Type a message');
      if(t.status!=='open'||blocked(u.id,o.id))bad('This chat is closed',409);if(!ok('msg'+u.id,30,60000))bad('Slow down a little',429);
      const msg={id:id(),tid:t.id,from:u.id,text,at:Date.now()};db.messages.push(msg);save();push(o.id,{t:'msg',threadId:t.id,msg,from:u.name});return send(res,200,msg)}
    if(P[2]==='complete'&&m==='POST'){if(t.status!=='open')bad('This exchange is closed',409);if(!t.confirmed.includes(u.id))t.confirmed.push(u.id);
      if(t.confirmed.length===2){t.status='completed';u.done=(u.done||0)+1;o.done=(o.done||0)+1}save();push(o.id,{t:'thread'});return send(res,200,{ok:true})}}
  if(p==='report'&&m==='POST'){const t=myThread(u,b.threadId),o=other(t,u);if(!['scam','harassment','unsafe','other'].includes(b.reason))bad('Choose a reason');
    db.reports.push({id:id(),by:u.id,who:o.id,tid:t.id,reason:b.reason,at:Date.now(),last:db.messages.filter(x=>x.tid===t.id).slice(-20)});
    db.blocks.push({by:u.id,who:o.id});if(t.status==='open')t.status='closed';save();push(o.id,{t:'thread'});return send(res,200,{ok:true})}
  if(p==='block'&&m==='POST'){if(!db.users[b.userId])bad('Not found',404);db.blocks.push({by:u.id,who:b.userId});save();return send(res,200,{ok:true})}
  bad('Not found',404)}

const ASSET=/^(index\.html|app\.js|live\.js|styles\.css|sw\.js|manifest\.webmanifest|icons\/[\w-]+\.png)$/;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','geolocation=(self)');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const url=new URL(req.url,'http://x');
  try{
    if(url.pathname==='/healthz')return send(res,200,{ok:true});
    if(url.pathname==='/api/admin/reports'){if(!ADMIN||req.headers['x-admin-key']!==ADMIN)return send(res,403,{error:'Forbidden'});return send(res,200,db.reports)}
    if(url.pathname.startsWith('/api/'))return await api(req,res,url.pathname.slice(5),url.searchParams);
    const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!ASSET.test(rel)){res.writeHead(404);return res.end('Not found')}
    const f=[path.join(PUB,rel),path.join(PUB,path.basename(rel))].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
    if(!f){res.writeHead(404);return res.end('Not found: '+rel+' is missing from the deployed files')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':f.endsWith('sw.js')?'no-cache':'public, max-age=300'});fs.createReadStream(f).pipe(res)
  }catch(e){if(!res.headersSent)send(res,e.c||500,{error:e.c?e.message:'Server error'});if(!e.c)console.error(e)}
}).listen(PORT,'0.0.0.0',()=>console.log('Near Cash on http://localhost:'+PORT+(DEV?' (dev mode: OTP codes are shown on screen)':'')));
setInterval(()=>{const n=Date.now();for(const k in db.sessions)if(db.sessions[k].exp<n)delete db.sessions[k];for(const k in db.otps)if(db.otps[k].exp<n)delete db.otps[k]},600000);
for(const f of ['index.html','app.js','live.js','styles.css'])if(!fs.existsSync(path.join(PUB,f)))console.error('WARNING: missing '+f+' - upload it to the repository');
