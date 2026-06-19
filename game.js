// ── 赛博人生 2077 · 游戏逻辑 ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── IndexedDB 封装 ──
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open('CyberLife2077', 2);
  req.onupgradeneeded = (e) => {
    const db = req.result;
    if (e.oldVersion < 1) {
      const store = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      store.createIndex('score', 'score', { unique: false });
    }
    if (e.oldVersion < 2) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function saveRecord(record) {
  return new Promise((resolve) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').add(record);
    tx.oncomplete = () => resolve();
  });
}

function getAllRecords() {
  return new Promise((resolve) => {
    const tx = db.transaction('records', 'readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.score - a.score));
  });
}

function deleteRecord(id) {
  return new Promise((resolve) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').delete(id);
    tx.oncomplete = () => resolve();
  });
}

// ── Settings（IndexedDB） ──
function dbGetSetting(key) {
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
  });
}

function dbSetSetting(key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = () => resolve();
  });
}

// ── API Key 管理 ──
let _apiKey = '';

async function loadApiKey() {
  _apiKey = await dbGetSetting('deepseek_api_key') || '';
  if (_apiKey) { $('#apikey-input').value = _apiKey; updateTestBtn(); }
}
await loadApiKey();

async function setApiKey(key) {
  _apiKey = key;
  await dbSetSetting('deepseek_api_key', key);
  updateTestBtn();
}

function getApiKey() { return _apiKey; }

$('#apikey-input').addEventListener('input', () => { setApiKey($('#apikey-input').value.trim()); });

function updateTestBtn() {
  $('#test-api-btn').disabled = !_apiKey;
}

// ── 测试 API 连接 ──
$('#test-api-btn').addEventListener('click', async () => {
  const btn = $('#test-api-btn');
  const status = $('#api-status');
  btn.textContent = '⏳ 测试中...';
  btn.classList.add('testing');
  status.className = 'api-status hidden';

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: '回复一个字：通' }],
        max_tokens: 4,
      }),
    });

    if (res.ok) {
      status.textContent = '✅ 连接成功！DeepSeek API 可用';
      status.className = 'api-status success';
    } else {
      const err = await res.json().catch(() => ({}));
      status.textContent = `❌ API 返回错误 (${res.status})：${err.error?.message || '未知错误'}`;
      status.className = 'api-status error';
    }
  } catch (e) {
    status.textContent = `❌ 网络请求失败：${e.message.includes('Failed to fetch') ? 'CORS 跨域拦截，浏览器无法直接调 DeepSeek API' : e.message}`;
    status.className = 'api-status error';
  }

  btn.textContent = '🔍 测试连接';
  btn.classList.remove('testing');
});

// ── 游戏状态 ──
const state = {
  name: '',
  origin: '',
  day: 1,
  hp: 100,
  credits: 50,
  rep: 50,
  hack: 50,
  alive: true,
  log: [],
};

// ── 开局背景 ──
const origins = {
  corpo: { hp: 0, credits: 30, rep: 0, hack: -10, desc: '你曾是荒坂集团的初级数据分析师。一次内部审计中发现了高层的腐败，你选择了揭发——代价是被踢出公司。你带着攒下的信用点，在夜之城的地下世界从头开始。' },
  hacker: { hp: 0, credits: -10, rep: 0, hack: 30, desc: '你从小就在网络数据流中长大，15岁黑进了第一个企业服务器。在暗网里你被叫做"幽灵"，但在现实世界你只是个租住地下室的无名之辈。你的技术很强，但信用点不多了。' },
  nomad: { hp: 30, credits: 0, rep: -10, hack: 0, desc: '你在废土长大，和你的游民部落一起游荡在城市的边缘。直到部落被雇佣兵袭击，你成了唯一的幸存者。城市对你来说是陌生的，但你有着顽强的生命力。' },
};

