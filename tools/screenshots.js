/**
 * 화면 캡처 도구 (개발 검증 전용 — 앱에는 포함되지 않는다)
 * src/ 의 실제 화면 코드를 Microsoft Edge(headless)로 캡처한다. 장면·뷰포트 목록은 lib.js 참고.
 *
 * 사용: node tools/screenshots.js <출력폴더> [장면이름 ...]   (장면을 생략하면 전부)
 */
const { fs, path, cp, EDGE, toUrl, compose, SCENES, VIEWPORTS, frameFor } = require('./lib.js');

const OUT = path.resolve(process.argv[2] || 'shots');
const ONLY = process.argv.slice(3);
const FULL_ONLY = ['home', 'home-real', 'ranking', 'ranking-real', 'detail', 'mypage', 'onboarding'];
if (!EDGE) { console.log('Edge를 찾지 못했어요.'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const tmp = path.join(OUT, '_html'); fs.mkdirSync(tmp, { recursive: true });

function shoot(file, w, h, outPng) {
  const target = frameFor(file, w, h);
  cp.spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1',
    `--screenshot=${outPng}`, `--window-size=${Math.max(w, 500)},${h}`, '--virtual-time-budget=6000', toUrl(target)], { encoding: 'utf8', timeout: 60000 });
  return fs.existsSync(outPng);
}

let made = 0; const failed = [];
SCENES.filter(s => ONLY.length ? ONLY.includes(s.name) : !s.selftest).forEach(scene => {
  const file = path.join(tmp, scene.name + '.html');
  fs.writeFileSync(file, compose(scene), 'utf8');
  VIEWPORTS.forEach(v => {
    if (v.tag === 'mfull' && !FULL_ONLY.includes(scene.name)) return;
    const png = path.join(OUT, `${scene.name}.${v.tag}.png`);
    if (shoot(file, v.w, v.h, png)) made++; else failed.push(path.basename(png));
  });
});
console.log(`캡처 ${made}장 완료 → ${OUT}` + (failed.length ? `\n실패: ${failed.join(', ')}` : ''));
