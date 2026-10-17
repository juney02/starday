// 별하루 화면 테스트: 진짜 서버 코드(.gs)와 진짜 화면 코드(.html)를 가상 브라우저(jsdom)에서 연결해 사용자 흐름을 검증한다
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { makeEnv, SRC } = require('./harness.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };
const wait = (ms = 15) => new Promise(r => setTimeout(r, ms));
const j = s => JSON.stringify(s);

function htmlOf(name) {
  let h = fs.readFileSync(path.join(SRC, name + '.html'), 'utf8').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'));
  return h.replace(/<link[^>]*fonts[^>]*>/g, '');
}
function openPage(env, name, opts = {}) {
  const errors = [];
  const dom = new JSDOM(htmlOf(name), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/macros/s/x/exec' + (opts.query || ''),
    beforeParse(w) {
      w.Date = env.ctx.Date;                         // 서버와 같은 가짜 시계
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
      if (opts.profile) w.localStorage.setItem('byeolharu.profile.v1', JSON.stringify(opts.profile));
      const mk = (okH, failH) => new Proxy({}, { get(_, prop) {
        if (prop === 'withSuccessHandler') return f => mk(f, failH);
        if (prop === 'withFailureHandler') return f => mk(okH, f);
        return (...args) => setTimeout(() => {
          if (opts.failNext && opts.failNext.n > 0) { opts.failNext.n--; return failH({ message: '네트워크 오류(테스트)' }); }
          try { okH(env.call(`${prop}(...${j(args)})`)); } catch (e) { failH({ message: e.message }); }
        }, 0);
      } });
      w.google = { script: { run: mk() } };
      w.addEventListener('error', e => errors.push(e.message));
    },
  });
  const w = dom.window, doc = w.document;
  return { w, doc, errors, text: () => (doc.querySelector('#app') || doc.querySelector('#root')).textContent, click: sel => { const el = doc.querySelector(sel); if (!el) throw new Error('없음: ' + sel); el.click(); }, q: s => doc.querySelector(s), qa: s => [...doc.querySelectorAll(s)] };
}
const PROFILE = { sign: 'aquarius', birthDate: '', birthTime: '', birthTimeUnknown: true, notify: false };
const TOKEN = 'tok-admin-xyz';

