'use strict';

const crypto = require('crypto');
const { askOpenRouter, requestBody } = require('../lib/openrouter');
const LANGUAGES = require('../lib/languages');
const { parsePlantAnalysis } = require('../lib/plant-analysis');
const { deletePlantPhoto, putPlantPhoto } = require('../lib/blob-storage');
const { deleteArchiveItem, saveArchiveItem } = require('../lib/archive-store');
const { telegram } = require('../lib/telegram-api');
const { miniAppUrl } = require('../lib/reminder-messages');
const { getTelegramState, saveTelegramState } = require('../lib/telegram-store');
const { createLinkCode, getSharedRecord, mergeSharedRecord } = require('../lib/account-sync');
const { getMiniAppSettings, saveMiniAppSettings } = require('../lib/miniapp-settings');

const FIELD_LABELS = {
  ru: { confidence: 'Уверенность', watering: 'Полив', light: 'Свет', soil: 'Почва', temperature: 'Температура', safety: 'Безопасность', problems: 'Проблемы' },
  en: { confidence: 'Confidence', watering: 'Watering', light: 'Light', soil: 'Soil', temperature: 'Temperature', safety: 'Safety', problems: 'Problems' },
  uz: { confidence: 'Ishonchlilik', watering: 'Sug‘orish', light: 'Yorug‘lik', soil: 'Tuproq', temperature: 'Harorat', safety: 'Xavfsizlik', problems: 'Muammolar' },
  az: { confidence: 'Əminlik', watering: 'Suvarma', light: 'İşıq', soil: 'Torpaq', temperature: 'Temperatur', safety: 'Təhlükəsizlik', problems: 'Problemlər' },
  de: { confidence: 'Sicherheit', watering: 'Gießen', light: 'Licht', soil: 'Boden', temperature: 'Temperatur', safety: 'Sicherheit', problems: 'Probleme' },
  fr: { confidence: 'Confiance', watering: 'Arrosage', light: 'Lumière', soil: 'Sol', temperature: 'Température', safety: 'Sécurité', problems: 'Problèmes' },
  es: { confidence: 'Confianza', watering: 'Riego', light: 'Luz', soil: 'Suelo', temperature: 'Temperatura', safety: 'Seguridad', problems: 'Problemas' },
  pt: { confidence: 'Confiança', watering: 'Rega', light: 'Luz', soil: 'Solo', temperature: 'Temperatura', safety: 'Segurança', problems: 'Problemas' },
  ar: { confidence: 'الثقة', watering: 'الري', light: 'الضوء', soil: 'التربة', temperature: 'درجة الحرارة', safety: 'السلامة', problems: 'المشكلات' },
  tr: { confidence: 'Güven', watering: 'Sulama', light: 'Işık', soil: 'Toprak', temperature: 'Sıcaklık', safety: 'Güvenlik', problems: 'Sorunlar' },
  uk: { confidence: 'Впевненість', watering: 'Полив', light: 'Світло', soil: 'Ґрунт', temperature: 'Температура', safety: 'Безпека', problems: 'Проблеми' },
  kk: { confidence: 'Сенімділік', watering: 'Суару', light: 'Жарық', soil: 'Топырақ', temperature: 'Температура', safety: 'Қауіпсіздік', problems: 'Мәселелер' },
  ky: { confidence: 'Ишенимдүүлүк', watering: 'Сугаруу', light: 'Жарык', soil: 'Топурак', temperature: 'Температура', safety: 'Коопсуздук', problems: 'Көйгөйлөр' },
  tg: { confidence: 'Эътимод', watering: 'Обёрӣ', light: 'Равшанӣ', soil: 'Хок', temperature: 'Ҳарорат', safety: 'Бехатарӣ', problems: 'Мушкилот' },
  fa: { confidence: 'اطمینان', watering: 'آبیاری', light: 'نور', soil: 'خاک', temperature: 'دما', safety: 'ایمنی', problems: 'مشکلات' },
  hi: { confidence: 'विश्वास', watering: 'पानी', light: 'रोशनी', soil: 'मिट्टी', temperature: 'तापमान', safety: 'सुरक्षा', problems: 'समस्याएँ' },
  bn: { confidence: 'আস্থা', watering: 'পানি', light: 'আলো', soil: 'মাটি', temperature: 'তাপমাত্রা', safety: 'নিরাপত্তা', problems: 'সমস্যা' },
  zh: { confidence: '置信度', watering: '浇水', light: '光照', soil: '土壤', temperature: '温度', safety: '安全性', problems: '问题' },
  ja: { confidence: '信頼度', watering: '水やり', light: '光', soil: '土', temperature: '温度', safety: '安全性', problems: '問題' },
  ko: { confidence: '신뢰도', watering: '물주기', light: '빛', soil: '토양', temperature: '온도', safety: '안전', problems: '문제' },
  it: { confidence: 'Affidabilità', watering: 'Irrigazione', light: 'Luce', soil: 'Terreno', temperature: 'Temperatura', safety: 'Sicurezza', problems: 'Problemi' },
  nl: { confidence: 'Betrouwbaarheid', watering: 'Water geven', light: 'Licht', soil: 'Grond', temperature: 'Temperatuur', safety: 'Veiligheid', problems: 'Problemen' },
  pl: { confidence: 'Pewność', watering: 'Podlewanie', light: 'Światło', soil: 'Gleba', temperature: 'Temperatura', safety: 'Bezpieczeństwo', problems: 'Problemy' },
  cs: { confidence: 'Jistota', watering: 'Zalévání', light: 'Světlo', soil: 'Půda', temperature: 'Teplota', safety: 'Bezpečnost', problems: 'Problémy' },
  sk: { confidence: 'Istota', watering: 'Polievanie', light: 'Svetlo', soil: 'Pôda', temperature: 'Teplota', safety: 'Bezpečnosť', problems: 'Problémy' },
  sv: { confidence: 'Säkerhet', watering: 'Vattning', light: 'Ljus', soil: 'Jord', temperature: 'Temperatur', safety: 'Säkerhet', problems: 'Problem' },
  no: { confidence: 'Sikkerhet', watering: 'Vanning', light: 'Lys', soil: 'Jord', temperature: 'Temperatur', safety: 'Sikkerhet', problems: 'Problemer' },
  da: { confidence: 'Sikkerhed', watering: 'Vanding', light: 'Lys', soil: 'Jord', temperature: 'Temperatur', safety: 'Sikkerhed', problems: 'Problemer' },
  fi: { confidence: 'Varmuus', watering: 'Kastelu', light: 'Valo', soil: 'Maa', temperature: 'Lämpötila', safety: 'Turvallisuus', problems: 'Ongelmat' },
  el: { confidence: 'Βεβαιότητα', watering: 'Πότισμα', light: 'Φως', soil: 'Έδαφος', temperature: 'Θερμοκρασία', safety: 'Ασφάλεια', problems: 'Προβλήματα' },
  he: { confidence: 'רמת ודאות', watering: 'השקיה', light: 'אור', soil: 'אדמה', temperature: 'טמפרטורה', safety: 'בטיחות', problems: 'בעיות' },
  id: { confidence: 'Keyakinan', watering: 'Penyiraman', light: 'Cahaya', soil: 'Tanah', temperature: 'Suhu', safety: 'Keamanan', problems: 'Masalah' },
  ms: { confidence: 'Keyakinan', watering: 'Siraman', light: 'Cahaya', soil: 'Tanah', temperature: 'Suhu', safety: 'Keselamatan', problems: 'Masalah' },
  th: { confidence: 'ความมั่นใจ', watering: 'การรดน้ำ', light: 'แสง', soil: 'ดิน', temperature: 'อุณหภูมิ', safety: 'ความปลอดภัย', problems: 'ปัญหา' },
  vi: { confidence: 'Độ tin cậy', watering: 'Tưới nước', light: 'Ánh sáng', soil: 'Đất', temperature: 'Nhiệt độ', safety: 'An toàn', problems: 'Vấn đề' },
  ro: { confidence: 'Încredere', watering: 'Udare', light: 'Lumină', soil: 'Sol', temperature: 'Temperatură', safety: 'Siguranță', problems: 'Probleme' }
};

const MENU_KEYS = ['analyze', 'encyclopedia', 'expert', 'garden', 'calendar', 'language', 'home', 'add'];
const MENUS = {
  ru: ['Фотоанализ растений', 'Энциклопедия растений', 'Чат с экспертом', 'Моя оранжерея', 'Календарь полива', 'Язык', 'Главное меню', 'Добавить в оранжерею'],
  en: ['Analyze a plant photo', 'Plant encyclopedia', 'Ask the plant expert', 'My greenhouse', 'Watering calendar', 'Language', 'Main menu', 'Add to greenhouse'],
  uz: ["O'simlikni tahlil qilish", "O'simliklar ensiklopediyasi", "Mutaxassis bilan suhbat", "Mening issiqxonam", "Sug'orish taqvimi", 'Til', 'Asosiy menyu', "Issiqxonaga qo'shish"],
  az: ['Bitki şəklini təhlil et', 'Bitkilər ensiklopediyası', 'Ekspertlə söhbət', 'Mənim istixanam', 'Suvarma təqvimi', 'Dil', 'Əsas menyu', 'İstixanaya əlavə et'],
  de: ['Pflanzenfoto analysieren', 'Pflanzenlexikon', 'Pflanzenexperten fragen', 'Mein Gewächshaus', 'Gießkalender', 'Sprache', 'Hauptmenü', 'Zum Gewächshaus hinzufügen'],
  fr: ['Analyser une plante', 'Encyclopédie des plantes', 'Parler à un expert', 'Ma serre', 'Calendrier d’arrosage', 'Langue', 'Menu principal', 'Ajouter à la serre'],
  es: ['Analizar una planta', 'Enciclopedia de plantas', 'Consultar al experto', 'Mi invernadero', 'Calendario de riego', 'Idioma', 'Menú principal', 'Añadir al invernadero'],
  pt: ['Analisar uma planta', 'Enciclopédia de plantas', 'Falar com especialista', 'Minha estufa', 'Calendário de rega', 'Idioma', 'Menu principal', 'Adicionar à estufa'],
  ar: ['تحليل صورة نبات', 'موسوعة النباتات', 'اسأل خبير النباتات', 'الدفيئة الخاصة بي', 'تقويم الري', 'اللغة', 'القائمة الرئيسية', 'إضافة إلى الدفيئة'],
  tr: ['Bitki fotoğrafını analiz et', 'Bitki ansiklopedisi', 'Bitki uzmanına sor', 'Seram', 'Sulama takvimi', 'Dil', 'Ana menü', 'Seraya ekle'],
  uk: ['Аналіз фото рослини', 'Енциклопедія рослин', 'Запитати експерта', 'Моя оранжерея', 'Календар поливу', 'Мова', 'Головне меню', 'Додати до оранжереї'],
  kk: ['Өсімдік фотосын талдау', 'Өсімдіктер энциклопедиясы', 'Сарапшыдан сұрау', 'Менің жылыжайым', 'Суару күнтізбесі', 'Тіл', 'Басты мәзір', 'Жылыжайға қосу'],
  ky: ['Өсүмдүктүн сүрөтүн талдоо', 'Өсүмдүктөр энциклопедиясы', 'Адистен суроо', 'Менин күнөсканам', 'Сугаруу календары', 'Тил', 'Башкы меню', 'Күнөсканага кошуу'],
  tg: ['Таҳлили акси растанӣ', 'Донишномаи растаниҳо', 'Савол ба мутахассис', 'Гулхонаи ман', 'Тақвими обёрӣ', 'Забон', 'Менюи асосӣ', 'Ба гулхона илова кардан'],
  fa: ['تحلیل عکس گیاه', 'دانشنامه گیاهان', 'پرسش از کارشناس', 'گلخانه من', 'تقویم آبیاری', 'زبان', 'منوی اصلی', 'افزودن به گلخانه'],
  hi: ['पौधे की तस्वीर का विश्लेषण', 'पौधा विश्वकोश', 'विशेषज्ञ से पूछें', 'मेरा ग्रीनहाउस', 'पानी देने का कैलेंडर', 'भाषा', 'मुख्य मेनू', 'ग्रीनहाउस में जोड़ें'],
  bn: ['গাছের ছবি বিশ্লেষণ', 'উদ্ভিদ বিশ্বকোষ', 'বিশেষজ্ঞকে জিজ্ঞাসা করুন', 'আমার গ্রিনহাউস', 'পানি দেওয়ার ক্যালেন্ডার', 'ভাষা', 'প্রধান মেনু', 'গ্রিনহাউসে যোগ করুন'],
  zh: ['分析植物照片', '植物百科', '咨询植物专家', '我的温室', '浇水日历', '语言', '主菜单', '添加到温室'],
  ja: ['植物の写真を分析', '植物図鑑', '植物の専門家に質問', 'マイ温室', '水やりカレンダー', '言語', 'メインメニュー', '温室に追加'],
  ko: ['식물 사진 분석', '식물 백과사전', '식물 전문가에게 질문', '내 온실', '물 주기 달력', '언어', '메인 메뉴', '온실에 추가'],
  it: ['Analizza una pianta', 'Enciclopedia delle piante', 'Chiedi all’esperto', 'La mia serra', 'Calendario di irrigazione', 'Lingua', 'Menu principale', 'Aggiungi alla serra'],
  nl: ['Plantfoto analyseren', 'Plantenencyclopedie', 'Vraag de plantenexpert', 'Mijn kas', 'Bewateringskalender', 'Taal', 'Hoofdmenu', 'Toevoegen aan kas'],
  pl: ['Analizuj zdjęcie rośliny', 'Encyklopedia roślin', 'Zapytaj eksperta', 'Moja szklarnia', 'Kalendarz podlewania', 'Język', 'Menu główne', 'Dodaj do szklarni'],
  cs: ['Analyzovat rostlinu', 'Encyklopedie rostlin', 'Zeptat se odborníka', 'Můj skleník', 'Kalendář zalévání', 'Jazyk', 'Hlavní nabídka', 'Přidat do skleníku'],
  sk: ['Analyzovať rastlinu', 'Encyklopédia rastlín', 'Opýtať sa experta', 'Môj skleník', 'Kalendár polievania', 'Jazyk', 'Hlavné menu', 'Pridať do skleníka'],
  sv: ['Analysera en växt', 'Växtuppslagsverk', 'Fråga växtexperten', 'Mitt växthus', 'Vattningskalender', 'Språk', 'Huvudmeny', 'Lägg till i växthuset'],
  no: ['Analyser en plante', 'Planteleksikon', 'Spør planteeksperten', 'Drivhuset mitt', 'Vanningskalender', 'Språk', 'Hovedmeny', 'Legg til i drivhuset'],
  da: ['Analyser en plante', 'Planteleksikon', 'Spør planteeksperten', 'Mit drivhus', 'Vandingskalender', 'Sprog', 'Hovedmenu', 'Føj til drivhus'],
  fi: ['Analysoi kasvi', 'Kasvitietosanakirja', 'Kysy asiantuntijalta', 'Kasvihuoneeni', 'Kastelukalenteri', 'Kieli', 'Päävalikko', 'Lisää kasvihuoneeseen'],
  el: ['Ανάλυση φυτού', 'Εγκυκλοπαίδεια φυτών', 'Ρωτήστε τον ειδικό', 'Το θερμοκήπιό μου', 'Ημερολόγιο ποτίσματος', 'Γλώσσα', 'Κύριο μενού', 'Προσθήκη στο θερμοκήπιο'],
  he: ['ניתוח תמונת צמח', 'אנציקלופדיית צמחים', 'שאלו מומחה', 'החממה שלי', 'לוח השקיה', 'שפה', 'תפריט ראשי', 'הוספה לחממה'],
  id: ['Analisis foto tanaman', 'Ensiklopedia tanaman', 'Tanya ahli tanaman', 'Rumah kaca saya', 'Kalender penyiraman', 'Bahasa', 'Menu utama', 'Tambahkan ke rumah kaca'],
  ms: ['Analisis foto tumbuhan', 'Ensiklopedia tumbuhan', 'Tanya pakar tumbuhan', 'Rumah hijau saya', 'Kalendar siraman', 'Bahasa', 'Menu utama', 'Tambah ke rumah hijau'],
  th: ['วิเคราะห์รูปพืช', 'สารานุกรมพืช', 'ถามผู้เชี่ยวชาญด้านพืช', 'โรงเรือนของฉัน', 'ปฏิทินรดน้ำ', 'ภาษา', 'เมนูหลัก', 'เพิ่มไปยังโรงเรือน'],
  vi: ['Phân tích ảnh cây', 'Bách khoa thực vật', 'Hỏi chuyên gia cây trồng', 'Nhà kính của tôi', 'Lịch tưới nước', 'Ngôn ngữ', 'Menu chính', 'Thêm vào nhà kính'],
  ro: ['Analizează o plantă', 'Enciclopedia plantelor', 'Întreabă expertul', 'Sera mea', 'Calendar de udare', 'Limbă', 'Meniu principal', 'Adaugă în seră']
};

