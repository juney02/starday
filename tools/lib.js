/**
 * 화면 점검 도구의 공통 부분 (개발 검증 전용 — 앱에는 포함되지 않는다)
 * - src/ 의 실제 화면 코드를 읽어 가짜 google.script.run 데이터와 함께 정적 HTML로 만든다.
 * - 서버 데이터는 tests/harness.js 의 가짜 시트 환경에서 실제 서버 코드(.gs)를 실행해 얻는다.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { makeEnv, SRC } = require('../tests/harness.js');

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const TODAY = '2026-10-16';
const toUrl = f => 'file:///' + f.split('\\').join('/');

const env = makeEnv(); env.setNow(TODAY + ' 09:00');
const dayData = d => env.call(`getHoroscopes(${JSON.stringify(d)})`);

// 실제 공식 데이터처럼 "제목 없이 여러 줄 설명 + 행운 항목"만 있는 형태 (미리보기용 가상 문장)
function realLike(res) {
  const lines = [['새로운 발견에 두근두근한 하루', '활동적으로 보내면 좋아요', '행동 범위를 넓혀 보세요'], ['필요한 정보가 손에 들어올 수 있어요', '잡지나 인터넷을 확인해 보세요'], ['평가가 쑥 올라가는 날이에요', '의견을 또렷하게 전하면 좋아요']];
  res.items.forEach((it, i) => { it.title_ko = ''; it.content_ko = lines[i % 3].join('\n'); it.source_name = '朝日放送テレビ「おはよう朝日です」公式サイト'; it.lucky_color = i % 2 ? '' : '하늘색'; });
  res.status = 'PUBLISHED'; res.isMock = false;
  return res;
}
const pending = () => ({ status: 'PENDING', date: TODAY, items: [], isMock: false, message: '오늘의 오하아사 운세가 아직 업데이트되지 않았어요. 공식 게시물을 확인한 뒤 반영됩니다.', official: { url: 'https://www.asahi.co.jp/ohaasa/week/horoscope/', publishedAt: '' }, version: 'P' });
const linkOnly = () => ({ status: 'LINK_ONLY', date: TODAY, items: [], isMock: false, message: '운세를 확인했어요. 이용 허락 전이라 링크만 제공합니다.', official: { url: 'https://www.asahi.co.jp/ohaasa/week/horoscope/', publishedAt: '2026-10-16 08:00' }, version: 'L' });

function datasets(variant) {
  const data = {};
  for (let d = 1; d <= 31; d++) { const ds = '2026-10-' + String(d).padStart(2, '0'); if (ds <= TODAY) data[ds] = dayData(ds); }
  if (variant === 'real') Object.keys(data).forEach(k => realLike(data[k]));
  if (variant === 'pending') data[TODAY] = pending();
  if (variant === 'linkonly') data[TODAY] = linkOnly();
  if (variant === 'weekend') data[TODAY] = { status: 'PENDING', date: TODAY, items: [], isMock: false, weekend: true, message: '오늘은 오하아사 운세가 공개되지 않았어요', comfort: env.call(`weekendComfort_('2026-10-17')`), note: '오하아사는 토·일요일에 쉬고, 월요일 아침에 새 운세로 돌아와요.', official: null, version: 'W' };
  return data;
}

/** 정적 HTML 만들기. scene.after = 화면이 뜬 뒤 실행할 코드, extra = 점검용 코드 */
function compose(scene, extra) {
  const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  let html = read('Index').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n));
  const profile = scene.profile === false ? null : { sign: 'aquarius', birthDate: '2000-02-05', birthTime: '08:30', birthTimeUnknown: false, notify: true };
  const pre = `<script>
    try { localStorage.clear(); ${profile ? `localStorage.setItem('byeolharu.profile.v1', ${JSON.stringify(JSON.stringify(profile))});` : ''} } catch (e) {}
    const DATA = ${JSON.stringify(datasets(scene.variant))};
    const TODAY = ${JSON.stringify(TODAY)};
    const H = {
      getHoroscopes: d => DATA[d || TODAY] || { status: 'NODATA', date: d, items: [], message: '운세 기록 없음', isMock: false },
      getAvailableDates: m => ({ dates: Object.keys(DATA).filter(k => k.slice(0, 7) === m), mock: ${scene.variant !== 'real'}, retentionDays: 30 }),
      aiChat: r => ({ ok: true, reply: '오늘 물병자리는 3위예요. 새로운 일을 시작하기에 좋은 날이라고 해요.\\n1. 미뤄 둔 일 중 가장 작은 것부터 시작해 보세요.\\n2. 오후에는 가볍게 산책하며 생각을 정리해 보세요.\\n이 내용은 AI 의견(참고용)이에요.', tools: ['get_horoscope'], remaining: 49 }),
    };
    (function () {
      const mk = (ok, fail) => new Proxy({}, { get(_, p) {
        if (p === 'withSuccessHandler') return f => mk(f, fail);
        if (p === 'withFailureHandler') return f => mk(ok, f);
        return a => setTimeout(() => { try { ok(H[p](a)); } catch (e) { fail({ message: e.message }); } }, ${scene.latency || 30});
      } });
      window.google = { script: { run: mk() } };
    })();
  </script>`;
  const post = `<script>${scene.after || ''}</script>${extra ? `<script>${extra}</script>` : ''}`;
  html = html.replace('<script>\n/* ===== 공통 코드', pre + '\n<script>\n/* ===== 공통 코드');
  // 점검·캡처용: 애니메이션은 가상 시계에서 멈춰 "투명한 첫 프레임"이 찍히거나 측정되는 일이 있어서, 끝난 상태로 고정한다
  html = html.replace('</head>', '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>');
  return html.replace('</body>', post + '</body>');
}

