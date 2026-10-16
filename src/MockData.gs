/**
 * 테스트용 가상 운세 - 실제 오하아사 운세가 아니다.
 * 날짜를 씨앗(seed)으로 순위를 섞기 때문에 같은 날짜는 항상 같은 결과가 나오고,
 * 날짜가 바뀌면 순위가 달라진다. 순위는 항상 1~12가 한 번씩만 쓰인다.
 */
const MOCK_TEXTS = [
  { title: '새로운 가능성이 열리는 하루', content: '평소 망설였던 일에 도전해 보세요. 작은 시작이 좋은 결과로 이어질 수 있습니다.', item: '푸른 노트' },
  { title: '여유를 가지면 좋은 하루', content: '서두르기보다 한 박자 쉬어가면 좋아요. 주변 사람의 이야기에 귀 기울여 보세요.', item: '따뜻한 차' },
  { title: '작은 행운이 찾아오는 하루', content: '뜻밖의 곳에서 기분 좋은 소식이 들려올 수 있어요. 열린 마음으로 하루를 보내세요.', item: '은색 펜' },
  { title: '차분히 정리하기 좋은 하루', content: '미뤄둔 일을 하나씩 정리해 보세요. 마음이 한결 가벼워질 거예요.', item: '작은 화분' },
  { title: '대화가 힘이 되는 하루', content: '가까운 사람에게 먼저 안부를 전해 보세요. 반가운 답이 돌아올 수 있어요.', item: '손수건' },
  { title: '조금 천천히 가는 하루', content: '무리하지 말고 컨디션을 살피세요. 충분한 휴식이 내일의 힘이 됩니다.', item: '머그컵' },
  { title: '집중력이 빛나는 하루', content: '한 가지에 몰두하면 성과가 보일 거예요. 알림은 잠시 꺼 두는 것도 좋아요.', item: '이어폰' },
  { title: '기분 전환이 필요한 하루', content: '가벼운 산책이나 좋아하는 음악이 도움이 돼요. 나를 위한 시간을 가져 보세요.', item: '운동화' },
  { title: '감사가 커지는 하루', content: '당연하게 여겼던 것들에 고마움을 느껴 보세요. 작은 표현이 큰 기쁨이 됩니다.', item: '메모지' },
  { title: '꼼꼼함이 도움되는 하루', content: '확인할 것은 한 번 더 살펴보세요. 실수를 미리 막을 수 있어요.', item: '체크리스트' },
  { title: '용기를 내 보는 하루', content: '하고 싶었던 말이나 일이 있다면 오늘 가볍게 시도해 보세요.', item: '노란 양말' },
  { title: '마음을 돌보는 하루', content: '오늘은 나에게 다정해지는 날이에요. 좋아하는 것으로 하루를 마무리해 보세요.', item: '향초' },
];

const MOCK_LUCKY_COLORS = ['남색', '골드', '은색', '연보라', '하늘색', '아이보리'];

/** 문자열 → 숫자 씨앗 */
function seedFromString_(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 씨앗 기반 난수 생성기 (mulberry32) */
function makeRng_(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 해당 날짜의 가상 운세 12건 만들기 */
function buildMockHoroscopes_(dateStr) {
  const rng = makeRng_(seedFromString_('byeolharu-mock-' + dateStr));

  // 1~12위를 섞어서 별자리마다 하나씩 배정 (중복 없음)
  const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = ranks[i]; ranks[i] = ranks[j]; ranks[j] = tmp;
  }
  const texts = MOCK_TEXTS.slice();
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = texts[i]; texts[i] = texts[j]; texts[j] = tmp;
  }

  return ZODIAC_KEYS.map(function (key, i) {
    return {
      horoscope_date: dateStr,
      zodiac_sign: key,
      rank: ranks[i],
      title_ja: '',                       // 테스트 데이터에는 일본어 원문이 없다
      content_ja: '',
      title_ko: texts[i].title,
      content_ko: texts[i].content,
      lucky_item: texts[i].item,
      lucky_color: MOCK_LUCKY_COLORS[Math.floor(rng() * MOCK_LUCKY_COLORS.length)],
      source_name: '별하루 테스트 데이터 (가상)',
      source_url: '',
      source_published_at: '',
      translation_status: 'MOCK',
      publication_status: STATUS.MOCK,
    };
  });
}