const COPY = {
  ru: {
    welcome: 'Привет! Я Botanika — помогу распознать растение и ухаживать за ним. Выбери действие в меню.',
    choosePhoto: 'Пришли фото растения, и я попробую определить его и дать рекомендации.',
    askPlant: 'Напиши название растения, которое нужно найти в энциклопедии.',
    askExpert: 'Задай вопрос о растениях. Чтобы закончить чат, нажми «Главное меню».',
    noPlants: 'Оранжерея пока пуста. Сначала проанализируй растение и добавь его кнопкой под результатом.',
    calendar: 'Календарь полива',
    due: 'Полить сегодня',
    next: 'Следующий полив',
    watered: 'Полив отмечен.',
    added: 'Добавлено в оранжерею.',
    alreadyAdded: 'Это растение уже есть в оранжерее.',
    analyzing: 'Анализирую фото…',
    fetching: 'Готовлю справку…',
    thinking: 'Эксперт готовит ответ…',
    language: 'Выбери язык меню и ответов:',
    languageSaved: 'Язык сохранён.',
    usePrivate: 'Бот работает в личном чате. Открой его и нажми /start.',
    unknown: 'Выбери действие в меню или отправь /start.',
    failed: 'Не удалось выполнить запрос. Попробуй позже; если ошибка повторяется, сообщи владельцу бота.',
    photoTooLarge: 'Фото слишком большое для обработки. Отправь его как обычное фото, а не как файл.',
    noPhoto: 'Пришли фото растения как изображение.',
    encSource: 'Источник для чтения',
    dueToday: 'сегодня',
    inDays: 'через {n} дн.',
    emptyCalendar: 'Добавленных растений пока нет.',
    historyOpen: 'История Botanika открывается в мини-приложении ниже.',
    linkCreated: 'Введите этот код в настройках сайта в течение 10 минут, чтобы связать сайт с этим Telegram-аккаунтом.'
  },
  en: {
    welcome: 'Hi! I’m Botanika. I can identify plants and help you care for them. Choose an option below.',
    choosePhoto: 'Send a plant photo and I’ll try to identify it and suggest care tips.',
    askPlant: 'Type a plant name to look up in the encyclopedia.',
    askExpert: 'Ask a plant-care question. Choose “Main menu” when you’re done.',
    noPlants: 'Your greenhouse is empty. Analyze a plant first, then add it with the button under the result.',
    calendar: 'Watering calendar',
    due: 'Water today',
    next: 'Next watering',
    watered: 'Watering recorded.',
    added: 'Added to your greenhouse.',
    alreadyAdded: 'This plant is already in your greenhouse.',
    analyzing: 'Analyzing photo…',
    fetching: 'Preparing the plant profile…',
    thinking: 'The expert is preparing an answer…',
    language: 'Choose the language for the menu and replies:',
    languageSaved: 'Language saved.',
    usePrivate: 'This bot works in a private chat. Open it and send /start.',
    unknown: 'Choose an option from the menu or send /start.',
    failed: 'The request failed. Please try again later; if this keeps happening, contact the bot owner.',
    photoTooLarge: 'That photo is too large to process. Send it as a regular photo, not as a file.',
    noPhoto: 'Please send the plant as a photo.',
    encSource: 'Read the reference',
    dueToday: 'today',
    inDays: 'in {n} days',
    emptyCalendar: 'No plants have been added yet.',
    historyOpen: 'Open your Botanika history in the Mini App below.',
    linkCreated: 'Enter this code in the website settings within 10 minutes to connect the site to this Telegram account.'
  },
  uz: {
    welcome: "Salom! Men Botanika. O'simlikni aniqlash va parvarish qilishda yordam beraman. Menyudan bo'limni tanlang.",
    choosePhoto: "O'simlik rasmini yuboring — uni aniqlab, parvarish bo'yicha tavsiya beraman.",
    askPlant: 'Ensiklopediyadan qidirish uchun o‘simlik nomini yozing.',
    askExpert: 'O‘simlik haqida savol bering. Tugatgach, “Asosiy menyu”ni tanlang.',
    noPlants: "Issiqxonangiz hozircha bo'sh. Avval o'simlikni tahlil qiling, so'ng natija ostidagi tugma bilan qo'shing.",
    calendar: "Sug'orish taqvimi",
    due: 'Bugun sug‘orish kerak',
    next: 'Keyingi sug‘orish',
    watered: 'Sug‘orish qayd etildi.',
    added: 'Issiqxonaga qo‘shildi.',
    alreadyAdded: "Bu o'simlik issiqxonada allaqachon bor.",
    analyzing: 'Rasm tahlil qilinmoqda…',
    fetching: 'O‘simlik haqida ma’lumot tayyorlanmoqda…',
    thinking: 'Mutaxassis javob tayyorlamoqda…',
    language: 'Menyu va javoblar tilini tanlang:',
    languageSaved: 'Til saqlandi.',
    usePrivate: 'Bot shaxsiy chatda ishlaydi. Uni ochib, /start yuboring.',
    unknown: 'Menyudan bo‘lim tanlang yoki /start yuboring.',
    failed: 'So‘rov bajarilmadi. Keyinroq urinib ko‘ring; xato takrorlansa, bot egasiga xabar bering.',
    photoTooLarge: 'Rasm juda katta. Uni fayl emas, oddiy foto sifatida yuboring.',
    noPhoto: 'O‘simlik rasmini foto sifatida yuboring.',
    encSource: 'Manbani o‘qish',
    dueToday: 'bugun',
    inDays: '{n} kundan keyin',
    emptyCalendar: 'Hozircha o‘simlik qo‘shilmagan.',
    historyOpen: 'Botanika tarixini quyidagi mini-ilovada oching.',
    linkCreated: 'Saytni shu Telegram akkauntiga ulash uchun kodni 10 daqiqa ichida sayt sozlamalariga kiriting.'
  }
};