// ── 随机事件池 ──
const events = [
  {
    id: 'fixer_job',
    title: '中间人找上门',
    desc: '一个叫"黑手"的中间人找到你，说有单生意：某企业需要有人从竞争对手服务器里偷数据。报酬丰厚，但风险不小。',
    choices: [
      { text: '接单（黑客挑战）', check: (s) => s.hack >= 30, effect: { credits: 25, rep: 10, hack: -5 }, result: '你成功渗透了目标服务器，数据到手，信用点到账。' },
      { text: '接单但敷衍了事', effect: { credits: 10, rep: -5 }, result: '你没认真干，中间人不满意，只给了很少的钱。' },
      { text: '拒绝', effect: { rep: -5 }, result: '中间人冷哼一声："下次不会找你了。"' },
    ],
  },
  {
    id: 'street_doc',
    title: '地下诊所的义体医生',
    desc: '你在巷子里遇到一个义体医生。他说可以给你装一个二手义体——能提升反应速度，但设备来源不太干净。',
    choices: [
      { text: '安装（花费 20 信用点）', check: (s) => s.credits >= 20, effect: { credits: -20, hp: 20, hack: 10 }, result: '义体装上了！虽然偶尔会有奇怪的卡顿，但确实让你更强了。' },
      { text: '砍价到 10 信用点', check: (s) => s.credits >= 10, effect: { credits: -10, hp: 10 }, result: '医生翻了个白眼，但还是成交了。' },
      { text: '走开', effect: {}, result: '你摇了摇头走开了，二手义体听起来就不靠谱。' },
    ],
  },
  {
    id: 'gang',
    title: '帮派火并',
    desc: '你路过桥口区时撞上了两帮派在交火。流弹擦着你的耳朵飞过。你可以趁机捡点掉落的装备，或者赶紧离开。',
    choices: [
      { text: '躲在掩体后观察', effect: { hp: -5, hack: 5 }, result: '你藏在一个集装箱后面，虽然挨了一颗跳弹，但你观察到帮派用的通讯加密方式，学到了一些东西。' },
      { text: '趁乱搜刮', effect: { hp: -15, credits: 30 }, result: '子弹横飞，你被碎片击中。但你捡到了一箱子的电子废料，卖了点钱。' },
      { text: '拔腿就跑', effect: {}, result: '你以最快的速度跑到了安全区域。"活着最重要。"' },
    ],
  },
  {
    id: 'netrunner',
    title: '暗网悬赏',
    desc: '你在暗网上看到一个匿名悬赏：破解一个企业防火墙。赏金极高，但你知道这是在找死——企业网安不是闹着玩的。',
    choices: [
      { text: '接受挑战', check: (s) => s.hack >= 50, effect: { credits: 40, rep: 15, hack: -15, hp: -10 }, result: '你花了整整一夜攻破防火墙，差点被反向追踪。但你做到了，匿名账户到账了一笔大钱。' },
      { text: '找个队友一起干', check: (s) => s.hack >= 35, effect: { credits: 20, rep: 5, hack: -5 }, result: '你联系了一位暗网老手，一起分担风险。成功了一半，也算不错。' },
      { text: '无视它', effect: {}, result: '"这种事还是留给那些不怕死的人吧。"你关掉了暗网页面。' },
    ],
  },
  {
    id: 'market',
    title: '黑市交易',
    desc: '地下黑市今天格外热闹。有人卖二手赛博义体，有人兜售被窃的企业数据。你的信用点刚好够买点什么。',
    choices: [
      { text: '买黑客工具（-15 信用）', check: (s) => s.credits >= 15, effect: { credits: -15, hack: 15 }, result: '你入手了一套最新的破解工具包，手感不错。' },
      { text: '买医疗补给（-15 信用）', check: (s) => s.credits >= 15, effect: { credits: -15, hp: 20 }, result: '你囤了一些医疗纳米机器人和止痛剂。' },
      { text: '逛逛不买东西', effect: {}, result: '你逛了一圈，什么都没买就离开了。' },
    ],
  },
  {
    id: 'media',
    title: '被盯上了',
    desc: '你发现自己的照片出现在了一个本地地下新闻网站上，标题是《城市新晋赛博佣兵》——有人在关注你的一举一动。',
    choices: [
      { text: '追查是谁写的', check: (s) => s.hack >= 25, effect: { hack: -5, rep: 10 }, result: '你追踪到了文章来源，是一个自由记者。你给他匿名发了一些独家信息，他把你写得更好看了。' },
      { text: '利用曝光接更多活', effect: { rep: 15, credits: 10 }, result: '你顺势而为，在评论区留下联系方式。两天内接到了三个新单子。' },
      { text: '保持低调', effect: { rep: -5 }, result: '你不喜欢这种关注，删除了所有社交媒体账号。' },
    ],
  },
  {
    id: 'corpo_raid',
    title: '公司突袭',
    desc: '半夜你被一阵嘈杂声吵醒——荒坂的安保小队正在对你所在的大楼进行"安全排查"。你只有几分钟时间决定怎么办。',
    choices: [
      { text: '黑掉大厦监控系统', check: (s) => s.hack >= 40, effect: { hack: -10, hp: -5 }, result: '你成功删除了所有包含你的监控记录。安全小队从你门口经过，没有停留。' },
      { text: '从消防通道溜走', effect: { hp: -10 }, result: '你从消防通道跑下去，但摔了一跤。不过你成功离开了大楼。' },
      { text: '躲在屋里', check: () => Math.random() > 0.5, effect: { hp: -30, credits: -20 }, result: '他们闯进了你的房间，搜查了一番还拿走了你的一部分信用点。"算你走运，只是搜查。"', failResult: '他们破门而入，找到了你的非法义体文件。你被揍了一顿，信用点也被没收了。', failEffect: { hp: -50, credits: -40 } },
    ],
  },
  {
    id: 'ai_shard',
    title: '被遗弃的 AI 碎片',
    desc: '你在数据废料中发现了一个被分割的AI意识碎片。它用冰冷的合成声音对你说话了。"帮我重组完整，我会报答你。"',
    choices: [
      { text: '尝试重组', check: (s) => s.hack >= 55, effect: { hack: 20, rep: 15 }, result: '你成功重组了这个AI。它自称"零号"，给了你一套罕见的加密算法就走了。"后会有期。"' },
      { text: '隔离并分析', check: (s) => s.hack >= 30, effect: { hack: 10 }, result: '你没敢完全放开权限，但你还是从中学到了一些精妙的代码结构。' },
      { text: '立即删除', effect: {}, result: '"失控的AI是最大的威胁。"你把它隔离到离线存储器里。' },
    ],
  },
];

