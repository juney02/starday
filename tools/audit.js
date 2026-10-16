/**
 * 레이아웃 자동 점검 (개발 검증 전용 — 앱에는 포함되지 않는다)
 *
 * 실제 Edge(Chromium) 안에서 각 화면을 여러 너비로 열고 이렇게 잰다:
 *   - 가로 넘침: 화면 밖으로 삐져나온 요소, 가로 스크롤이 생기는지
 *   - 글자 크기: 12px 미만으로 보이는 글자 (WCAG 최소 권장보다 작은 것)
 *   - 터치 영역: 버튼·링크·입력의 크기가 44px 미만인지 (24px 미만이면 오류, 24~43px는 주의)
 *   - 글자 대비: 글자색과 실제 배경색의 대비를 계산 (배경이 그라데이션이면 "측정 불가"로 건너뜀)
 *
 * 사용: node tools/audit.js [장면이름 ...]
 */
const { fs, path, cp, EDGE, toUrl, compose, SCENES, frameFor } = require('./lib.js');

const ONLY = process.argv.slice(2);
const WIDTHS = [{ w: 320, h: 700 }, { w: 390, h: 844 }, { w: 820, h: 1180 }, { w: 1280, h: 860 }];
const OUT = path.join(process.env.TEMP || '.', 'byeolharu-audit'); fs.mkdirSync(OUT, { recursive: true });

// 화면 안에서 실행되는 측정 코드
const MEASURE = `
setTimeout(function () {
  var out = [], vw = document.documentElement.clientWidth;
  function desc(el) { var s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.'); var t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 18); return s + (t ? ' "' + t + '"' : ''); }
  function visible(el) { var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; var r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; for (var p = el; p && p !== document.body; p = p.parentElement) { var c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false; } return true; }
  function lum(c) { var a = c.map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; }
  function parse(s) { var m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null; var p = m[1].split(',').map(parseFloat); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; }
  function blend(fg, a, bg) { return [0, 1, 2].map(function (i) { return fg[i] * a + bg[i] * (1 - a); }); }
  /* 글자 뒤 배경색 후보들. 그라데이션이면 불투명한 색 단계들을 모두 후보로 삼아 "가장 불리한 값"으로 잰다 */
  function bgColors(el) {
    for (var p = el; p; p = p.parentElement) {
      var cs = getComputedStyle(p), gi = cs.backgroundImage;
      if (gi && gi !== 'none' && /gradient/.test(gi)) {
        var stops = (gi.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter(function (s) { return s && s.a >= .5; }).map(function (s) { return s.c; });
        if (stops.length) return stops;
      }
      var b = parse(cs.backgroundColor);
      if (b && b.a >= .99) return [b.c];
      if (b && b.a > .01) { var under = p.parentElement ? bgColors(p.parentElement) : [[10, 17, 41]]; return under.map(function (u) { return blend(b.c, b.a, u); }); }
    }
    return [[10, 17, 41]];
  }

  if (document.documentElement.scrollWidth > vw + 1) out.push({ t: 'overflow-x', msg: '가로 스크롤 발생: scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw });
  var nBtn = 0, nText = 0;
  document.querySelectorAll('body *').forEach(function (el) {
    if (el.closest('#stars') || el.closest('.skip-link') || el.id === 'toast' || el.closest('.dialog-wrap[hidden]') || el.closest('script,style')) return;
    if (!visible(el)) return;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > vw + 1 || r.left < -1) out.push({ t: 'out-of-view', msg: desc(el) + ' 가 화면 밖으로 나감 (left ' + Math.round(r.left) + ', right ' + Math.round(r.right) + ')' });

    var own = ''; el.childNodes.forEach(function (n) { if (n.nodeType === 3) own += n.textContent; });
    if (own.trim()) {
      nText++;
      var fs = parseFloat(cs.fontSize);
      if (fs < 11.99) out.push({ t: 'small-font', msg: desc(el) + ' 글자 ' + fs.toFixed(1) + 'px' });
      var fg = parse(cs.color), bgs = bgColors(el);
      if (fg && bgs.length) {
        var ratio = 99;
        bgs.forEach(function (bg) {
          var f = fg.a < 1 ? blend(fg.c, fg.a, bg) : fg.c;
          var l1 = lum(f), l2 = lum(bg), rr = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
          if (rr < ratio) ratio = rr;
        });
        var large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
        var need = large ? 3 : 4.5;
        if (ratio < need && !el.disabled && !el.closest('[disabled]') && !el.closest('.cal-day:disabled')) out.push({ t: 'contrast', msg: desc(el) + ' 대비 ' + ratio.toFixed(2) + ':1 (기준 ' + need + ')' });
      }
    }
    var tag = el.tagName;
    if (tag === 'BUTTON' || (tag === 'A' && el.hasAttribute('href')) || (tag === 'INPUT' && el.type !== 'hidden') || tag === 'TEXTAREA' || tag === 'SELECT') {
      var box = r; nBtn++;
      if (tag === 'INPUT' && (el.type === 'checkbox')) { var lb = el.closest('label'); if (lb) box = lb.getBoundingClientRect(); }
      if (box.width < 23.5 || box.height < 23.5) out.push({ t: 'tiny-target', msg: desc(el) + ' 터치 영역 ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' (24px 미만)' });
      else if (box.height < 43.5 || box.width < 43.5) out.push({ t: 'small-target', msg: desc(el) + ' 터치 영역 ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' (44px 미만)' });
    }
  });
  var seen = {}; out = out.filter(function (o) { var k = o.t + o.msg; if (seen[k]) return false; seen[k] = 1; return true; });
  out.unshift({ t: 'meta', nBtn: nBtn, nText: nText, route: (typeof App !== 'undefined' ? App.route : '?') });   // 얼마나 측정했는지(빈 측정을 알아채기 위함)
  parent.postMessage('__audit__' + JSON.stringify(out), '*');
}, 1800);
`;

