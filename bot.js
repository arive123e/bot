require('dotenv').config(); // 🔐 Загружаем переменные из .env

const TelegramBot = require('node-telegram-bot-api');

// 🤖 Получаем токен Telegram-бота из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ Ошибка: не указан TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// 🎯 Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  // 🪄 Ссылка на портал авторизации VK ID с передачей tg_id
  const vkAuthUrl = `https://fokusnikaltair.xyz/vkid-auth.html?tg_id=${tgId}`;

  const welcomeText = '✨ Привет! Для авторизации через VK перейди по ссылке ниже:';

  bot.sendMessage(chatId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 Открыть портал VK ID', url: vkAuthUrl }]
      ]
    }
  });

  console.log(`📨 Отправлена ссылка авторизации пользователю ${tgId}`);
});