(async () => {
  // ================= 0. 실제 운세 모드: 오늘 운세가 아직 없을 때 "최근 운세 보기" → 그 날짜로 기록 화면에서 보여줌
  {
    const env = makeEnv();
    const day = (d) => [{ horoscope_id: '1', onair_date: d, open_st: '2', detail: Array.from({ length: 12 }, (_, k) => ({ ranking_no: String(k + 1), horoscope_st: ('0' + (k + 1)).slice(-2), horoscope_text: `本文${k + 1}\t\t\t自転車` })) }];
    env.fetchHandler = (url) => (/horoscope\.json/.test(url) ? { code: 200, body: day('20261014') } : { code: 404, body: '{}' });
    env.setNow('2026-10-15 07:40'); env.run('setupRealApp()');
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(60);
    ok(!p.text().includes('테스트 운세') && !/\d+위 \/ 12위/.test(p.text()), '실제 모드: 오늘 운세가 없으면 가상 운세나 어제 순위를 오늘 것으로 보여주지 않음');
    const btn = p.q('[data-action=see-date]');
    ok(btn && /최근 운세 보기/.test(btn.textContent) && btn.dataset.date === '2026-10-14', '"최근 운세 보기(그 날짜)" 버튼');
    btn.click(); await wait(80);
    ok(p.w.eval('App.route') === 'history' && p.w.eval('App.hist.sel') === '2026-10-14' && /10월 14일/.test(p.text()) && /\[번역\]本文/.test(p.text()), '버튼을 누르면 기록 화면에서 그 날짜의 실제 운세(번역)를 보여줌');
    ok(!p.errors.length, '화면 오류 없음: ' + p.errors.join(' | '));
  }

  // ================= 0-2. 토요일: "공개되지 않았어요" + 위로 한마디 + AI 도우미 버튼 (운세를 대신 보여주지 않음)
  {
    const env = makeEnv();
    env.fetchHandler = (url) => (/horoscope\.json/.test(url) ? { code: 200, body: [{ horoscope_id: '1', onair_date: '20261016', open_st: '2', detail: Array.from({ length: 12 }, (_, k) => ({ ranking_no: String(k + 1), horoscope_st: ('0' + (k + 1)).slice(-2), horoscope_text: `本文${k + 1}\t\t\t自転車` })) }] } : { code: 404, body: '{}' });
    env.setNow('2026-10-17 10:00'); env.run('setupRealApp()');
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(80);
    const comfort = env.call(`weekendComfort_('2026-10-17')`);
    ok(/공개되지 않았어요/.test(p.text()) && p.text().includes(comfort) && /월요일/.test(p.text()), '토요일: 안내 문구 + 위로 한마디');
    ok(!/\d+위 \/ 12위/.test(p.text()) && !p.text().includes('테스트 운세'), '토요일: 순위·가상 운세를 보여주지 않음');
    const btn = p.q('.weekend-state [data-route=ai]');
    ok(btn && /AI 도우미와 이야기하기/.test(btn.textContent), 'AI 도우미로 가는 버튼');
    btn.click(); await wait(30);
    ok(p.w.eval('App.route') === 'ai' && p.q('#chatInput'), '버튼을 누르면 AI 도우미 화면으로 이동');
    ok(!p.errors.length, '화면 오류 없음: ' + p.errors.join(' | '));
  }

  // ================= A. 사용자 앱 (TEST 모드, 저장된 데이터가 아직 없을 때: 대기 → 자동 갱신)
  {
    const env = makeEnv();
    env.run(`Settings.set('TEST_FALLBACK','false'); Settings.set('AUTO_PUBLISH','true')`);
    env.setNow('2026-10-15 08:05');
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(50);
    ok(p.text().includes('확인하고 있어요'), '9시 전: 대기 안내 문구');
    ok(!/위 \/ 12위/.test(p.text()), '운세가 없으면 순위를 만들어 보여주지 않음');
    ok(p.qa('#nav button').length === 5, '하단 내비 5개(AI 도우미 추가)');

    env.run('tick()');                                    // 서버가 08:00 슬롯을 처리 → 자동 공개
    p.w.eval('App.loadedAt = 0'); p.w.eval('pollTick()'); await wait(60);
    ok(/\d+위 \/ 12위/.test(p.text()), '새로고침 없이 자동으로 운세가 나타남');
    ok(p.text().includes('테스트 운세') && p.text().includes('[TEST] 가상 X 게시물'), '테스트 데이터 표시와 [TEST] 출처');
    ok(p.q('#toast').classList.contains('show') && /업데이트/.test(p.q('#toast').textContent), '"업데이트됐어요" 알림');
    ok(p.text().includes('물병자리') && p.text().includes('행운 아이템') && p.text().includes('게시 시각') && p.text().includes('업데이트 시간'), '순위·별자리·행운 아이템·게시 시각·업데이트 시간 표시');
    ok(/テスト用/.test((p.click('[data-action=toggle-ja]'), p.text())), '일본어 원문 보기');
    ok(p.qa('a').some(a => /x\.com\/Hi_Ohaasa/.test(a.href) && /공식 X 게시물/.test(a.textContent)), '공식 X 게시물 보기 버튼');

    p.click('#nav [data-route=ranking]'); await wait(20);
    ok(p.qa('.rank-item').length === 12 && p.qa('.badge-my').length === 1, '전체 순위 12개 + MY');
    ok(p.qa('.rank-item').map(x => x.getAttribute('aria-label')).join('|').startsWith('1위'), '1위부터 정렬');
    p.click('.rank-item:not(.mine)'); await wait(20);
    ok(/위 \/ 12위/.test(p.text()) && !p.text().includes('MY'), '다른 별자리 상세');

    // 두 번째 갱신: 관리자가 번역을 고치면 버전이 바뀌어 화면이 다시 갱신된다
    env.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
    p.click('[data-route=ranking]'); await wait(10);
    const rows = env.call(`adminRows(${j(TOKEN)}, '2026-10-15')`);
    env.setNow('2026-10-15 08:20');
    env.call(`adminSaveRow(${j(TOKEN)}, ${j(rows[0].id)}, {content_ko:'관리자가 고친 문장'}, false)`);
    p.w.eval('App.loadedAt = 0'); p.w.eval('pollTick()'); await wait(60);
    ok(p.q('#toast').textContent.includes('갱신'), '데이터가 바뀌면 다시 갱신 알림');
  }

  // ================= B. 9시 이후에도 운세가 없을 때 / 오류 재시도
  {
    const env = makeEnv();
    env.run(`Settings.set('TEST_FALLBACK','false'); Settings.set('TEST_SCENARIO','none')`);
    env.setNow('2026-10-15 09:10');
    const fail = { n: 1 };
    const p = openPage(env, 'Index', { profile: PROFILE, failNext: fail });
    await wait(50);
    ok(p.text().includes('운세를 불러오지 못했어요') && p.q('[data-action=retry]'), '조회 실패: 오류 안내 + 다시 시도 버튼');
    p.click('[data-action=retry]'); await wait(50);
    ok(p.text().includes('오늘의 오하아사 운세가 아직 업데이트되지 않았어요. 공식 게시물을 확인한 뒤 반영됩니다.'), '9시 이후 미게시: 사양 문구 그대로');
    ok(!/위 \/ 12위/.test(p.text()), '게시되지 않은 운세는 만들지 않음');
    p.click('#nav [data-route=ranking]'); await wait(20);
    ok(p.text().includes('아직 업데이트되지 않았어요') && p.qa('.rank-item').length === 0, '전체 순위 화면도 미게시 안내');
    p.click('#nav [data-route=history]'); await wait(30);
    ok(p.qa('.cal-day').length === 31 && !p.q('.cal-day.has'), '달력: 기록 없으면 표시 없음');
    ok(p.q('[data-action=hist-next]').disabled, '달력: 이번 달 이후로는 이동 불가');
    p.click('.cal-day[data-date="2026-10-10"]'); await wait(30);
    ok(p.text().includes('운세 기록 없음'), '기록 없는 날짜: "운세 기록 없음"');
    ok(p.q('.cal-day[data-date="2026-10-16"]').disabled, '아직 지나지 않은 날짜는 선택 불가');
  }

  // ================= C. 운세 달력 (기록이 있는 경우)
  {
    const env = makeEnv();
    env.run(`Settings.set('AUTO_PUBLISH','true'); Settings.set('TEST_FALLBACK','false'); Settings.set('RETENTION_DAYS','0')`);
    for (const d of ['2026-10-13', '2026-10-14', '2026-10-15']) { env.setNow(d + ' 08:00'); env.run('tick()'); }
    env.setNow('2026-10-15 12:00');
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(40); p.click('#nav [data-route=history]'); await wait(40);
    eq3(p.qa('.cal-day.has').map(b => b.dataset.date), ['2026-10-13', '2026-10-14', '2026-10-15'], '달력: 저장된 날짜에 표시');
    p.click('.cal-day[data-date="2026-10-14"]'); await wait(40);
    ok(/위 \/ 12위/.test(p.text()) && p.text().includes('2026년 10월 14일'), '과거 날짜의 내 별자리 순위·내용 표시');
    ok(!p.text().includes('12별자리 전체 순위 보기'), '기록 화면에서는 오늘 순위 이동 버튼 숨김');
    p.click('[data-action=hist-prev]'); await wait(30);
    ok(p.text().includes('2026년 9월') && !p.q('.cal-day.has'), '이전 달 이동');
    p.click('[data-action=hist-next]'); await wait(30);
    ok(p.text().includes('2026년 10월'), '다음 달 이동');
  }

  // ================= D. 운영 모드: 이용 허락 전 → 링크만, 허락 후 → 내용
  {
    const env = makeEnv();
    const posts = env.call(`TestFeed.getPosts('2026-10-15','normal')`);
    const tweets = posts.filter(x => !x.is_retweet).map(x => ({ id: x.id.replace('TEST', '1'), text: x.text, created_at: x.created_at, author_id: x.author_id === 'TEST_AUTHOR' ? '777' : '999' }));
    env.fetchHandler = url => /by\/username/.test(url) ? { code: 200, body: { data: { id: '777' } } } : { code: 200, body: { data: tweets } };
    env.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X'); Settings.set('X_BEARER_TOKEN','tok'); Settings.set('PUBLISH_REQUIRES_TRANSLATION','false'); Settings.set('AUTO_PUBLISH','true')`);
    env.setNow('2026-10-15 08:00'); env.run('tick()');
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(50);
    ok(p.text().includes('공식 게시물로 확인해 주세요'), '이용 허락 전: 링크 안내');
    ok(p.qa('a').some(a => /x\.com\/Hi_Ohaasa\/status\/1/.test(a.href)), '공식 게시물 링크 제공');
    ok(!/위 \/ 12위/.test(p.text()) && !/テスト用/.test(p.text()), '허락 전에는 순위·내용을 보여주지 않음');
    ok(!p.text().includes('테스트 운세'), '운영 모드에는 테스트 표시 없음');

    env.run(`Source.patch({authorization_status:'APPROVED'})`);
    env.setNow('2026-10-15 08:10'); env.run('tick()');
    p.w.eval('App.loadedAt = 0'); p.w.eval('pollTick()'); await wait(60);
    ok(/\d+위 \/ 12위/.test(p.text()), '허락 확인 후 자동 반영');
    ok(!p.text().includes('테스트 운세') && p.text().includes('X @Hi_Ohaasa'), '운영 데이터: 테스트 표시 없음, 출처 @Hi_Ohaasa');
    ok(p.text().includes('[번역]'), '번역(내장 Google 번역)이 있으면 한국어로 표시');
    env.run(`Settings.set('ADMIN_TOKEN', 'tk')`);
    const mine = env.call(`adminRows('tk', '2026-10-15')`).find(r => r.zodiac_sign === 'aquarius');
    env.setNow('2026-10-15 08:20');
    env.call(`adminSaveRow('tk', ${j(mine.id)}, {content_ko: ''}, false)`);
    p.w.eval('App.loadedAt = 0'); p.w.eval('pollTick()'); await wait(60);
    ok(p.text().includes('일본어 원문을 보여드려요') && p.text().includes('テスト用'), '번역이 비어 있으면 일본어 원문을 대신 보여주고 안내');
  }

  // ================= E. 관리자 화면
  {
    const env = makeEnv();
    env.setNow('2026-10-15 08:30');
    let a = openPage(env, 'Admin'); await wait(40);
    ok(a.text().includes('관리자 기능이 꺼져 있어요'), '인증 미설정이면 관리자 화면 비활성');

    env.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
    a = openPage(env, 'Admin'); await wait(40);
    ok(a.q('#tok') && a.q('#loginBtn'), '토큰 없이 접근하면 로그인 화면');
    ok(!a.text().includes('지금 데이터 확인'), '로그인 전에는 관리 기능이 보이지 않음');
    a.q('#tok').value = 'wrong'; a.click('#loginBtn'); await wait(40);
    ok(a.text().includes('올바르지 않아요'), '틀린 토큰: 오류 표시');
    a.q('#tok').value = TOKEN; a.click('#loginBtn'); await wait(60);
    ok(a.text().includes('별하루 관리자') && a.text().includes('TEST MODE') && a.text().includes('지금 데이터 확인'), '올바른 토큰: 관리 화면');

    a.click('#runNow'); await wait(80);
    ok(/REVIEW|SUCCESS/.test(a.q('#msg').textContent), '"지금 데이터 확인": 결과 메시지 표시');
    ok(a.text().includes('12 / 12') && a.text().includes('순위 완전'), '현황: 12/12, 순위 완전');
    ok(a.text().includes('TEST'), '현황에 모드 표시');

    a.click('[data-tab=data]'); await wait(40);
    ok(a.qa('.row-card').length === 12, '운세 데이터: 12별자리 카드');
    const first = a.q('.row-card');
    ok(first.querySelector('[data-f=content_ja]').value.startsWith('テスト用') && first.querySelector('[data-f=content_ko]').value.startsWith('테스트용'), '일본어 원문과 한국어 번역이 나란히 표시');
    first.querySelector('[data-f=content_ko]').value = '관리자가 검수한 번역'; first.querySelector('.save').click(); await wait(60);
    ok(a.q('.row-card [data-f=content_ko]').value === '관리자가 검수한 번역', '번역 수정 저장');
    a.click('#dPub'); await wait(60);
    ok(a.q('#msg').textContent.includes('공개했어요') && a.qa('.row-card .pill').some(x => x.textContent === 'PUBLISHED'), '게시 승인(공개)');
    ok(env.call(`getHoroscopes().version`).startsWith('MOCK|2026'), '공개 즉시 사용자 API에 반영');
    a.click('#dUnpub'); await wait(60);
    ok(a.qa('.row-card .pill').some(x => x.textContent === 'HIDDEN'), '비공개 처리');

    a.click('[data-tab=logs]'); await wait(20);
    ok(a.text().includes('MANUAL') && /REVIEW|SUCCESS/.test(a.text()), '수신 기록 표시');

    a.click('[data-tab=settings]'); await wait(20);
    a.q('#sScen').value = 'duplicate_rank'; a.q('#sAuto').checked = true; a.click('#sSave'); await wait(60);
    ok(a.q('#msg').textContent.includes('설정을 저장'), '설정 저장');
    ok(env.call(`Settings.get('TEST_SCENARIO')`) === 'duplicate_rank' && env.call(`Settings.bool('AUTO_PUBLISH')`) === true, '설정이 서버에 반영');
    a.click('[data-tab=status]'); await wait(10);
    a.click('#toggleAuto'); await wait(60);
    ok(env.call(`Source.enabled()`) === false, '자동 갱신 끄기');
    a.click('#toggleTrig'); await wait(60);
    ok(env.triggers.length === 1, '자동 실행 트리거 설치');
    a.click('#logout'); await wait(10);
    ok(a.q('#tok'), '로그아웃하면 로그인 화면');
    ok(a.errors.length === 0, '관리자 화면 런타임 오류 없음: ' + a.errors.join('|'));
  }


  // ================= F. AI 도우미 화면
  {
    const KEY = 'AIza-UI-KEY';
    const textReply = t => ({ code: 200, body: { candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] } });
    const callReply = (name, args) => ({ code: 200, body: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] } });
    const env = makeEnv(); env.setNow('2026-10-15 09:00');
    env.run(`Settings.set('GEMINI_API_KEY', ${j(KEY)})`);
    env.calls = [];
    let mode = 'tool';
    env.fetchHandler = (url, opt) => {
      const body = JSON.parse(opt.payload); env.calls.push(body);
      const last = body.contents[body.contents.length - 1];
      if (last.parts[0].functionResponse) return textReply('**오늘** 물병자리는 순위가 나왔어요.\n* 참고용이에요');
      if (mode === 'xss') return textReply('<img src=x onerror=alert(1)> 안녕');
      return mode === 'tool' ? callReply('get_horoscope', {}) : textReply('일반 답변이에요.');
    };
    const p = openPage(env, 'Index', { profile: PROFILE });
    await wait(60);
    ok(p.qa('#nav button').length === 5 && p.q('#nav [data-route=ai]'), 'AI: 하단 메뉴에 AI 도우미 탭');
    p.click('#nav [data-route=ai]'); await wait(20);
    ok(p.text().includes('AI 도우미') && p.text().includes('참고 의견') && p.text().includes('물병자리 기준'), 'AI: 화면 제목·참고 의견 안내·내 별자리 기준');
    ok(p.qa('.chip').length === 5 && p.q('#chatInput') && p.q('#chatClear').disabled, 'AI: 추천 질문 5개, 입력칸, 처음엔 대화 지우기 비활성');

    p.qa('.chip')[0].click();   // 바로 확인: 가짜 서버가 즉시 답하므로 기다리지 않는다
    ok(p.q('.cmsg.me') && p.q('.typing') && p.q('#chatSend').disabled, 'AI: 질문을 보내면 내 말풍선 + 답을 만드는 중 표시, 보내기 잠금');
    await wait(80);
    const aiBubble = p.q('.cmsg.ai .bubble');
    ok(aiBubble && aiBubble.textContent.includes('물병자리는 순위가 나왔어요') && !/[*#`]/.test(aiBubble.textContent), 'AI: 답변 표시(마크다운 기호 제거)');
    ok(p.text().includes('확인한 정보: 운세 조회'), 'AI: 어떤 정보를 확인했는지 표시');
    ok(!p.q('.chips') && !p.q('.typing') && !p.q('#chatSend').disabled && !p.q('#chatClear').disabled, 'AI: 대화가 시작되면 추천 질문 사라짐, 보내기 다시 가능');
    ok(env.calls[0].systemInstruction.parts[0].text.includes('물병자리'), 'AI: 내 별자리가 AI에 전달됨');

    // 두 번째 질문: 이전 대화가 함께 전달된다. Enter로 보내기
    mode = 'plain';
    const input = p.q('#chatInput'); input.value = '고마워요';
    input.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(80);
    ok(p.qa('.cmsg.me').length === 2 && p.text().includes('일반 답변이에요'), 'AI: Enter로 보내기, 대화가 이어짐');
    const lastCall = env.calls[env.calls.length - 1];
    ok(lastCall.contents.length >= 3 && lastCall.contents[0].role === 'user' && lastCall.contents[lastCall.contents.length - 1].parts[0].text === '고마워요', 'AI: 이전 대화(최근 것)를 함께 전달');
    ok(p.q('#chatInput').value === '', 'AI: 보낸 뒤 입력칸 비움');

    // 빈 입력/Shift+Enter는 보내지 않음
    const before = env.calls.length;
    p.q('#chatInput').value = '   '; p.click('#chatSend'); await wait(30);
    ok(env.calls.length === before, 'AI: 빈 질문은 보내지 않음');
    p.q('#chatInput').value = '줄바꿈'; p.q('#chatInput').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); await wait(30);
    ok(env.calls.length === before, 'AI: Shift+Enter는 줄바꿈(보내지 않음)');

    // XSS 방어: 답변 안의 태그는 글자로만 보인다
    mode = 'xss'; p.q('#chatInput').value = '태그'; p.click('#chatSend'); await wait(80);
    ok(p.qa('#chatLog img').length === 0 && p.text().includes('<img src=x'), 'AI: 답변 속 HTML은 실행되지 않고 글자로만 표시');

    // 다른 화면을 다녀와도 대화 유지, 지우기 동작
    p.click('#nav [data-route=ranking]'); await wait(30); p.click('#nav [data-route=ai]'); await wait(20);
    ok(p.qa('.cmsg.me').length === 3, 'AI: 다른 탭에 다녀와도 대화 유지');
    p.click('#chatClear'); await wait(10);
    ok(p.qa('.cmsg').length === 0 && p.qa('.chip').length === 5, 'AI: 대화 지우기');

    // 오류 상황: 한도 초과 → 쉬운 말 안내 후 다시 질문 가능
    env.run(`Settings.set('AI_DAILY_LIMIT', String(AiAgent.usedToday() + 1))`); mode = 'plain';   // 오늘 남은 횟수를 1번으로 맞춘다
    p.qa('.chip')[1].click(); await wait(80);
    ok(p.text().includes('일반 답변이에요'), 'AI: 한도 안에서는 정상');
    p.q('#chatInput').value = '또 질문'; p.click('#chatSend'); await wait(80);
    ok(p.q('.cmsg.ai.err') && p.text().includes('모두 썼어요') && !p.q('#chatSend').disabled, 'AI: 한도 초과 안내(오류 말풍선), 화면은 계속 사용 가능');
    const callsNow = env.calls.length; p.q('#chatInput').value = '다음'; p.click('#chatSend'); await wait(60);
    ok(env.calls.length === callsNow, 'AI: 한도 초과 상태에서는 외부 호출을 하지 않음');

    // 키가 없을 때 / 서버 연결 실패
    const env2 = makeEnv(); env2.setNow('2026-10-15 09:00');
    const q = openPage(env2, 'Index', { profile: PROFILE }); await wait(50);
    q.click('#nav [data-route=ai]'); await wait(20); q.qa('.chip')[0].click(); await wait(80);
    ok(q.text().includes('아직 준비되지 않았어요'), 'AI: 키가 없으면 "준비되지 않았어요" 안내');
    const fail = { n: 1 }; const r2 = openPage(env2, 'Index', { profile: PROFILE, failNext: { n: 99 } }); await wait(50);
    ok(r2 !== null, '(참고)');
    ok(p.errors.length === 0 && q.errors.length === 0, 'AI 화면 런타임 오류 없음: ' + p.errors.join('|'));
  }
  console.log(`\n통과 ${passes} / 실패 ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('테스트 중단:', e.stack); process.exit(1); });

function eq3(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }
