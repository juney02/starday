/**
 * AI 에이전트가 쓸 수 있는 "도구" 모음
 *
 * - 에이전트(AI)는 운세 데이터를 직접 알지 못한다. 필요할 때 아래 도구를 불러서 "저장된 실제 데이터"만 받아 쓴다.
 * - 모든 도구는 읽기 전용이다. (시트를 바꾸거나 외부로 보내는 도구는 없다)
 * - 도구 입력값은 서버가 다시 검사한다. AI가 이상한 값을 넣어도 안전하게 오류 결과만 돌려준다.
 * - 도구 결과에 들어 있는 글(운세 문구 등)은 외부에서 온 "데이터"다. 시스템 프롬프트에서 명령으로 따르지 않도록 지시한다.
 */
const ZODIAC_KO = {
  aries: '양자리', taurus: '황소자리', gemini: '쌍둥이자리', cancer: '게자리', leo: '사자자리', virgo: '처녀자리',
  libra: '천칭자리', scorpio: '전갈자리', sagittarius: '사수자리', capricorn: '염소자리', aquarius: '물병자리', pisces: '물고기자리',
};

const AI_APP_HELP = {
  notification: '마이페이지에서 "매일 아침 운세 알림"을 켜면 설정이 저장돼요. 현재 버전은 알림 발송은 아직 지원하지 않고, 설정만 저장돼요.',
  profile: '마이페이지에서 별자리·생년월일·태어난 시간을 바꾸면 바로 저장돼요. 별자리는 생년월일을 입력하면 자동으로 추천되고 직접 바꿀 수도 있어요.',
  history: '운세 기록 탭의 달력에서 지난 날짜를 누르면 그날의 내 별자리 운세를 볼 수 있어요. 점이 찍힌 날에 기록이 있어요. 보관 기간 안의 기록만 볼 수 있어요.',
  ranking: '전체 순위 탭에서 오늘의 12별자리 순위를 볼 수 있어요. 별자리를 누르면 자세한 운세가 나와요. 내 별자리에는 MY 표시가 붙어요.',
  data: '운세는 일본 ABC TV "おはよう朝日です(오하아사)" 공식 사이트에 올라온 실제 순위를 가져와서 한국어로 번역해 보여줘요. 매일 아침 자동으로 확인하고, 앱을 열었을 때 아직 없으면 그 자리에서 다시 확인해요. 화면에 "테스트 운세"라고 보이면 개발 확인용 가상 데이터예요.',
  privacy: '생년월일과 태어난 시간은 이 기기의 브라우저에만 저장되고 서버로 보내지지 않아요. AI 도우미에는 내 별자리와 질문 내용만 전달돼요.',
  share: '운세 카드 공유(이미지 저장)는 아직 준비 중이에요.',
  update: '운세는 보통 한국 시간 오전 8~9시 사이에 반영돼요. 새 운세가 올라오면 화면을 새로고침하지 않아도 자동으로 바뀌어요. 주말과 휴방일에는 새 운세가 없을 수 있어요.',
};

function aiSignKey_(value, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new Error('별자리를 알려주세요.');
  }
  const s = String(value).trim();
  if (ZODIAC_KEYS.indexOf(s) >= 0) return s;
  const k = zodiacKeyFromName_(s);
  if (!k) throw new Error('알 수 없는 별자리예요: ' + s.slice(0, 20));
  return k;
}

function aiDate_(value, today) {
  if (value === undefined || value === null || value === '') return today;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('날짜는 yyyy-MM-dd 형식이어야 해요.');
  return s;
}

/** 한 날짜의 한 별자리 결과를 도구용으로 정리 */
function aiHoroscopeOf_(date, sign) {
  const res = HoroscopeService.getByDate(date);
  if (res.status !== 'MOCK' && res.status !== 'PUBLISHED') {
    return { available: false, date: date, reason: res.message || res.status, status: res.status, official_link: res.official ? res.official.url : '', latest_available_date: res.latestDate || '' };
  }
  const it = res.items.filter(function (x) { return x.zodiac_sign === sign; })[0];
  if (!it) return { available: false, date: date, reason: '이 별자리의 데이터가 없어요.' };
  return {
    available: true, date: date, sign: sign, sign_ko: ZODIAC_KO[sign], rank: it.rank, out_of: 12,
    is_test_data: !!res.isMock, content: it.content_ko || it.content_ja || '', lucky_item: it.lucky_item || '', lucky_color: it.lucky_color || '',
    source: it.source_name || '', updated_at: res.updatedAt || '',
  };
}