function copy(language, key) {
  const messages = COPY[language] || COPY.en;
  return messages[key] || COPY.en[key] || key;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function menuMarkup(language) {
  return {
    keyboard: [
      [{ text: '🌿 Botanika', web_app: { url: miniAppUrl() } }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function languageMarkup() {
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  const codes = Object.keys(LANGUAGES);
  const rows = [];
  for (let i = 0; i < codes.length; i += 2) {
    rows.push(codes.slice(i, i + 2).map(code => ({
      text: names.of(code) || code,
      callback_data: `lang:${code}`
    })));
  }
  return { inline_keyboard: rows };
}

async function sendMessage(chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true }
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegram('sendMessage', payload);
}

async function replaceMessage(chatId, messageId, text, replyMarkup) {
  const chunks = [];
  let rest = String(text);
  while (rest.length > 3800) {
    let splitAt = rest.lastIndexOf('\n', 3800);
    if (splitAt < 1000) splitAt = 3800;
    chunks.push(rest.slice(0, splitAt));
    rest = rest.slice(splitAt).trimStart();
  }
  chunks.push(rest);
  await telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: chunks[0],
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    link_preview_options: { is_disabled: true }
  });
  for (const chunk of chunks.slice(1)) await sendMessage(chatId, chunk);
}

async function sendMainMenu(chatId, state, text) {
  await sendMessage(chatId, text || copy(state.lang, 'welcome'), menuMarkup(state.lang));
}

function languageFromTelegram(message) {
  const requested = String(message.from?.language_code || 'ru').split('-')[0];
  return Object.prototype.hasOwnProperty.call(LANGUAGES, requested) ? requested : 'ru';
}

function findMenuAction(text, language) {
  const labels = MENUS[language] || MENUS.en;
  const index = labels.indexOf(text);
  if (index >= 0 && index < MENU_KEYS.length) return MENU_KEYS[index];
  for (const [code, menu] of Object.entries(MENUS)) {
    const found = menu.indexOf(text);
    if (found >= 0 && found < MENU_KEYS.length) return MENU_KEYS[found];
  }
  return '';
}

function makeSharedId() {
  return Math.floor(Date.now() / 1000) * 100000 + crypto.randomInt(100000);
}

function sharedHistoryItem(analysis) {
  const result = analysis.result || {};
  return {
    id: analysis.recordId,
    gardenId: analysis.gardenId,
    telegramAnalysisId: analysis.id,
    updatedAt: analysis.createdAt || Date.now(),
    name: analysis.name,
    latin: result.latin || '',
    family: result.family || '',
    type: result.type || '',
    confidence: result.confidence || 0,
    description: result.description || '',
    care: result.care || {},
    watering_days: analysis.wateringDays,
    problems: result.problems || [],
    toxic: result.toxic || '',
    fun_fact: result.fun_fact || '',
    imagePath: analysis.imagePath || '',
    date: new Date(analysis.createdAt || Date.now()).toISOString()
  };
}

async function ensureLegacySharedData(userId, state) {
  let changed = false;
  for (const analysis of state.analyses) {
    if (!Number.isSafeInteger(analysis.recordId)) {
      analysis.recordId = makeSharedId();
      changed = true;
    }
    if (!Number.isSafeInteger(analysis.gardenId)) {
      analysis.gardenId = makeSharedId();
      changed = true;
    }
  }
  for (const plant of state.plants) {
    if (!Number.isSafeInteger(plant.sharedId)) {
      plant.sharedId = makeSharedId();
      changed = true;
    }
  }
  if (changed) await saveTelegramState(userId, state);

  let archiveChanged = false;
  for (const analysis of state.analyses) {
    if (analysis.archiveSynced) continue;
    await saveArchiveItem(userId, sharedHistoryItem(analysis));
    analysis.archiveSynced = true;
    archiveChanged = true;
  }
  if (archiveChanged) await saveTelegramState(userId, state);

  const history = state.analyses.filter(item => !item.sharedSynced);
  const greenhouse = state.plants.filter(item => !item.sharedSynced);
  if (!history.length && !greenhouse.length) return;

  await mergeSharedRecord(userId, {
    history: history.map(sharedHistoryItem),
    greenhouse: greenhouse.map(plant => ({
      id: plant.sharedId,
      updatedAt: plant.updatedAt || plant.wateredAt || Date.now(),
      name: plant.name,
      days: plant.wateringDays,
      last: plant.wateredAt,
      sourceAnalysisId: plant.analysisId || '',
      imagePath: plant.imagePath || ''
    }))
  });
  history.forEach(item => { item.sharedSynced = true; });
  greenhouse.forEach(item => { item.sharedSynced = true; });
  await saveTelegramState(userId, state);
}

function formatAnalysis(result, language) {
  const labels = FIELD_LABELS[language] || FIELD_LABELS.en;
  const fields = [
    result.name,
    result.latin,
    result.description,
    `${labels.confidence}: ${result.confidence}%`,
    `${labels.watering}: ${result.care.water || ''}`,
    `${labels.light}: ${result.care.light || ''}`,
    `${labels.soil}: ${result.care.soil || ''}`,
    `${labels.temperature}: ${result.care.temperature || ''}`,
    `${labels.safety}: ${result.toxic || ''}`
  ].filter(Boolean);
  if (Array.isArray(result.problems) && result.problems.length) {
    fields.push(`${labels.problems}: ${result.problems.join(', ')}`);
  }
  return fields.join('\n');
}

async function analyzePhoto(message, chatId, state, userId) {
  const photo = message.photo[message.photo.length - 1];
  const status = await sendMessage(chatId, copy(state.lang, 'analyzing'));
  try {
    if (photo.file_size && photo.file_size > 2500000) {
      throw new Error(copy(state.lang, 'photoTooLarge'));
    }
    const file = await telegram('getFile', { file_id: photo.file_id });
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path.split('/').map(encodeURIComponent).join('/')}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Telegram photo download returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2500000) throw new Error(copy(state.lang, 'photoTooLarge'));
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) throw new Error('Telegram returned an unsupported image format');
    const image = `data:${contentType};base64,${bytes.toString('base64')}`;
    const language = LANGUAGES[state.lang] || LANGUAGES.ru;
    const prompt = `You are a careful botanist. Identify the plant in the attached image and answer in ${language}. Return ONLY a valid JSON object with fields: {"name":"","latin":"","confidence":0,"description":"","care":{"water":"","light":"","soil":"","temperature":""},"watering_days":7,"problems":[],"toxic":""}. Use a whole number for confidence and watering_days (1-60). Mention visible symptoms without claiming a certain disease from an image alone. Give safe, practical care advice and clearly state uncertainty.`;
    const text = await askOpenRouter([
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Identify this plant and provide the requested care information.' },
          { type: 'image_url', image_url: { url: image } }
        ]
      }
    ], 1000, 35000);
    const result = parsePlantAnalysis(text);
    const imagePath = await putPlantPhoto(userId, bytes, contentType);
    const analysis = {
      id: crypto.randomBytes(6).toString('hex'),
      recordId: makeSharedId(),
      gardenId: makeSharedId(),
      name: result.name.trim(),
      wateringDays: result.watering_days,
      createdAt: Date.now(),
      imagePath,
      archiveSynced: false,
      result
    };
    try {
      await saveArchiveItem(userId, sharedHistoryItem(analysis));
      analysis.archiveSynced = true;
      await mergeSharedRecord(userId, { history: [sharedHistoryItem(analysis)] });
      analysis.sharedSynced = true;
    } catch (error) {
      try {
        await mergeSharedRecord(userId, {
          tombstones: { history: { [String(analysis.recordId)]: Date.now() } }
        });
      } catch (cleanupError) {
        console.error('Could not remove an incomplete Telegram analysis from shared history:', cleanupError.message);
      }
      try {
        await deleteArchiveItem(userId, analysis.recordId);
      } catch (cleanupError) {
        console.error('Could not remove an incomplete Telegram analysis from the archive:', cleanupError.message);
      }
      try {
        await deletePlantPhoto(userId, imagePath);
      } catch (cleanupError) {
        console.error('Could not remove an unlinked Telegram plant photo:', cleanupError.message);
      }
      throw error;
    }
    state.analyses.unshift(analysis);
    state.analyses = state.analyses.slice(0, 10);
    state.mode = '';
    await saveTelegramState(userId, state);
    await replaceMessage(chatId, status.message_id, formatAnalysis(result, state.lang), {
      inline_keyboard: [[{ text: (MENUS[state.lang] || MENUS.en)[7], callback_data: `garden:add:${analysis.id}` }]]
    });
  } catch (error) {
    await replaceMessage(chatId, status.message_id, error.message || copy(state.lang, 'failed'));
  }
}

async function findEncyclopediaReferences(query, language) {
  const wikiUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  wikiUrl.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    format: 'json'
  });
  const commonsUrl = new URL('https://commons.wikimedia.org/w/api.php');
  commonsUrl.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} plant`,
    gsrnamespace: '6',
    gsrsetlang: 'en',
    gsrlimit: '3',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '700',
    format: 'json'
  });
  const headers = { 'User-Agent': 'BotanikaAI/1.0 (plant encyclopedia)' };
  const [wikiResponse, commonsResponse] = await Promise.all([
    fetch(wikiUrl, { headers, signal: AbortSignal.timeout(12000) }),
    fetch(commonsUrl, { headers, signal: AbortSignal.timeout(12000) })
  ]);
  if (!wikiResponse.ok) throw new Error(`Wikipedia returned HTTP ${wikiResponse.status}`);
  if (!commonsResponse.ok) throw new Error(`Wikimedia returned HTTP ${commonsResponse.status}`);
  const [wikiData, commonsData] = await Promise.all([wikiResponse.json(), commonsResponse.json()]);
  const wiki = Object.values(wikiData.query?.pages || {})[0];
  const images = Object.values(commonsData.query?.pages || {})
    .filter(page => page.imageinfo?.[0]?.thumburl)
    .map(page => ({
      title: page.title,
      url: page.imageinfo[0].thumburl
    }));
  return {
    wiki: wiki ? { title: wiki.title, url: wiki.fullurl, extract: wiki.extract || '' } : null,
    images
  };
}

async function answerEncyclopedia(message, chatId, state, userId) {
  const query = message.text.trim();
  if (!query || query.length > 120) {
    await sendMessage(chatId, copy(state.lang, 'askPlant'));
    return;
  }
  const status = await sendMessage(chatId, copy(state.lang, 'fetching'));
  const language = LANGUAGES[state.lang] || LANGUAGES.ru;
  try {
    const [answer, references] = await Promise.allSettled([
      askOpenRouter([
        {
          role: 'system',
          content: `You are a careful plant encyclopedia. Answer in ${language}. Give a concise profile with scientific name, description, practical care, common uses, and safety/toxicity. Distinguish traditional use from proven medical benefit; never claim a plant cures disease. State uncertainty where appropriate.`
        },
        { role: 'user', content: `Plant search: ${query}` }
      ], 900, 35000),
      findEncyclopediaReferences(query, state.lang)
    ]);
    if (answer.status === 'rejected') throw answer.reason;
    const reference = references.status === 'fulfilled' ? references.value : { wiki: null, images: [] };
    if (references.status === 'rejected') console.warn('Telegram encyclopedia references failed:', references.reason.message);
    const wikiSearch = `https://${state.lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
    const wikiText = reference.wiki?.extract ? `\n\n${reference.wiki.title}\n${reference.wiki.extract}` : '';
    const wikiLink = reference.wiki?.url || wikiSearch;
    state.mode = '';
    await saveTelegramState(userId, state);
    await replaceMessage(chatId, status.message_id, `${answer.value}${wikiText}\n\n${copy(state.lang, 'encSource')}: ${wikiLink}`, menuMarkup(state.lang));
    for (const image of reference.images.slice(0, 2)) {
      try {
        await telegram('sendPhoto', {
          chat_id: chatId,
          photo: image.url,
          caption: image.title.slice(0, 900)
        });
      } catch (error) {
        console.warn('Telegram encyclopedia image delivery failed:', error.message);
      }
    }
  } catch (error) {
    await replaceMessage(chatId, status.message_id, error.message || copy(state.lang, 'failed'), menuMarkup(state.lang));
  }
}