// ── 初始化 ──
let selectedOrigin = null;

$$('.origin-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.origin-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOrigin = btn.dataset.origin;
    $('#start-btn').disabled = !$('#name-input').value.trim() || !selectedOrigin;
  });
});

$('#name-input').addEventListener('input', () => {
  $('#start-btn').disabled = !$('#name-input').value.trim() || !selectedOrigin;
});

$('#start-btn').addEventListener('click', startGame);
$('#restart-btn').addEventListener('click', restartGame);
$('#history-btn-start').addEventListener('click', () => $('#history-btn').click());

// ── 开始游戏 ──
function startGame() {
  setApiKey($('#apikey-input').value.trim());
  state.name = $('#name-input').value.trim() || '无名';
  state.origin = selectedOrigin;
  const origin = origins[selectedOrigin];
  state.hp = 100 + origin.hp;
  state.credits = 50 + origin.credits;
  state.rep = 50 + origin.rep;
  state.hack = 50 + origin.hack;
  state.day = 1;
  state.alive = true;
  state.log = [];

  showScreen('game-screen');
  addLog(`<b>${state.name}</b>，欢迎来到夜之城。`, 'system');
  addLog(origin.desc, 'system');
  updateUI();
  newDay();
}

// ── LLM 动态生成事件 ──
async function llmGenerateEvent() {
  const apiKey = getApiKey();
  const prompt = `你是赛博朋克夜之城的叙事AI。根据以下玩家状态，生成一个事件。

玩家代号：${state.name}
出身背景：${{corpo:'公司狗',hacker:'网络黑客',nomad:'废土游民'}[state.origin]}
存活天数：第 ${state.day} 天
当前属性：生命 ${state.hp}/100 | 信用 ${state.credits}/100 | 声望 ${state.rep}/100 | 黑客技能 ${state.hack}/100
昨日事件：${state.log.filter(e => e.type !== 'system').slice(-3).map(e => e.text).join('；') || '无'}

要求：
1. 事件要符合赛博朋克世界观，与玩家的出身、状态、天数有呼应
2. 提供2-3个选项，选项间要有权衡（高风险高回报 vs 保守）
3. 属性影响值在 -25 到 +25 之间
4. 严格返回纯 JSON（不要 markdown 代码块），格式如下：

{"title":"事件标题","desc":"事件叙述（中式赛博朋克风格，2-3句）","choices":[{"text":"选项文字","effect":{"hp":0,"credits":0,"rep":0,"hack":0},"result":"执行结果描述"}...]}`;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 800,
    }),
  });

  const data = await res.json();
  const text = data.choices[0].message.content;
  // 兼容 LLM 偶尔包 markdown 代码块
  const json = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(json);
}

