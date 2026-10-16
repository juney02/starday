// 디자인 시스템·접근성 테스트: 디자인 규칙이 지켜지는지 자동으로 확인한다
//  1) 스타일 시트 정적 검사: 토큰, 글자 크기, 대비(WCAG), 라이트 모드 토큰, 동작 줄이기, 포커스, 반응형 기준점
//  2) 화면 구조 검사(가상 브라우저): 랜드마크, 제목, 라벨, 포커스 이동, 바텀시트, 오류 안내, 공유 카드 규칙
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { makeEnv, SRC } = require('./harness.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));
const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
const css = read('Styles');

/* ================= 1) 스타일 시트 정적 검사 ================= */
const block = (re) => { const m = re.exec(css); if (!m) return ''; let i = css.indexOf('{', m.index) + 1, d = 1, s = i; while (d && i < css.length) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; } return css.slice(s, i - 1); };
const tokensOf = text => { const o = {}; text.replace(/--([a-z0-9-]+):\s*([^;]+);/g, (_, k, v) => { o[k] = v.trim(); }); return o; };
const dark = tokensOf(block(/^:root \{/m));
const light = tokensOf(block(/:root\[data-theme="light"\] \{/));

// 필수 토큰이 모두 있는가
['c-bg', 'c-bg-deep', 'c-surface', 'c-surface-2', 'c-text', 'c-text-2', 'c-text-3', 'c-gold', 'c-on-gold', 'c-danger', 'c-ok', 'c-focus',
  'fs-rank', 'fs-title', 'fs-card', 'fs-body', 'fs-sub', 'fs-meta', 's1', 's4', 's6', 's9', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill',
  'sh-1', 'sh-2', 'sh-3', 'd-fast', 'd-base', 'd-slow', 'ease', 'page-x'].forEach(k => ok(k in dark, `토큰 정의: --${k}`));
ok(dark['c-bg'].toUpperCase() === '#111A37' && dark['c-gold'].toUpperCase() === '#F3D58D' && dark['c-text-2'].toUpperCase() === '#BAC7E7', '브랜드 기준색(배경 #111A37, 골드 #F3D58D, 보조 #BAC7E7) 유지');
// 라이트 모드 토큰이 다크 색 토큰과 같은 이름 집합으로 준비되어 있는가
const colorKeys = Object.keys(dark).filter(k => /^c-/.test(k));
ok(colorKeys.every(k => k in light), '라이트 모드: 모든 색 토큰이 준비됨 (없는 것: ' + colorKeys.filter(k => !(k in light)).join(',') + ')');
ok(/\.2s|--d-fast:\s*150ms/.test(css) && /--d-base:\s*220ms/.test(css) && /--d-slow:\s*300ms/.test(css), '모션 토큰: 150·220·300ms');

// 모든 글자 크기가 12px 이상인가 (rem=16px, 토큰·clamp 해석)
const px = v => { v = v.trim(); let m;
  const tok = /^var\(--([a-z0-9-]+)\)$/.exec(v); if (tok) return px(dark[tok[1]] || '0');
  if ((m = /^clamp\(\s*([^,]+),/.exec(v))) return px(m[1]);
  if ((m = /^([\d.]+)rem$/.exec(v))) return parseFloat(m[1]) * 16;
  if ((m = /^([\d.]+)px$/.exec(v))) return parseFloat(m[1]);
  return null; };
const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map(m => [m[1], px(m[1])]);
ok(sizes.length > 30, `글자 크기 선언 ${sizes.length}개를 검사`);
sizes.forEach(([raw, v]) => ok(v === null || v >= 11.99, `글자 크기 12px 이상: ${raw} = ${v}px`));
ok(px(dark['fs-body']) === 16 && px(dark['fs-sub']) === 14 && px(dark['fs-meta']) === 12 && px(dark['fs-title']) === 26 && px(dark['fs-card']) === 20, '글자 크기 체계: 본문16·보조14·메타12·제목26·카드제목20');
ok(/--fs-rank:\s*clamp\(3\.25rem,\s*14vw,\s*4\.5rem\)/.test(css), '순위 숫자: 52~72px (clamp)');
ok(/font-size:\s*100%/.test(css) || !/html\s*\{[^}]*font-size:\s*\d+px/.test(css), '글자 크기를 px로 고정하지 않음(사용자 설정 존중)');

// WCAG 대비 계산
const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgba2 = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
const col = v => { v = v.trim(); if (v[0] === '#') return { c: hex2rgb(v), a: 1 }; return rgba2(v); };
const blend = (f, a, b) => [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a));
const lum = c => { const a = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
function checkTheme(name, T) {
  const C = k => col(T[k]);
  const bgs = { '배경': C('c-bg').c, '깊은 배경': C('c-bg-deep').c, '카드': C('c-surface').c, '입력/선택면': C('c-surface-2').c, '호버면': C('c-surface-3').c };
  // 일반 텍스트(4.5:1)
  [['c-text', '본문'], ['c-text-2', '보조'], ['c-text-3', '메타']].forEach(([k, label]) => Object.entries(bgs).forEach(([bn, b]) => {
    if (k === 'c-text-3' && bn === '호버면') return;                          // 메타 글자는 호버면 위에 놓이지 않는다
    ok(ratio(C(k).c, b) >= 4.5, `[${name}] ${label}(${T[k]}) on ${bn}: ${ratio(C(k).c, b).toFixed(2)}:1 ≥ 4.5`);
  }));
  ok(ratio(C('c-gold').c, C('c-bg').c) >= 4.5 && ratio(C('c-gold').c, C('c-surface').c) >= 4.5, `[${name}] 골드 글자 on 배경·카드 ≥ 4.5`);
  ok(ratio(C('c-on-gold').c, C('c-gold').c) >= 4.5, `[${name}] 골드 버튼 글자 ${ratio(C('c-on-gold').c, C('c-gold').c).toFixed(2)}:1 ≥ 4.5`);
  const gs = C('c-gold-soft'); ['c-bg', 'c-surface'].forEach(k => { const under = C(k).c, mixed = blend(gs.c, gs.a, under); ok(ratio(C('c-gold').c, mixed) >= 4.5, `[${name}] 골드 글자 on 연한 골드면(${k}) ≥ 4.5`); });
  ['c-surface', 'c-bg'].forEach(k => { ok(ratio(C('c-danger').c, C(k).c) >= 4.5, `[${name}] 오류색 on ${k} ≥ 4.5`); ok(ratio(C('c-ok').c, C(k).c) >= 4.5, `[${name}] 성공색 on ${k} ≥ 4.5`); });
  ok(ratio(C('c-focus').c, C('c-bg').c) >= 3 && ratio(C('c-focus').c, C('c-surface').c) >= 3, `[${name}] 포커스 링 ≥ 3:1`);
  ok(ratio(C('c-gold').c, C('c-surface-2').c) >= 3, `[${name}] 선택 테두리(골드) on 선택면 ≥ 3`);
  const sil = C('c-silver').c, bro = C('c-bronze').c; // 2·3위 원형 배지: 배지색 위 글자 대비
  const badgeText = name === '다크' ? [26, 33, 66] : C('c-surface').c;
  ok(ratio(badgeText, sil) >= 4.5 && ratio(badgeText, bro) >= 4.5, `[${name}] 2·3위 배지 숫자 대비 ≥ 4.5`);
}
checkTheme('다크', dark); checkTheme('라이트', light);
// 흰 글자 대비가 가장 약한 헤더 영역: 히어로 그라데이션 시작색 위
ok(ratio(hex2rgb('#F5F7FF'), hex2rgb('#223056')) >= 7 && ratio(col(dark['c-text-2']).c, hex2rgb('#223056')) >= 4.5, '히어로 그라데이션(#223056) 위 글자 대비');

// 동작 줄이기·포커스·반응형
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: \.01ms[\s\S]*transition-duration: \.01ms/.test(css), '동작 줄이기: 애니메이션·전환 즉시 처리');
ok(/:focus-visible\s*\{\s*outline:\s*3px solid var\(--c-focus\)/.test(css), '키보드 포커스 링 3px');
ok(/\.skip-link/.test(css) && /\.sr-only/.test(css), '스킵 링크·스크린리더 전용 클래스');
ok(/@media \(max-width: 359px\)/.test(css) && /@media \(min-width: 640px\)/.test(css) && /@media \(min-width: 1024px\)/.test(css), '반응형 기준점: 320대·태블릿 640·데스크톱 1024');
ok(/@media \(min-width: 1024px\)[\s\S]*#nav\.show \{[^}]*flex-direction: column/.test(css), '데스크톱: 좌측 사이드 내비');
ok(/@media \(prefers-contrast: more\)/.test(css), '고대비 설정 대응');
ok(/min-height: 3rem/.test(css) && /min-height: 3\.5rem/.test(css) && /width: 2\.75rem; height: 2\.75rem/.test(css), '터치 영역: 버튼 48·56px, 아이콘 버튼 44px');

// 같은 기능의 버튼은 같은 스타일: 화면 코드에서 쓰는 .btn 변형이 디자인 시스템에 정의된 것뿐인가
const app = read('JsApp'), core = read('JsCore');
const allowed = new Set(['btn', 'btn-lg', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-sm', 'is-loading']);
const used = new Set([...app.replace(/\$\{[^}]*\}/g, ' ').matchAll(/class="([^"]*\bbtn\b[^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => /^btn/.test(c)));   // ${...} 코드 조각은 빼고 클래스만 본다
ok([...used].every(c => allowed.has(c)), `버튼 변형은 정의된 것만 사용: ${[...used].join(', ')}`);
ok([...allowed].filter(c => c !== 'btn' && c !== 'is-loading').every(c => new RegExp('\\.' + c + '\\b').test(css)), '버튼 변형이 모두 스타일에 정의됨');
ok(!/style="[^"]*(background|color)\s*:/.test(app.replace(/style="[^"]*var\(--[^"]*"/g, '')), '화면 코드에 임의의 색 지정(인라인) 없음');
const hexOutside = css.replace(/:root\s*\{[\s\S]*?\}\s*/, '').replace(/:root\[data-theme="light"\]\s*\{[\s\S]*?\}\s*/, '');
ok(((hexOutside.match(/#[0-9a-fA-F]{6}\b/g) || []).length) <= 12, `토큰 밖 하드코딩 색상이 적음 (${(hexOutside.match(/#[0-9a-fA-F]{6}\b/g) || []).length}개)`);
ok(/pretendard/i.test(read('Index')) && /Noto\+Sans\+Symbols/.test(read('Index')) && /lang="ko"/.test(read('Index')) && /viewport-fit=cover/.test(read('Index')), '글꼴(Pretendard·기호 글꼴)·언어·Safe Area 설정');
ok(/include\('AdminStyles'\)/.test(read('Admin')), '관리자 화면은 별도 스타일(AdminStyles)을 써서 영향 없음');

/* ================= 2) 화면 구조 검사 (가상 브라우저) ================= */
function open(env, profile) {
  const html = read('Index').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n)).replace(/<link[^>]*(fonts|jsdelivr)[^>]*>/g, '');
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/macros/s/x/exec', beforeParse(w) {
    w.Date = env.ctx.Date; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
    if (profile) w.localStorage.setItem('byeolharu.profile.v1', JSON.stringify(profile));
    const mk = (o, f) => new Proxy({}, { get(_, p) { if (p === 'withSuccessHandler') return x => mk(x, f); if (p === 'withFailureHandler') return x => mk(o, x);
      return (...a) => setTimeout(() => { try { o(env.call(`${p}(...${JSON.stringify(a)})`)); } catch (e) { f({ message: e.message }); } }, 0); } });
    w.google = { script: { run: mk() } }; w.addEventListener('error', e => errors.push(e.message)); } });
  const w = dom.window, doc = w.document;
  return { w, doc, errors, text: () => doc.querySelector('#app').textContent, click: s => { const el = doc.querySelector(s); if (!el) throw new Error('없음: ' + s); el.click(); } };
}
const key = (w, target, k, extra) => target.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, extra || {})));

(async () => {
  const env = makeEnv(); env.setNow('2026-10-16 09:00');
  const PROFILE = { sign: 'aquarius', birthDate: '2000-02-05', birthTime: '08:30', birthTimeUnknown: false, notify: true };
  const p = open(env, PROFILE); const { doc, w } = p;
  await wait(60);

  // 랜드마크와 기본 구조
  ok(doc.documentElement.lang === 'ko', 'html lang="ko"');
  const skip = doc.querySelector('a.skip-link');
  ok(skip && skip.getAttribute('href') === '#app' && /건너뛰기/.test(skip.textContent), '본문으로 건너뛰기 링크');
  ok(doc.querySelector('main#app') && doc.querySelector('nav#nav[aria-label]') && doc.querySelector('#announcer[aria-live="polite"]') && doc.querySelector('#toast[aria-live]'), '랜드마크(main·nav)와 알림 영역(aria-live)');
  ok(doc.querySelectorAll('#nav .nav-item').length === 5 && [...doc.querySelectorAll('#nav .nav-item')].every(b => b.getAttribute('aria-label')), '내비 5개 모두 접근 가능한 이름');
  ok(doc.querySelectorAll('#nav [aria-current="page"]').length === 1, '현재 화면 표시(aria-current)는 하나');
  ok([...doc.querySelectorAll('#nav .lbl-short')].every(s => s.textContent.length <= 2), '하단 내비 라벨은 짧게(2자 이내)');

  // 모든 화면 공통 점검: h1 하나, 아이콘 버튼 이름, 입력 라벨, 버튼 요소 사용
  async function audit(name, go) {
    go(); await wait(80);
    const h1s = doc.querySelectorAll('#app h1').length;
    ok(h1s === 1, `[${name}] 제목(h1)은 정확히 1개 (${h1s})`);
    ok([...doc.querySelectorAll('#app .icon-btn')].every(b => b.getAttribute('aria-label')), `[${name}] 아이콘 버튼에 접근 가능한 이름`);
    const bad = [...doc.querySelectorAll('#app input, #app textarea, #app select')].filter(i => {
      if (i.type === 'hidden') return false;
      return !(i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || (i.id && doc.querySelector(`label[for="${i.id}"]`)) || i.closest('label'));
    });
    ok(bad.length === 0, `[${name}] 모든 입력칸에 라벨 연결 (없는 것 ${bad.length}개)`);
    ok([...doc.querySelectorAll('#app [data-action]')].every(e => ['BUTTON', 'A'].includes(e.tagName)), `[${name}] 클릭 요소는 모두 button/a (키보드 사용 가능)`);
    ok(![...doc.querySelectorAll('[tabindex]')].some(e => Number(e.getAttribute('tabindex')) > 0), `[${name}] 양수 tabindex 없음`);
    ok(doc.querySelectorAll('#app img').length === 0 || [...doc.querySelectorAll('#app img')].every(i => i.hasAttribute('alt')), `[${name}] 이미지 대체 텍스트`);
  }
  await audit('홈', () => w.eval(`go('home')`));
  await audit('순위', () => w.eval(`go('ranking')`));
  await audit('상세', () => w.eval(`go('detail','leo')`));
  await audit('기록', () => w.eval(`go('history')`));
  await audit('AI', () => w.eval(`go('ai')`));
  await audit('마이페이지', () => w.eval(`go('mypage')`));
  await audit('공유', () => w.eval(`go('share')`));

  // 화면 이동: 안내 문구와 포커스 이동
  p.click('#nav [data-route=ranking]'); await wait(60);
  ok(doc.getElementById('announcer').textContent === '전체 순위', '화면 이동 시 스크린리더 안내("전체 순위")');
  ok(doc.activeElement && doc.activeElement.tagName === 'H1' && /랭킹/.test(doc.activeElement.textContent), '화면 이동 후 포커스가 새 화면의 제목으로 이동');

  // 순위 목록 접근성
  ok(doc.querySelector('ol.rank-list[aria-label]'), '순위 목록은 ol + 이름');
  const items = [...doc.querySelectorAll('.rank-item')];
  ok(items.length === 12 && items.every((b, i) => b.getAttribute('aria-label').startsWith((i + 1) + '위')), '순위 항목마다 "N위 별자리" 읽기 문구');
  ok(items.filter(b => /내 별자리/.test(b.getAttribute('aria-label'))).length === 1, '내 별자리는 글자로도 구분(색에만 의존하지 않음)');
  ok(doc.querySelector('.rank-item.mine .badge-my').textContent === 'MY', 'MY 표시');
  ok(doc.querySelector('.my-bar') && /물병자리 · \d+위/.test(doc.querySelector('.my-bar').textContent), '내 별자리 요약 바');
  ok(doc.querySelector('li.first .rank-item.r1'), '1위는 특별 카드(첫 항목)');

  // 홈: 정보 위계(날짜 → 별자리 → 순위 → 핵심 한 줄 → 자세한 설명 → 행운 → 버튼 → 출처)
  p.click('#nav [data-route=home]'); await wait(60);
  const order = ['.date-title', '.hero-sign', '.rank-emblem', '.headline', '.tiles', '.actions', '.meta-list'];
  const pos = order.map(s => { const e = doc.querySelector('#app ' + s); return e ? [...doc.querySelectorAll('#app *')].indexOf(e) : -1; });
  ok(pos.every(x => x >= 0) && pos.every((x, i) => i === 0 || x > pos[i - 1]), '홈 정보 순서: 날짜 → 별자리 → 순위 → 핵심 한 줄 → 행운 → 버튼 → 출처 (' + pos.join(',') + ')');
  ok(doc.querySelector('.rank-emblem[role="img"][aria-label*="위"]') && doc.querySelector('.hero[aria-labelledby="heroName"] #heroName'), '순위 엠블럼 읽기 문구·히어로 제목 연결');
  ok(doc.querySelectorAll('#app .card .card').length === 0, '카드 안에 카드 없음');
  ok(doc.querySelectorAll('#app .btn-lg').length === 1, '화면의 핵심 버튼(Primary)은 하나');

  // 온보딩: 오류 안내와 포커스
  const q = open(makeEnv(), null); await wait(40);
  q.click('[data-action=start]'); await wait(40);
  ok(q.doc.querySelectorAll('.step').length === 3 && q.doc.querySelector('#signGrid[role="group"][aria-labelledby]'), '온보딩 3단계 + 별자리 그룹 라벨');
  q.click('[data-action=submit-onboarding]'); await wait(30);
  const err = q.doc.getElementById('formErr');
  ok(err.getAttribute('role') === 'alert' && /별자리를 선택/.test(err.textContent), '오류 메시지는 role=alert로 즉시 안내');
  ok(q.doc.activeElement && q.doc.activeElement.classList.contains('sign-btn'), '오류가 난 칸(별자리)으로 포커스 이동');
  ok(q.doc.querySelector('.cta-bar #formErr') && q.doc.querySelector('.cta-bar .btn-lg'), '오류 문구가 저장 버튼 바로 위에 보임(하단 고정 영역)');
  q.click('[data-sign=leo]'); ok(q.doc.getElementById('formErr').textContent === '', '별자리를 고르면 오류 문구가 사라짐');
  ok(q.doc.querySelector('.sign-btn.on[aria-pressed="true"]') && q.doc.querySelectorAll('.sign-btn[aria-pressed="true"]').length === 1, '선택 상태는 aria-pressed로 전달');
  const bd = q.doc.getElementById('fBirth'); bd.value = '2999-01-01'; bd.dispatchEvent(new q.w.Event('change', { bubbles: true }));
  q.click('[data-action=submit-onboarding]'); await wait(30);
  ok(q.doc.getElementById('fieldBirth').classList.contains('has-error') && q.doc.activeElement === bd && /오늘 이후/.test(q.doc.getElementById('formErr').textContent), '미래 생년월일: 해당 칸 오류 표시·포커스·안내');
  ok(q.errors.length === 0, '온보딩 런타임 오류 없음');

  // 바텀시트: 열기·초점·키보드·닫기
  p.click('#nav [data-route=mypage]'); await wait(60);
  const opener = doc.querySelector('[data-action=sheet-privacy]'); opener.focus(); opener.click(); await wait(60);
  const dlg = doc.getElementById('dialog');
  ok(!dlg.hidden && dlg.classList.contains('open') && dlg.querySelector('[role="dialog"][aria-modal="true"]'), '바텀시트가 열림(role=dialog, aria-modal)');
  const title = dlg.querySelector('[aria-labelledby]'); ok(title && doc.getElementById(title.getAttribute('aria-labelledby')) && /개인정보/.test(doc.getElementById(title.getAttribute('aria-labelledby')).textContent), '시트 제목이 dialog 이름으로 연결');
  ok(dlg.contains(doc.activeElement), '시트가 열리면 포커스가 시트 안으로 이동');
  const btns = [...dlg.querySelectorAll('button, a[href]')]; btns[btns.length - 1].focus();
  key(w, dlg.querySelector('.sheet'), 'Tab');                                    // 마지막에서 Tab → 첫 요소로 (포커스 가둠)
  ok(dlg.contains(doc.activeElement), 'Tab으로 시트 밖으로 나가지 않음(포커스 트랩)');
  key(w, dlg.querySelector('.sheet'), 'Escape'); await wait(300);
  ok(dlg.hidden && doc.activeElement === opener, 'Esc로 닫히고 포커스가 열었던 버튼으로 복귀');
  // 초기화 확인창
  p.click('[data-action=reset]'); await wait(60);
  ok(dlg.querySelector('[data-r="0"]') && dlg.querySelector('[data-r="1"]') && /초기화/.test(dlg.textContent), '초기화 확인: 취소/초기화 두 버튼');
  dlg.querySelector('[data-r="0"]').click(); await wait(300);
  ok(dlg.hidden && !!w.localStorage.getItem('byeolharu.profile.v1'), '취소하면 데이터가 그대로 남음');

  // 기록 화면: 달력 접근성
  p.click('#nav [data-route=history]'); await wait(80);
  const days = [...doc.querySelectorAll('.cal-day')];
  ok(days.length === 31 && days.every(d => /\d+월 \d+일/.test(d.getAttribute('aria-label'))), '달력 날짜마다 "N월 N일" 읽기 문구');
  ok(days.filter(d => /오늘/.test(d.getAttribute('aria-label'))).length === 1 && days.filter(d => /기록 있음/.test(d.getAttribute('aria-label'))).length > 0, '오늘·기록 있음은 글자로도 안내');
  p.click('.cal-day[data-date="2026-10-14"]'); await wait(80);
  ok(doc.querySelector('.cal-day.sel[aria-pressed="true"]') && doc.querySelector('.day-result[aria-live]') && /위 \/ 12위/.test(doc.querySelector('.day-result').textContent), '선택한 날 강조(aria-pressed)와 결과 영역(aria-live)');
  ok(doc.querySelector('[data-action=hist-next]').disabled, '이번 달 이후로는 이동 불가(비활성)');

  // 공유 카드: 공식 문구·로고를 넣지 않는다
  w.eval(`go('share')`); await wait(80);
  const story = doc.querySelector('.story');
  const headline = (JSON.parse(JSON.stringify(env.call(`getHoroscopes()`))).items.find(i => i.zodiac_sign === 'aquarius') || {}).title_ko;
  ok(story && story.getAttribute('role') === 'img' && /물병자리/.test(story.getAttribute('aria-label')) && /위/.test(story.getAttribute('aria-label')), '공유 카드 읽기 문구(별자리·순위)');
  ok(headline && story.textContent.indexOf(headline) < 0 && !/Hi_Ohaasa|おは|朝日/.test(story.textContent), '공유 카드에 공식 운세 문구·출처명 미포함 (이용 허락 원칙)');
  ok(story.textContent.includes('테스트 운세') && story.textContent.includes('매일 아침 나의 별을 만나는 시간'), '테스트 데이터는 공유 카드에도 "테스트 운세" 표시 + 브랜드 문구');
  ok(doc.querySelector('[data-action=share-save]') && doc.querySelector('[data-action=share-send]'), '저장·공유 버튼(준비 중 안내)');

  // 상태 화면
  const e2 = makeEnv(); e2.setNow('2026-10-15 09:30'); e2.run(`Settings.set('TEST_FALLBACK','false')`);
  const s = open(e2, PROFILE); await wait(80);
  ok(s.doc.querySelector('.state[role="status"]') && s.text().includes('오늘의 오하아사 운세가 아직 업데이트되지 않았어요. 공식 게시물을 확인한 뒤 반영됩니다.'), '대기 상태: role=status + 지정 문구');
  const e3 = makeEnv(); e3.setNow('2026-10-15 09:30'); e3.run(`Settings.set('TEST_FALLBACK','false')`);
  const l = open(e3, PROFILE); ok(l.doc.querySelector('[role="status"][aria-label*="불러오는"] .skeleton'), '로딩 상태: 스켈레톤 + 읽기 문구(첫 순간)');

  ok(p.errors.length === 0 && s.errors.length === 0, '런타임 오류 없음 ' + p.errors.concat(s.errors).join('|'));
  console.log(`\n통과 ${passes} / 실패 ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('테스트 중단:', e.stack); process.exit(1); });
