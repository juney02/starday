// 회귀 테스트: PHASE 1 기능(시작·등록·자동 추천·저장·홈·순위·마이페이지·초기화)이 자동 업데이트 기능 추가 후에도 그대로인지 확인
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { makeEnv, SRC } = require('./harness.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));

const env = makeEnv(); env.setNow('2026-10-15 10:00');   // TEST 모드 기본값: 저장 데이터가 없으면 즉석 가상 운세
const html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8')).replace(/<link[^>]*fonts[^>]*>/g, '');
const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/', beforeParse(w) {
  w.Date = env.ctx.Date; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  const mk = (o, f) => new Proxy({}, { get(_, p) { if (p === 'withSuccessHandler') return x => mk(x, f); if (p === 'withFailureHandler') return x => mk(o, x);
    return (...a) => setTimeout(() => { try { o(env.call(`${p}(...${JSON.stringify(a)})`)); } catch (e) { f({ message: e.message }); } }, 0); } });
  w.google = { script: { run: mk() } }; w.addEventListener('error', e => errors.push(e.message)); } });
const w = dom.window, doc = w.document;
const text = () => doc.querySelector('#app').textContent;
const click = s => { const el = doc.querySelector(s); if (!el) throw new Error('없음: ' + s); el.click(); };
const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

(async () => {
  ok(text().includes('시작하기') && text().includes('당신의 별은 어디에'), '시작 화면');
  ok(!doc.querySelector('#nav').classList.contains('show'), '시작 화면에는 하단 내비 없음');
  click('[data-action=start]'); await wait();
  ok(text().includes('당신의 별을') && text().includes('알려 주세요') && doc.querySelectorAll('.step-no').length === 3, '정보 등록 화면(3단계 구성)');
  click('[data-action=submit-onboarding]'); await wait();
  ok(text().includes('별자리를 선택해 주세요'), '별자리 없이 제출 → 오류 메시지');
  const birth = doc.querySelector('#fBirth');
  change(birth, '1995-02-10'); ok(doc.querySelector('.sign-btn.on .nm').textContent === '물병자리', '2/10 → 물병자리 자동 추천');
  change(birth, '2000-12-25'); ok(doc.querySelector('.sign-btn.on .nm').textContent === '염소자리', '12/25 → 염소자리');
  change(birth, '2001-01-05'); ok(doc.querySelector('.sign-btn.on .nm').textContent === '염소자리', '1/5 → 염소자리');
  click('[data-sign=aquarius]'); ok(doc.querySelector('.sign-btn.on .nm').textContent === '물병자리', '별자리 직접 변경');
  const unk = doc.querySelector('#fUnk'); unk.checked = true; unk.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(doc.querySelector('#fTime').disabled, '출생시간 모름 → 시간 입력 비활성');
  click('[data-action=submit-onboarding]'); await wait(50);

  ok(text().includes('테스트 운세') && /\d+위 \/ 12위/.test(text()) && text().includes('물병자리'), '홈: 테스트 운세 표시·순위·내 별자리');
  ok(doc.querySelectorAll('#nav button').length === 5, '하단 내비 5개(AI 도우미 추가)');
  const saved = JSON.parse(w.localStorage.getItem('byeolharu.profile.v1'));
  ok(saved.sign === 'aquarius' && saved.birthTimeUnknown === true, 'Local Storage 프로필 저장');
  click('[data-action=toggle-ja]'); await wait(); ok(text().includes('일본어 원문이 없어요'), '일본어 원문 보기 (가상 데이터는 원문 없음 안내)');
  click('[data-action=share]'); await wait(50);
  ok(text().includes('공유 카드') && doc.querySelector('.story') && text().includes('이미지로 저장하기'), '공유 버튼 → 공유 카드 화면(이미지 저장·공유는 준비 중)');
  click('[data-action=share-save]'); ok(/곧 만나요/.test(doc.querySelector('#toast').textContent), '이미지 저장 버튼: 준비 중 안내');
  click('[data-action=back]'); await wait(30); ok(/위 \/ 12위/.test(text()) && !doc.querySelector('.story'), '뒤로 가기 → 홈으로 복귀');

  click('#nav [data-route=ranking]'); await wait();
  ok(doc.querySelectorAll('.rank-item').length === 12 && doc.querySelectorAll('.badge-my').length === 1, '순위 12개 + MY 1개');
  ok(doc.querySelector('.rank-item.r1') && doc.querySelector('.rank-item.r2') && doc.querySelector('.rank-item.r3'), '1~3위 강조');
  click('.rank-item:not(.mine)'); await wait(); ok(/위 \/ 12위/.test(text()) && !text().includes('MY'), '다른 별자리 상세');
  click('[data-route=ranking]'); await wait();
  click('#nav [data-route=history]'); await wait(40); ok(text().includes('운세 기록') && doc.querySelectorAll('.cal-day').length === 31, '운세 기록(달력) 화면');
  click('#nav [data-route=mypage]'); await wait(); ok(text().includes('마이페이지') && text().includes('내 데이터 초기화'), '마이페이지');
  click('[data-sign=leo]'); ok(JSON.parse(w.localStorage.getItem('byeolharu.profile.v1')).sign === 'leo', '마이페이지: 변경 즉시 저장');
  click('[data-action=reset]'); await wait(); ok(!doc.querySelector('#dialog').hidden, '초기화 확인창');
  doc.querySelector('#dialog [data-r="1"]').click(); await wait();
  ok(w.localStorage.getItem('byeolharu.profile.v1') === null && text().includes('시작하기'), '초기화 후 시작 화면');

  // 새로고침 시나리오: 저장된 프로필이 있으면 시작 화면 건너뛰고 홈으로
  const p2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/', beforeParse(w2) {
    w2.Date = env.ctx.Date; w2.scrollTo = () => {}; w2.localStorage.setItem('byeolharu.profile.v1', JSON.stringify({ sign: 'leo' }));
    const mk = (o, f) => new Proxy({}, { get(_, p) { if (p === 'withSuccessHandler') return x => mk(x, f); if (p === 'withFailureHandler') return x => mk(o, x);
      return (...a) => setTimeout(() => { try { o(env.call(`${p}(...${JSON.stringify(a)})`)); } catch (e) { f({ message: e.message }); } }, 0); } });
    w2.google = { script: { run: mk() } }; } });
  await wait(50);
  ok(p2.window.document.querySelector('#app').textContent.includes('사자자리'), '재접속: 저장된 별자리로 바로 홈 표시');

  ok(errors.length === 0, '런타임 오류 없음 ' + errors.join('|'));
  console.log(`통과 ${passes} / 실패 ${fails}`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('중단:', e.stack); process.exit(1); });