// ── 每天推进 ──
async function newDay() {
  if (!state.alive) return;
  $('#day-num').textContent = `第 ${state.day} 天`;
  $('#next-btn').classList.add('hidden');
  $('#choices').innerHTML = '';

  addLog(`── 第 ${state.day} 天 ──`, 'system');

  const apiKey = getApiKey();
  let evt = null;

  if (apiKey) {
    addLog('⏳ 正在生成剧情...', 'system');
    try {
      evt = await llmGenerateEvent();
      addLog(evt.title, 'event');
      addLog(evt.desc + ' <span class="ai-badge">AI 生成</span>', 'system');
    } catch (e) {
      console.error('LLM 生成失败:', e);
      const reason = e.message.includes('Failed to fetch') ? '网络连接失败（可能是 CORS 跨域拦截）' : e.message;
      addLog(`⚠ AI 生成失败：${reason}，切换到预设事件`, 'bad');
      evt = null;
    }
  }

  if (!evt) {
    const pool = events.filter((e) => {
      if (state.day < 3 && e.id === 'ai_shard') return false;
      if (e.id === 'corpo_raid' && state.day < 2) return false;
      return true;
    });
    evt = pool[Math.floor(Math.random() * pool.length)];
    addLog(evt.title, 'event');
    addLog(evt.desc, 'system');
  }

  renderChoices(evt);
}

// ── 渲染选项 ──
function renderChoices(evt) {
  const container = $('#choices');
  container.innerHTML = '';

  evt.choices.forEach((ch) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = ch.text;

    if (ch.check && !ch.check(state)) {
      btn.disabled = true;
      btn.style.opacity = '0.3';
      btn.style.cursor = 'not-allowed';
    }

    btn.addEventListener('click', () => resolveEvent(ch, evt));
    container.appendChild(btn);
  });
}

// ── 处理事件结果 ──
function resolveEvent(choice, evt) {
  let effect = { ...choice.effect };
  let result = choice.result;

  // 处理失败分支
  if (choice.check && choice.failEffect && !choice.check(state)) {
    effect = { ...choice.failEffect };
    result = choice.failResult || result;
  }

  applyEffect(effect);
  addLog(result, effect.hp < 0 || (choice.failEffect && choice.failEffect.hp) ? 'bad' : 'good');

  // 当日额外随机事件（30%概率）
  if (Math.random() < 0.3 && state.alive) {
    bonusEvent();
  }

  $('#choices').innerHTML = '';
  if (state.alive) $('#next-btn').classList.remove('hidden');
}

// ── 额外小事件 ──
function bonusEvent() {
  const pool = [
    { text: '你在街上捡到了一些散落的信用点。', effect: { credits: 5 } },
    { text: '一个陌生人在路上对你点了点头——看起来你有点名气了。', effect: { rep: 5 } },
    { text: '你踩到一片碎玻璃，划破了脚。', effect: { hp: -5 } },
    { text: '你发现路边有人在免费发放合成营养棒。', effect: { hp: 5 } },
    { text: '一个小孩偷了你的钱包，但你追回来了。', effect: {} },
    { text: '一场酸雨让你的电子设备出了点小故障。', effect: { hack: -5 } },
  ];
  const evt = pool[Math.floor(Math.random() * pool.length)];
  applyEffect(evt.effect);
  const type = (evt.effect.hp || 0) < 0 ? 'bad' : 'good';
  addLog(evt.text, type);
}

// ── 应用效果 ──
function applyEffect(effect) {
  state.hp = Math.max(0, Math.min(100, state.hp + (effect.hp || 0)));
  state.credits = Math.max(0, Math.min(100, state.credits + (effect.credits || 0)));
  state.rep = Math.max(0, Math.min(100, state.rep + (effect.rep || 0)));
  state.hack = Math.max(0, Math.min(100, state.hack + (effect.hack || 0)));
  updateUI();

  if (state.hp <= 0) {
    state.alive = false;
    gameOver('你的生命值降至零点。赛博空间里又多了一个被遗忘的灵魂。');
  }
  if (state.credits <= 0) {
    state.alive = false;
    gameOver('信用点耗尽，你无法在城市里生存下去。你沦为了街头流浪者。');
  }
}

