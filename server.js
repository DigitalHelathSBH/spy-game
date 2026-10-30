const http = require('http');

const PAIRS = [
  ['กาแฟ', 'ชา'], ['หมา', 'หมาป่า'], ['แมว', 'เสือ'], ['ส้มตำ', 'ยำวุ้นเส้น'], ['ข้าวมันไก่', 'ข้าวหมูแดง'],
  ['ก๋วยเตี๋ยว', 'บะหมี่'], ['พิซซ่า', 'เบอร์เกอร์'], ['ชาบู', 'หมูกระทะ'], ['ซูชิ', 'ซาชิมิ'], ['ไอศกรีม', 'น้ำแข็งไส'],
  ['โค้ก', 'เป๊ปซี่'], ['เบียร์', 'ไวน์'], ['ทะเล', 'แม่น้ำ'], ['ภูเขา', 'เนินเขา'], ['เครื่องบิน', 'เฮลิคอปเตอร์'],
  ['รถไฟ', 'รถไฟฟ้า'], ['มอเตอร์ไซค์', 'จักรยาน'], ['หมอ', 'พยาบาล'], ['ครู', 'อาจารย์'], ['ตำรวจ', 'ทหาร'],
  ['นักร้อง', 'นักแสดง'], ['ดินสอ', 'ปากกา'], ['โทรศัพท์', 'แท็บเล็ต'], ['โน้ตบุ๊ก', 'คอมตั้งโต๊ะ'], ['เฟซบุ๊ก', 'อินสตาแกรม'],
  ['ติ๊กต็อก', 'ยูทูบ'], ['แตงโม', 'แคนตาลูป'], ['ทุเรียน', 'ขนุน'], ['มะม่วง', 'มะละกอ'], ['ฟุตบอล', 'ฟุตซอล'],
  ['แบดมินตัน', 'เทนนิส'], ['ว่ายน้ำ', 'ดำน้ำ'], ['หมอน', 'ผ้าห่ม'], ['ร่ม', 'เสื้อกันฝน'], ['รองเท้าแตะ', 'รองเท้าผ้าใบ'],
  ['โรงหนัง', 'โรงละคร'], ['ห้าง', 'ตลาดนัด'], ['วัด', 'โบสถ์'], ['ญี่ปุ่น', 'เกาหลี'], ['ผี', 'ซอมบี้'],
];

const rooms = {};
const MIN_PLAYERS = 3, MAX_PLAYERS = 8, STALE_MS = 20000;

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  } while (rooms[code]);
  return code;
}

function view(room, me) {
  const done = room.phase === 'result';
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    isHost: room.players[0].id === me.id,
    word: room.phase === 'lobby' ? null : room.words[me.id],
    myVote: room.votes[me.id] || null,
    min: MIN_PLAYERS,
    players: room.players.map(p => ({
      id: p.id, name: p.name, score: p.score, isMe: p.id === me.id,
      voted: !!room.votes[p.id],
      votes: done ? Object.values(room.votes).filter(v => v === p.id).length : 0,
      word: done ? room.words[p.id] : null,
      isOdd: done ? p.id === room.oddId : false,
    })),
    caught: done ? room.caught : null,
  };
}

function startRound(room) {
  const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
  const [common, odd] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
  room.oddId = room.players[Math.floor(Math.random() * room.players.length)].id;
  room.words = {};
  room.players.forEach(p => { room.words[p.id] = p.id === room.oddId ? odd : common; });
  room.votes = {};
  room.caught = null;
  room.round++;
  room.phase = 'play';
}

function finishRound(room) {
  const tally = {};
  Object.values(room.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
  const top = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).filter(id => tally[id] === top);
  // A tie means the group did not agree, so the odd one escapes.
  room.caught = leaders.length === 1 && leaders[0] === room.oddId;
  room.players.forEach(p => {
    if (room.caught && p.id !== room.oddId) p.score += 1;
    if (!room.caught && p.id === room.oddId) p.score += 2;
  });
  room.phase = 'result';
}