async function answerExpert(message, chatId, state, userId) {
  const question = message.text.trim();
  if (!question || question.length > 2000) {
    await sendMessage(chatId, copy(state.lang, 'askExpert'));
    return;
  }
  const status = await sendMessage(chatId, copy(state.lang, 'thinking'));
  const language = LANGUAGES[state.lang] || LANGUAGES.ru;
  const conversation = [
    { role: 'system', content: `You are a careful, practical plant-care expert. Reply in ${language}. Keep answers friendly and under 250 words. Do not present uncertain diagnosis as fact.` },
    ...state.chat.slice(-10),
    { role: 'user', content: question }
  ];
  try {
    const text = await askOpenRouter(conversation, 900, 35000);
    state.chat.push({ role: 'user', content: question }, { role: 'assistant', content: text });
    state.chat = state.chat.slice(-12);
    await saveTelegramState(userId, state);
    await replaceMessage(chatId, status.message_id, text, menuMarkup(state.lang));
  } catch (error) {
    await replaceMessage(chatId, status.message_id, error.message || copy(state.lang, 'failed'), menuMarkup(state.lang));
  }
}

function formatGarden(plants, language) {
  if (!plants.length) return copy(language, 'noPlants');
  return plants.map(plant => {
    const lastWatered = plant.last || plant.wateredAt || Date.now();
    const daysBetween = plant.days || plant.wateringDays || 7;
    const dueAt = lastWatered + daysBetween * 86400000;
    const days = Math.ceil((dueAt - Date.now()) / 86400000);
    const when = days <= 0 ? copy(language, 'due') : copy(language, 'inDays').replace('{n}', days);
    return `${plant.name}\n${copy(language, 'next')}: ${when}`;
  }).join('\n\n');
}