// ── 更新 UI ──
function updateUI() {
  $('#hp-bar').style.width = state.hp + '%';
  $('#hp-text').textContent = state.hp;
  $('#credits-bar').style.width = state.credits + '%';
  $('#credits-text').textContent = state.credits;
  $('#rep-bar').style.width = state.rep + '%';
  $('#rep-text').textContent = state.rep;
  $('#hack-bar').style.width = state.hack + '%';
  $('#hack-text').textContent = state.hack;
}

// ── 添加日志 ──
function addLog(text, type) {
  state.log.push({ text, type });
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  el.innerHTML = text;
  $('#log').appendChild(el);
  $('#log').scrollTop = $('#log').scrollHeight;
}

// ── 下一天 ──
$('#next-btn').addEventListener('click', () => {
  if (!state.alive) return;
  state.day++;
  // 每5天自动扣一点点
  if (state.day % 5 === 0) {
    applyEffect({ credits: -5 });
    addLog('你支付了这个周期的基础生活费用（-5 信用点）。', 'system');
    if (!state.alive) return;
  }
  // 每日微损
  applyEffect({ hp: -2 });
  newDay();
});

// ── 游戏结束 ──
async function gameOver(epitaph) {
  showScreen('end-screen');
  $('#end-epitaph').textContent = epitaph;
  $('#end-title').setAttribute('data-text', 'GAME OVER');
  $('#end-title').textContent = 'GAME OVER';

  const score = state.day * 10 + state.rep + state.credits;
  const endStats = $('#end-stats');
  endStats.innerHTML = `
    <div class="stat-row"><span>代号</span><span>${state.name}</span></div>
    <div class="stat-row"><span>出身</span><span>${origins[state.origin] ? {corpo:'公司狗',hacker:'网络黑客',nomad:'废土游民'}[state.origin] : ''}</span></div>
    <div class="stat-row"><span>存活天数</span><span>${state.day} 天</span></div>
    <div class="stat-row"><span>生命值</span><span>${state.hp}</span></div>
    <div class="stat-row"><span>信用点</span><span>${state.credits}</span></div>
    <div class="stat-row"><span>声望</span><span>${state.rep}</span></div>
    <div class="stat-row"><span>黑客技能</span><span>${state.hack}</span></div>
    <div class="stat-row"><span>综合评分</span><span>${score}</span></div>
  `;

  // 存入 IndexedDB
  const record = {
    name: state.name,
    origin: state.origin,
    originLabel: {corpo:'公司狗',hacker:'网络黑客',nomad:'废土游民'}[state.origin],
    day: state.day,
    hp: state.hp,
    credits: state.credits,
    rep: state.rep,
    hack: state.hack,
    score: score,
    death: epitaph,
    time: new Date().toLocaleString('zh-CN'),
  };
  await saveRecord(record);
}

// ── 切换画面 ──
function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
}

// ── 历史记录 ──
$('#history-btn').addEventListener('click', async () => {
  showScreen('history-screen');
  const records = await getAllRecords();
  const list = $('#history-list');
  const empty = $('#history-empty');

  if (records.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = records.map((r) => `
      <div class="history-card">
        <div>
          <div class="card-name">${r.name}</div>
          <div class="card-date">${r.time}</div>
        </div>
        <div class="card-score">${r.score}</div>
        <div class="card-stats">
          <span>🏷️ ${r.originLabel}</span>
          <span>📆 ${r.day}天</span>
          <span>❤️ ${r.hp}</span>
          <span>₿ ${r.credits}</span>
          <span>⭐ ${r.rep}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="card-death">💀 ${r.death}</span>
          <button class="card-delete" data-id="${r.id}">删除</button>
        </div>
      </div>
    `).join('');

    // 绑定删除按钮
    list.querySelectorAll('.card-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteRecord(Number(btn.dataset.id));
        $('#history-btn').click(); // 刷新列表
      });
    });
  }
});

$('#back-btn').addEventListener('click', () => {
  showScreen('start-screen');
});

// ── 重新开始 ──
function restartGame() {
  state.name = ''; state.origin = ''; state.day = 1;
  state.hp = 100; state.credits = 50; state.rep = 50; state.hack = 50;
  state.alive = true; state.log = [];
  selectedOrigin = null;
  $$('.origin-btn').forEach((b) => b.classList.remove('selected'));
  $('#name-input').value = '';
  $('#start-btn').disabled = true;
  $('#log').innerHTML = '';
  $('#choices').innerHTML = '';
  $('#next-btn').classList.add('hidden');
  showScreen('start-screen');
}
