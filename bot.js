const TelegramBot = require('node-telegram-bot-api');
const token = ''; // <-- Токен твоего бота
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    // Обновлённая ссылка на фронт с новым доменом!
    const vkAuthUrl = `https://fokusnikaltair.xyz/?tg_id=${tgId}`; // <-- без www (если домен работает так) и без api.

    const welcomeText = 'Привет! Для авторизации через VK перейди по ссылке ниже:';

    bot.sendMessage(chatId, welcomeText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Открыть портал VK", url: vkAuthUrl }]
            ]
        }
    });
});