const actions = {
  join(body) {
    const name = String(body.name || '').trim().slice(0, 16);
    if (!name) return { error: 'ใส่ชื่อก่อน' };
    const code = String(body.room || '').trim().toUpperCase();
    if (code && !rooms[code]) return { error: 'ไม่พบห้องนี้' };
    const newCode = code || makeCode();
    const target = rooms[newCode] || (rooms[newCode] = { code: newCode, phase: 'lobby', round: 0, players: [], words: {}, votes: {}, oddId: null, caught: null });
    let me = target.players.find(p => p.id === body.id);
    if (!me) {
      if (target.phase !== 'lobby') return { error: 'ห้องนี้เริ่มเล่นไปแล้ว รอจบรอบก่อน' };
      if (target.players.length >= MAX_PLAYERS) return { error: 'ห้องเต็มแล้ว' };
      me = { id: body.id, name, score: 0, seen: Date.now() };
      target.players.push(me);
    }
    return view(target, me);
  },
  start(body, room, me) {
    if (room.players[0] !== me || room.players.length < MIN_PLAYERS) return { error: 'ยังเริ่มไม่ได้' };
    startRound(room);
    return view(room, me);
  },
  vote(body, room, me) {
    if (room.phase !== 'play' || body.target === me.id || !room.players.some(p => p.id === body.target)) return { error: 'โหวตไม่ได้' };
    room.votes[me.id] = body.target;
    if (room.players.every(p => room.votes[p.id])) finishRound(room);
    return view(room, me);
  },
  reveal(body, room, me) {
    if (room.players[0] !== me || room.phase !== 'play') return { error: 'เปิดผลไม่ได้' };
    finishRound(room);
    return view(room, me);
  },
  lobby(body, room, me) {
    if (room.players[0] !== me) return { error: 'เฉพาะหัวห้อง' };
    room.phase = 'lobby';
    return view(room, me);
  },
};

