/**
 * 전/후 비교 페이지 만들기 (개발 검증 전용)
 * 사용: node tools/compare.js <이전 캡처 폴더> <이후 캡처 폴더> <출력 폴더>
 * 같은 장면의 이전/이후 PNG를 골라 출력 폴더에 복사하고 비교.html 을 만든다.
 */
const fs = require('fs'), path = require('path');
const [BEFORE, AFTER, OUT] = process.argv.slice(2).map(p => path.resolve(p));
fs.mkdirSync(path.join(OUT, 'before'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'after'), { recursive: true });

// [제목, 이전 파일, 이후 파일, 종류(m=모바일 390, w=넓은 화면)]
const PAIRS = [
  ['시작 화면', 'splash.m', 'splash.m', 'm'],
  ['정보 등록 (첫 화면)', 'onboarding.m', 'onboarding.m', 'm'],
  ['정보 등록 (전체)', 'onboarding.mfull', 'onboarding.mfull', 'm'],
  ['오늘의 운세 (첫 화면)', 'home-real.m', 'home-real.m', 'm'],
  ['오늘의 운세 (전체)', 'home-real.mfull', 'home-real.mfull', 'm'],
  ['오늘의 운세 · 아직 없음', 'home-pending.m', 'home-pending.m', 'm'],
  ['전체 순위', 'ranking-real.m', 'ranking-real.m', 'm'],
  ['별자리 상세', 'detail.m', 'detail.m', 'm'],
  ['운세 기록 (달력)', 'history.m', 'history.m', 'm'],
  ['AI 도우미', 'ai.m', 'ai.m', 'm'],
  ['마이페이지 (전체)', 'mypage.mfull', 'mypage.mfull', 'm'],
  ['공유 카드 (새 화면)', null, 'share.m', 'm'],
  ['태블릿 · 전체 순위', 'ranking-real.t', 'ranking-real.t', 'w'],
  ['데스크톱 · 오늘의 운세', 'home.d', 'home.d', 'w'],
  ['가장 좁은 폰(320px) · 오늘의 운세', 'home.narrow', 'home.narrow', 'm'],
];
const img = (dir, file, kind) => file && fs.existsSync(path.join(dir === 'before' ? BEFORE : AFTER, file + '.png'))
  ? (fs.copyFileSync(path.join(dir === 'before' ? BEFORE : AFTER, file + '.png'), path.join(OUT, dir, file + '.png')),
    `<div class="shot ${kind}"><img src="${dir}/${file}.png" alt="${dir === 'before' ? '이전' : '이후'} 화면" ${kind === 'm' ? '' : ''}></div>`)
  : '<div class="shot none">이전에는 없던 화면</div>';

const rows = PAIRS.map(([title, b, a, kind]) => `<section><h2>${title}</h2><div class="pair">
  <figure><figcaption>이전</figcaption>${img('before', b, kind)}</figure>
  <figure><figcaption>이후</figcaption>${img('after', a, kind)}</figure></div></section>`).join('\n');

fs.writeFileSync(path.join(OUT, '비교.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>별하루 디자인 전/후 비교</title>
<style>
  body{margin:0;padding:24px;background:#0A1129;color:#F5F7FF;font-family:'Pretendard Variable',Pretendard,'Malgun Gothic',system-ui,sans-serif}
  h1{font-size:26px;margin:0 0 4px} p.sub{color:#BAC7E7;margin:0 0 28px}
  section{margin:0 0 48px} h2{font-size:20px;margin:0 0 12px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
  figure{margin:0} figcaption{margin:0 0 8px;font-weight:700;color:#F3D58D}
  figure:first-child figcaption{color:#9AA8D0}
  .shot{overflow:hidden;border-radius:12px;border:1px solid rgba(186,199,231,.2);background:#000}
  .shot.m img{display:block;width:500px;max-width:none;margin-left:-55px}      /* 폭 500px 캡처에서 좌우 회색 여백(55px)을 잘라 390px 화면만 보여줌 */
  .shot.m{width:390px;max-width:100%} .shot.w img{display:block;width:100%}
  .shot.none{display:grid;place-items:center;height:240px;color:#9AA8D0}
  @media (max-width:900px){.pair{grid-template-columns:1fr}}
</style>
<h1>별하루 디자인 전/후 비교</h1><p class="sub">같은 화면을 같은 데이터로 실제 브라우저(Edge)에서 캡처했어요. 왼쪽이 이전(현재 앱), 오른쪽이 새 디자인이에요.</p>
${rows}
</html>`);
console.log('만들었어요 →', path.join(OUT, '비교.html'));