const AiTools = {

  /** Gemini에 알려줄 도구 설명서 (functionDeclarations) */
  declarations: function () {
    const signParam = { type: 'STRING', description: '별자리. 영문 식별자(aries, taurus, gemini, cancer, leo, virgo, libra, scorpio, sagittarius, capricorn, aquarius, pisces) 또는 한국어 이름(예: 양자리)' };
    const dateParam = { type: 'STRING', description: '날짜 yyyy-MM-dd. 생략하면 오늘' };
    return [{ functionDeclarations: [
      { name: 'get_horoscope', description: '한 별자리의 하루 운세(순위, 설명, 행운 아이템·색상)를 가져온다. 별자리를 생략하면 사용자의 별자리, 날짜를 생략하면 오늘.',
        parameters: { type: 'OBJECT', properties: { sign: signParam, date: dateParam } } },
      { name: 'get_ranking', description: '하루의 12별자리 전체 순위를 가져온다. 날짜를 생략하면 오늘.',
        parameters: { type: 'OBJECT', properties: { date: dateParam } } },
      { name: 'get_history', description: '최근 며칠 동안 한 별자리의 순위 기록과 요약(평균·최고·최저)을 가져온다. 별자리를 생략하면 사용자의 별자리.',
        parameters: { type: 'OBJECT', properties: { sign: signParam, days: { type: 'INTEGER', description: '최근 며칠(1~31). 기본 7' } } } },
      { name: 'compare_signs', description: '두 별자리의 하루 운세를 나란히 가져온다. sign_a를 생략하면 사용자의 별자리. (궁합 점수는 공식 정보가 아니므로 도구가 주지 않는다)',
        parameters: { type: 'OBJECT', properties: { sign_a: signParam, sign_b: signParam, date: dateParam }, required: ['sign_b'] } },
      { name: 'get_app_help', description: '별하루 앱 사용법을 가져온다. topic: notification, profile, history, ranking, data, privacy, share, update 중 하나. 모르면 생략.',
        parameters: { type: 'OBJECT', properties: { topic: { type: 'STRING', description: '안내 주제' } } } },
    ] }];
  },

  /** 도구 실행. 어떤 오류도 {error: '...'} 로 돌려줘서 AI가 사용자에게 설명할 수 있게 한다. */
  run: function (name, args, ctx) {
    args = (args && typeof args === 'object') ? args : {};
    try {
      switch (name) {
        case 'get_horoscope': {
          const sign = aiSignKey_(args.sign, ctx.sign);
          return aiHoroscopeOf_(aiDate_(args.date, ctx.today), sign);
        }
        case 'get_ranking': {
          const date = aiDate_(args.date, ctx.today);
          const res = HoroscopeService.getByDate(date);
          if (res.status !== 'MOCK' && res.status !== 'PUBLISHED') return { available: false, date: date, reason: res.message || res.status, official_link: res.official ? res.official.url : '', latest_available_date: res.latestDate || '' };
          return { available: true, date: date, is_test_data: !!res.isMock, ranking: res.items.map(function (i) { return { rank: i.rank, sign: i.zodiac_sign, sign_ko: ZODIAC_KO[i.zodiac_sign] }; }) };
        }
        case 'get_history': {
          const sign = aiSignKey_(args.sign, ctx.sign);
          let days = parseInt(args.days, 10); if (isNaN(days)) days = 7;
          days = Math.max(1, Math.min(31, days));
          const list = [];
          for (let i = days - 1; i >= 0; i--) {
            const d = addDays_(ctx.today, -i);
            const h = aiHoroscopeOf_(d, sign);
            list.push(h.available ? { date: d, rank: h.rank, is_test_data: h.is_test_data } : { date: d, rank: null });
          }
          const ranks = list.filter(function (x) { return x.rank !== null; });
          const out = { sign: sign, sign_ko: ZODIAC_KO[sign], days: days, records: list, record_count: ranks.length };
          if (ranks.length) {
            const sum = ranks.reduce(function (s, x) { return s + x.rank; }, 0);
            const best = ranks.reduce(function (m, x) { return x.rank < m.rank ? x : m; }), worst = ranks.reduce(function (m, x) { return x.rank > m.rank ? x : m; });
            out.average_rank = Math.round(sum / ranks.length * 10) / 10; out.best = best; out.worst = worst;
            out.is_test_data = ranks.some(function (x) { return x.is_test_data; });
          } else out.note = '이 기간에는 저장된 운세 기록이 없어요. (주말·휴방일이거나 보관 기간 밖일 수 있어요)';
          return out;
        }
        case 'compare_signs': {
          const a = aiSignKey_(args.sign_a, ctx.sign), b = aiSignKey_(args.sign_b, null), date = aiDate_(args.date, ctx.today);
          const ha = aiHoroscopeOf_(date, a), hb = aiHoroscopeOf_(date, b);
          const out = { date: date, a: ha, b: hb, note: '궁합 점수는 공식 정보가 아니에요. 순위와 문구를 바탕으로 한 AI 의견으로만 이야기해야 해요.' };
          if (ha.available && hb.available) out.rank_gap = Math.abs(ha.rank - hb.rank);
          return out;
        }
        case 'get_app_help': {
          const t = String(args.topic || '').trim().toLowerCase();
          if (AI_APP_HELP[t]) return { topic: t, text: AI_APP_HELP[t] };
          return { topics: AI_APP_HELP };
        }
        default:
          return { error: '알 수 없는 도구예요: ' + String(name).slice(0, 30) };
      }
    } catch (e) {
      return { error: e.message };
    }
  },
};