const PAGE = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ใครคือคนแปลก</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#12332b;color:#f2f7ee;font:17px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif;display:flex;justify-content:center;padding:16px}
main{width:100%;max-width:440px}
h1{font-size:26px;margin:8px 0 16px}
.card{background:#1b463b;border-radius:14px;padding:16px;margin-bottom:12px}
input,button{width:100%;font:inherit;padding:13px;border-radius:10px;border:0;margin-top:8px}
input{background:#fff;color:#111}
button{background:#f4bd3f;color:#2c2100;font-weight:700;cursor:pointer}
button.alt{background:#2f6355;color:#f2f7ee}
button:disabled{opacity:.45;cursor:default}
.code{font-size:36px;font-weight:800;letter-spacing:6px;color:#f4bd3f}
.word{font-size:40px;font-weight:800;text-align:center;color:#f4bd3f;padding:8px 0;overflow-wrap:anywhere}
.muted{color:#a9c7b8;font-size:15px}
.row{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #2f6355}
.row:last-child{border:0}
.odd{color:#f4bd3f;font-weight:700}
.err{color:#ff9f8f;min-height:24px;margin-top:8px}
.big{font-size:22px;font-weight:800;text-align:center}
</style></head><body><main>
<h1>ใครคือคนแปลก</h1><div id="app"></div><div class="err" id="err"></div>
</main><script>
const store = sessionStorage;
const id = store.getItem('id') || Math.random().toString(36).slice(2) + Date.now().toString(36);
store.setItem('id', id);
let room = store.getItem('room') || '', name = store.getItem('name') || '', last = '';
const linkRoom = new URLSearchParams(location.search).get('room') || '';
const app = document.getElementById('app'), err = document.getElementById('err');
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

async function api(action, extra) {
  const r = await fetch('/api/' + action, { method: 'POST', body: JSON.stringify({ id, room, name, ...extra }) });
  return r.json();
}
function apply(s) {
  if (s.gone) { if (name && room) return join(room, name); room = ''; store.removeItem('room'); return drawJoin(); }
  if (s.error) { err.textContent = s.error; return; }
  err.textContent = '';
  const key = JSON.stringify(s);
  if (key === last) return;
  last = key;
  room = s.code; store.setItem('room', room);
  draw(s);
}
async function join(code, n) {
  name = n; store.setItem('name', n);
  const s = await api('join', { room: code, name: n });
  if (s.error) { room = ''; store.removeItem('room'); err.textContent = s.error; if (!document.getElementById('name')) drawJoin(); return; }
  apply(s);
}
function drawJoin() {
  last = '';
  app.innerHTML = '<div class="card"><input id="name" placeholder="ชื่อของคุณ" maxlength="16"><input id="code" placeholder="รหัสห้อง (เว้นว่าง = สร้างห้องใหม่)" maxlength="4" style="text-transform:uppercase"><button id="go">เข้าเล่น</button></div>'
    + '<div class="card muted">ทุกคนได้คำ 1 คำ แต่มี 1 คนได้คำที่คล้ายแต่ไม่เหมือน และไม่มีใครรู้ว่าตัวเองเป็นคนนั้น ผลัดกันใบ้คำแบบไม่บอกตรงๆ แล้วโหวตหาคนแปลก</div>';
  document.getElementById('name').value = name;
  document.getElementById('code').value = linkRoom;
  document.getElementById('go').onclick = () => join(document.getElementById('code').value, document.getElementById('name').value);
}
function draw(s) {
  const list = s.players;
  if (s.phase === 'lobby') {
    const link = location.origin + '/?room=' + s.code;
    app.innerHTML = '<div class="card">รหัสห้อง<div class="code">' + s.code + '</div><button class="alt" id="copy">คัดลอกลิงก์ชวนเพื่อน</button></div>'
      + '<div class="card"><b>ผู้เล่น ' + list.length + ' คน</b>' + list.map(p => '<div class="row"><span>' + esc(p.name) + (p.isMe ? ' (คุณ)' : '') + '</span><span>' + p.score + ' แต้ม</span></div>').join('') + '</div>'
      + (s.isHost ? '<button id="start"' + (list.length < s.min ? ' disabled' : '') + '>เริ่มเกม' + (list.length < s.min ? ' (ต้องมีอย่างน้อย ' + s.min + ' คน)' : '') + '</button>' : '<div class="muted">รอหัวห้องกดเริ่ม...</div>');
    document.getElementById('copy').onclick = e => { navigator.clipboard.writeText(link); e.target.textContent = 'คัดลอกแล้ว'; };
    if (s.isHost) document.getElementById('start').onclick = () => api('start').then(apply);
  } else if (s.phase === 'play') {
    const voted = list.filter(p => p.voted).length;
    app.innerHTML = '<div class="card">รอบที่ ' + s.round + ' · คำของคุณคือ<div class="word">' + esc(s.word) + '</div><div class="muted">ผลัดกันใบ้คำทีละคน แล้วโหวตว่าใครคือคนแปลก</div></div>'
      + '<div class="card"><b>โหวต (' + voted + '/' + list.length + ')</b>' + list.filter(p => !p.isMe).map(p => '<button class="' + (s.myVote === p.id ? '' : 'alt') + '" data-v="' + esc(p.id) + '">' + esc(p.name) + (p.voted ? ' ✓' : '') + '</button>').join('') + '</div>'
      + (s.isHost ? '<button class="alt" id="reveal">เปิดผลเลย</button>' : '');
    app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => api('vote', { target: b.dataset.v }).then(apply));
    if (s.isHost) document.getElementById('reveal').onclick = () => api('reveal').then(apply);
  } else {
    const odd = list.find(p => p.isOdd);
    app.innerHTML = '<div class="card big">' + (s.caught ? 'จับได้! คนแปลกคือ ' : 'จับไม่ได้! คนแปลกคือ ') + esc(odd ? odd.name : '-') + '</div>'
      + '<div class="card">' + list.map(p => '<div class="row"><span class="' + (p.isOdd ? 'odd' : '') + '">' + esc(p.name) + ': ' + esc(p.word) + '</span><span>' + p.votes + ' โหวต · ' + p.score + ' แต้ม</span></div>').join('') + '</div>'
      + '<div class="muted">จับได้: คนอื่นได้คนละ 1 แต้ม · จับไม่ได้หรือโหวตเสมอ: คนแปลกได้ 2 แต้ม</div>'
      + (s.isHost ? '<button id="again">เล่นรอบต่อไป</button>' : '<div class="muted">รอหัวห้องเริ่มรอบต่อไป...</div>');
    if (s.isHost) document.getElementById('again').onclick = () => api('lobby').then(() => api('start')).then(apply);
  }
}
if (room && name) join(room, name); else drawJoin();
setInterval(() => { if (room) api('state').then(apply).catch(() => {}); }, 1000);
</script></body></html>`;

http.createServer((req, res) => {
  const send = (status, type, data) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  };
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE);
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(404, 'text/plain', 'not found');

  let raw = '';
  req.on('data', c => { if (raw.length < 2000) raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, 'application/json', '{"error":"bad json"}'); }
    const action = url.pathname.slice(5);
    let out;
    if (action === 'join') out = actions.join(body);
    else {
      const room = rooms[body.room];
      const me = room && room.players.find(p => p.id === body.id);
      if (!me) out = { gone: true };
      else {
        me.seen = Date.now();
        // Only drop idle players in the lobby; mid-round a locked phone must not break the round.
        if (room.phase === 'lobby') room.players = room.players.filter(p => Date.now() - p.seen < STALE_MS);
        out = action === 'state' ? view(room, me) : actions[action] ? actions[action](body, room, me) : { error: 'unknown' };
      }
    }
    send(200, 'application/json', JSON.stringify(out));
  });
}).listen(process.env.PORT || 3000, () => console.log('listening'));