/* ---------- 장면 목록 ---------- */
const SCENES = [
  { name: 'splash', profile: false },
  { name: 'onboarding', profile: false, after: `setTimeout(() => go('onboarding'), 80);` },
  { name: 'home', variant: 'mock' },
  { name: 'home-real', variant: 'real' },
  { name: 'home-pending', variant: 'pending' },
  { name: 'home-linkonly', variant: 'linkonly' },
  { name: 'home-weekend', variant: 'weekend' },
  { name: 'ranking', variant: 'mock', after: `setTimeout(() => go('ranking'), 120);` },
  { name: 'ranking-real', variant: 'real', after: `setTimeout(() => go('ranking'), 120);` },
  { name: 'detail', variant: 'real', after: `setTimeout(() => go('detail', 'leo'), 120);` },
  { name: 'history', variant: 'mock', after: `setTimeout(() => { go('history'); setTimeout(() => pickDate('2026-10-14'), 150); }, 80);` },
  { name: 'ai', variant: 'mock', after: `setTimeout(() => { App.chat.messages = [{role:'user',text:'오늘 내 운세를 쉽게 풀어줘'},{role:'assistant',text:'오늘 물병자리는 3위예요. 새로운 일을 시작하기에 좋은 날이라고 해요.\\n1. 미뤄 둔 일 중 가장 작은 것부터 시작해 보세요.\\n2. 오후에는 가볍게 산책하며 생각을 정리해 보세요.\\n이 내용은 AI 의견(참고용)이에요.',tools:['get_horoscope']}]; go('ai'); }, 80);` },
  { name: 'ai-empty', variant: 'mock', after: `setTimeout(() => go('ai'), 80);` },
  { name: 'mypage', variant: 'mock', after: `setTimeout(() => go('mypage'), 80);` },
  { name: 'sheet', variant: 'mock', after: `setTimeout(() => { go('mypage'); setTimeout(() => ACTIONS['sheet-privacy'](), 120); }, 80);` },
  { name: 'share', variant: 'mock', after: `setTimeout(() => go('share'), 120);` },
  // 점검 도구가 제대로 잡아내는지 시험하는 장면 (일부러 문제를 넣음. 이름을 직접 지정할 때만 실행)
  { name: 'selftest', selftest: true, variant: 'mock', after: `setTimeout(() => { go('home'); setTimeout(() => { document.querySelector('.page').insertAdjacentHTML('beforeend', '<div style="font-size:9px">작은글자</div><button style="width:20px;height:20px">x</button><button style="width:40px;height:40px">y</button><div style="width:900px;height:10px;background:red"></div><p style="color:#445">낮은 대비 글자</p>'); }, 200); }, 80);` },
];
const VIEWPORTS = [
  { tag: 'm', w: 390, h: 844 },      // 모바일(첫 화면)
  { tag: 'mfull', w: 390, h: 2000 }, // 모바일(스크롤 전체)
  { tag: 'narrow', w: 320, h: 700 }, // 가장 좁은 폰
  { tag: 't', w: 820, h: 1180 },     // 태블릿
  { tag: 'd', w: 1280, h: 860 },     // 데스크톱
];

/** 바깥 페이지(iframe으로 정확한 너비를 보장) 만들기. Edge 헤드리스는 창 너비를 약 500px 아래로 줄이지 못한다. */
function frameFor(file, w, h) {
  const target = file.replace(/\.html$/, `.${w}x${h}.frame.html`);
  fs.writeFileSync(target, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#555"><iframe id="f" src="${toUrl(file)}" style="width:${w}px;height:${h}px;border:0;display:block;margin:0 auto;background:#000"></iframe>
<script>addEventListener('message', function (e) { if (typeof e.data === 'string' && e.data.indexOf('__audit__') === 0) document.body.insertAdjacentHTML('beforeend', '<pre id="__audit">' + e.data.slice(9).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>'); });</script></body>`);
  return target;
}

module.exports = { fs, path, cp, EDGE, TODAY, toUrl, compose, SCENES, VIEWPORTS, frameFor };
