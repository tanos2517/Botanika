'use strict';

const LABELS = {
  ru: { title: 'Пора позаботиться о растениях:', watered: 'Отметить полив можно в Botanika.' },
  en: { title: 'Your plants need care:', watered: 'You can record watering in Botanika.' },
  uz: { title: 'O‘simliklarga g‘amxo‘rlik qilish vaqti:', watered: 'Sug‘orishni Botanika’da belgilashingiz mumkin.' }
};

function miniAppUrl() {
  const base = process.env.APP_URL || 'https://botanika-ai.vercel.app';
  return new URL('/telegram-miniapp.html', base).toString();
}

function reminderMessage(language, plants) {
  const labels = LABELS[language] || LABELS.en;
  const names = plants
    .map(plant => String(plant.name || '').replace(/\s+/g, ' ').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 30);
  return {
    text: `${labels.title}\n${names.map(name => `• ${name}`).join('\n')}\n\n${labels.watered}`,
    reply_markup: {
      inline_keyboard: [[{
        text: '🌿 Botanika',
        web_app: { url: miniAppUrl() }
      }]]
    }
  };
}

module.exports = { miniAppUrl, reminderMessage };
