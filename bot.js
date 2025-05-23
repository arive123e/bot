const TelegramBot = require('node-telegram-bot-api');
const token = '7986508775:AAFN9SFEqbFtu4kej7GnGhkiIUzzP7ZldWA'; // <-- Вставь сюда свой токен бота!
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const vkAuthUrl = `https://www.fokusnikaltair.xyz/?tg_id=${tgId}`; // <-- адрес фронта + tg_id

    const welcomeText = 'Привет! Для авторизации через VK перейди по ссылке ниже:';

    bot.sendMessage(chatId, welcomeText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Открыть портал VK", url: vkAuthUrl }]
            ]
        }
    });
});
