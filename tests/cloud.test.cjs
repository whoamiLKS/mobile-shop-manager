const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs'), assert = require('node:assert/strict');
let html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'),'utf8');
html = html.replace(/<script src="[^"]+"[^>]*><\/script>/g,'');
const code = fs.readFileSync(require('node:path').join(__dirname, '../cloud.js'),'utf8');
html = html.replace('</body>', `<script>${code}</script></body>`);
let row = null, fail = false, onAuth;
const uid = '11111111-1111-4111-8111-111111111111';
const session = {user:{id:uid,email:'test@example.invalid',user_metadata:{shop_name:'Test Shop'}}};
const clone = x => JSON.parse(JSON.stringify(x));
const client = {
  auth: {onAuthStateChange(cb) {onAuth=cb}, async getSession(){return {data:{session}}}, async signOut(){onAuth('SIGNED_OUT',null);return {error:null}}},
  from() {return {select(fields){return {eq(){return {async maybeSingle(){return {data:clone(row)}},async single(){return {data:clone(row)}}}}}}}},
  async rpc(name,args) {
    if(fail)return {error:{message:'Network unavailable'}};
    if(row?.write_id===args.request_id)return {data:row.revision};
    if((row?.revision||0)!==args.expected_revision)return {error:{code:'40001',message:'Conflict'}};
    row={payload:clone(args.new_payload),revision:(row?.revision||0)+1,write_id:args.request_id};
    return {data:row.revision};
  }
};
const errors=[];
const vc = new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://mobile-shop-manager-mu.vercel.app/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.tailwind={};w.supabase={createClient:()=>client};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=()=>{};}});
const w=dom.window;
const wait=()=>new Promise(r=>setTimeout(r,350));
(async()=>{
await wait();
assert.deepEqual(errors,[]);
assert.equal(w.document.getElementById('auth-gateway-overlay').classList.contains('hidden'),true,'initial login');
assert.equal(row.payload.stores[0].name,'Test Shop');
assert(!row.payload.auth,'no PIN authentication persisted');
assert.equal(w.document.getElementById('auth-gateway-overlay').inert,undefined,'login form must not be inert');
w.eval(`appState.expenses.push({id:'EX-test',date:'2026-10-20',title:'Test',amount:10,drawer:'Cash USD'});saveState()`);
await wait();assert.equal(row.payload.expenses.length,1,'expense persisted');
assert.equal(row.payload.storeData['store-01'].expenses.length,1,'snapshot persisted');
assert(w.document.getElementById('cloud-status').textContent.includes('Saved'));
fail=true;
w.eval(`appState.expenses.push({id:'EX-offline',date:'2026-10-20',title:'Offline',amount:5,drawer:'Cash USD'});saveState()`);
await wait();assert(!w.document.getElementById('cloud-problem').classList.contains('hidden'),'save failures visible');
assert(w.localStorage.getItem('mobile-shop-cloud-draft:'+uid),'draft retained');
fail=false;
w.document.getElementById('cloud-problem-retry').click();await wait();
assert.equal(row.payload.expenses.length,2,'retry preserves work');
row.revision++;
w.eval(`appState.expenses.push({id:'EX-conflict',date:'2026-10-20',title:'Conflict',amount:2,drawer:'Cash USD'});saveState()`);
await wait();assert(w.document.getElementById('cloud-status').textContent.includes('Conflict'));
assert.equal(row.payload.expenses.length,2,'stale save must not overwrite server');
w.document.getElementById('cloud-use-server').click();await wait();
assert.equal(w.eval('appState.expenses.length'),2);
await w.Cloud.signOut();assert(!w.document.getElementById('auth-gateway-overlay').classList.contains('hidden'));
w.quickAuthAdmin();assert.equal(w.eval('appState.auth.isAuthenticated'),false,'demo shortcut disabled');
assert.equal(w.eval('appState.expenses.length'),0,'sign out clears data');
assert.deepEqual(errors,[]);
console.log('PASS: startup, auth UI, cloud save, store snapshot, offline recovery, conflict protection, logout and PIN bypass removal');
dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