async function handleCallback(callback) {
  if (callback.message?.chat?.type !== 'private') return;
  const userId = callback.from.id;
  const language = languageFromTelegram({ from: callback.from });
  const state = await getTelegramState(userId, language);
  await ensureLegacySharedData(userId, state);
  await telegram('answerCallbackQuery', { callback_query_id: callback.id });
  const data = callback.data || '';
  if (data.startsWith('lang:')) {
    const selected = data.slice(5);
    if (!Object.prototype.hasOwnProperty.call(LANGUAGES, selected)) return;
    const preferences = await getMiniAppSettings(userId, selected);
    await saveMiniAppSettings(userId, { ...preferences, language: selected });
    state.lang = selected;
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMainMenu(callback.message.chat.id, state, copy(state.lang, 'languageSaved'));
    return;
  }
  if (data.startsWith('garden:add:')) {
    const analysisId = data.slice('garden:add:'.length);
    const analysis = state.analyses.find(item => item.id === analysisId);
    if (!analysis) {
      await sendMessage(callback.message.chat.id, copy(state.lang, 'failed'), menuMarkup(state.lang));
      return;
    }
    const shared = await getSharedRecord(userId);
    if (shared.greenhouse.some(item => item.sourceAnalysisId === analysisId)) {
      await sendMessage(callback.message.chat.id, copy(state.lang, 'alreadyAdded'), menuMarkup(state.lang));
      return;
    }
    const timestamp = Date.now();
    const plant = {
      id: crypto.randomBytes(5).toString('hex'),
      analysisId,
      sharedId: analysis.gardenId,
      name: analysis.name,
      wateringDays: analysis.wateringDays,
      wateredAt: timestamp,
      updatedAt: timestamp,
      imagePath: analysis.imagePath || '',
      sharedSynced: true
    };
    await mergeSharedRecord(userId, {
      greenhouse: [{
        id: plant.sharedId,
        updatedAt: timestamp,
        name: plant.name,
        days: plant.wateringDays,
        last: plant.wateredAt,
        sourceAnalysisId: analysisId,
        imagePath: plant.imagePath
      }]
    });
    state.plants.unshift(plant);
    state.plants = state.plants.slice(0, 30);
    await saveTelegramState(userId, state);
    await sendMessage(callback.message.chat.id, copy(state.lang, 'added'), menuMarkup(state.lang));
    return;
  }
  if (data.startsWith('garden:water:')) {
    const plantId = data.slice('garden:water:'.length);
    const shared = await getSharedRecord(userId);
    const plant = shared.greenhouse.find(item => String(item.id) === plantId);
    const localPlant = state.plants.find(item => item.id === plantId || String(item.sharedId) === plantId);
    if (!plant && !localPlant) {
      await sendMessage(callback.message.chat.id, copy(state.lang, 'failed'), menuMarkup(state.lang));
      return;
    }
    const timestamp = Date.now();
    if (plant) {
      plant.last = timestamp;
      plant.updatedAt = timestamp;
      await mergeSharedRecord(userId, { greenhouse: [plant] });
    }
    if (localPlant) {
      localPlant.wateredAt = timestamp;
      localPlant.updatedAt = timestamp;
    }
    await saveTelegramState(userId, state);
    await sendMessage(callback.message.chat.id, copy(state.lang, 'watered'), menuMarkup(state.lang));
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  if (message.chat.type !== 'private') {
    await sendMessage(chatId, copy(languageFromTelegram(message), 'usePrivate'));
    return;
  }
  const userId = message.from.id;
  const state = await getTelegramState(userId, languageFromTelegram(message));
  await ensureLegacySharedData(userId, state);
  const preferences = await getMiniAppSettings(userId, state.lang);
  if (state.lang !== preferences.language) {
    state.lang = preferences.language;
    await saveTelegramState(userId, state);
  }
  const text = typeof message.text === 'string' ? message.text.trim() : '';

  if (/^\/history(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMainMenu(chatId, state, copy(state.lang, 'historyOpen'));
    return;
  }

  if (/^\/link(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    const code = await createLinkCode(userId);
    await sendMessage(chatId, `${copy(state.lang, 'linkCreated')}\n\n${code}`);
    return;
  }

  if (/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMainMenu(chatId, state);
    return;
  }
  if (text === '/language' || text === '/lang') {
    await sendMessage(chatId, copy(state.lang, 'language'), languageMarkup());
    return;
  }
  if (text === '/clear') {
    state.chat = [];
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMainMenu(chatId, state);
    return;
  }

  if (Array.isArray(message.photo) && message.photo.length) {
    await analyzePhoto(message, chatId, state, userId);
    return;
  }
  if (message.document?.mime_type?.startsWith('image/')) {
    await sendMessage(chatId, copy(state.lang, 'noPhoto'), menuMarkup(state.lang));
    return;
  }

  const action = findMenuAction(text, state.lang);
  if (action === 'analyze') {
    state.mode = 'analyze';
    await saveTelegramState(userId, state);
    await sendMessage(chatId, copy(state.lang, 'choosePhoto'), menuMarkup(state.lang));
    return;
  }
  if (action === 'encyclopedia') {
    state.mode = 'encyclopedia';
    await saveTelegramState(userId, state);
    await sendMessage(chatId, copy(state.lang, 'askPlant'), menuMarkup(state.lang));
    return;
  }
  if (action === 'expert') {
    state.mode = 'expert';
    await saveTelegramState(userId, state);
    await sendMessage(chatId, copy(state.lang, 'askExpert'), menuMarkup(state.lang));
    return;
  }
  if (action === 'garden') {
    state.mode = '';
    const shared = await getSharedRecord(userId);
    const plants = shared.greenhouse;
    const textOut = plants.length ? formatGarden(plants, state.lang) : copy(state.lang, 'noPlants');
    const markup = plants.length ? {
      inline_keyboard: plants.map(plant => [{
        text: `${(MENUS[state.lang] || MENUS.en)[4]}: ${plant.name}`,
        callback_data: `garden:water:${plant.id}`
      }]).slice(0, 20)
    } : menuMarkup(state.lang);
    await sendMessage(chatId, textOut, markup);
    return;
  }
  if (action === 'calendar') {
    state.mode = '';
    const shared = await getSharedRecord(userId);
    const textOut = shared.greenhouse.length
      ? `${copy(state.lang, 'calendar')}\n\n${formatGarden(shared.greenhouse, state.lang)}`
      : copy(state.lang, 'emptyCalendar');
    await sendMessage(chatId, textOut, menuMarkup(state.lang));
    return;
  }
  if (action === 'language') {
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMessage(chatId, copy(state.lang, 'language'), languageMarkup());
    return;
  }
  if (action === 'home') {
    state.mode = '';
    await saveTelegramState(userId, state);
    await sendMainMenu(chatId, state);
    return;
  }
  if (state.mode === 'encyclopedia') {
    await answerEncyclopedia(message, chatId, state, userId);
    return;
  }
  if (state.mode === 'expert') {
    await answerExpert(message, chatId, state, userId);
    return;
  }
  await sendMessage(chatId, copy(state.lang, 'unknown'), menuMarkup(state.lang));
}

module.exports = async function telegramWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return res.status(503).send('Telegram bot is not configured');
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], secret)) {
    return res.status(401).send('Unauthorized');
  }
  const update = requestBody(req);
  if (!update || typeof update !== 'object') return res.status(400).send('Invalid update');

  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return res.status(200).send('ok');
  } catch (error) {
    console.error('Telegram webhook failed:', error.message);
    return res.status(500).send('Telegram webhook failed');
  }
};