const scenes = SCENES.filter(s => ONLY.length ? ONLY.includes(s.name) : !s.selftest);
const totals = { 'overflow-x': 0, 'out-of-view': 0, 'small-font': 0, 'contrast': 0, 'tiny-target': 0, 'small-target': 0 };
const report = [];
scenes.forEach(scene => {
  const file = path.join(OUT, scene.name + '.html');
  fs.writeFileSync(file, compose(scene, MEASURE), 'utf8');
  WIDTHS.forEach(v => {
    const frame = frameFor(file, v.w, v.h);
    const r = cp.spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=9000', '--dump-dom', `--window-size=${Math.max(v.w, 500)},${v.h}`, toUrl(frame)], { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
    const m = /<pre id="__audit">(\[[\s\S]*?\])<\/pre>/.exec(r.stdout || '');   // 바깥 페이지 스크립트 글자와 헷갈리지 않게 JSON 배열로 시작하는 것만
    if (!m) { report.push({ scene: scene.name, w: v.w, error: '측정 결과를 받지 못했어요' }); return; }
    const all = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    const meta = all.find(i => i.t === 'meta') || {}, issues = all.filter(i => i.t !== 'meta');
    if (!meta.nText) { report.push({ scene: scene.name, w: v.w, error: '측정한 글자가 0개예요 (화면이 아직 안 그려졌을 수 있음)' }); return; }
    issues.forEach(i => { totals[i.t] = (totals[i.t] || 0) + 1; });
    report.push({ scene: scene.name, w: v.w, issues, meta });
  });
});

const LABEL = { 'overflow-x': '가로 스크롤', 'out-of-view': '화면 밖으로 나감', 'small-font': '12px 미만 글자', 'contrast': '글자 대비 부족', 'tiny-target': '터치 영역 24px 미만(오류)', 'small-target': '터치 영역 44px 미만(주의)' };
report.forEach(r => {
  if (r.error) { console.log(`[${r.scene} @${r.w}] ⚠ ${r.error}`); return; }
  const sev = r.issues.filter(i => i.t !== 'small-target');
  console.log(`[${r.scene} @${r.w}] (화면 ${r.meta.route} · 버튼류 ${r.meta.nBtn} · 글자 ${r.meta.nText}개 측정) ${sev.length ? '문제 ' + sev.length + '건' : '문제 없음'}${r.issues.length > sev.length ? ` (주의 ${r.issues.length - sev.length}건)` : ''}`);
  r.issues.forEach(i => console.log(`    - ${LABEL[i.t]}: ${i.msg}`));
});
console.log('\n===== 요약 =====');
Object.keys(totals).forEach(k => console.log(`${LABEL[k]}: ${totals[k]}건`));
fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 1));
process.exit(report.some(r => r.error) ? 2 : 0);
