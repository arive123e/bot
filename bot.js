require('dotenv').config(); // 🔐 Загружаем переменные из .env

const TelegramBot = require('node-telegram-bot-api');

// 🤖 Получаем токен Telegram-бота из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ Ошибка: не указан TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Добавь это сразу после создания бота
bot.on('message', (msg) => {
  console.log('Получено сообщение в чате:', msg.chat.title || msg.chat.username || msg.chat.id);
  console.log('chat_id:', msg.chat.id);
});

// 🎯 Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  // 🪄 Ссылка на портал авторизации VK ID с передачей tg_id
  const vkAuthUrl = `https://fokusnikaltair.xyz/vkid-auth.html?tg_id=${tgId}`;

  const welcomeText = `Этот бот умеет в одно касание показывать новости из ваших любимых VK-групп прямо в Telegram.
Без лишних хлопот — только самые важные обновления, с магическим удобством и заботой о вашей приватности ✨
`;

  bot.sendMessage(chatId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть портал VK ID ✨', url: vkAuthUrl }]
      ]
    }
  });

  console.log(`📨 Отправлена ссылка авторизации пользователю ${tgId}`);
});
