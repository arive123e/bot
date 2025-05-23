const TelegramBot = require('node-telegram-bot-api');
const token = 'ТВОЙ_ТОКЕН_ТГ_БОТА'; // вставь свой токен!
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const vkAuthUrl = `https://www.fokusnikaltair.xyz/?tg_id=${tgId}`;

    const welcomeText = `👋 Привет, путник! Я — Фокусник Альтаир, хранитель потоков VK и проводник в мир интересных новостей.

🔮 Чтобы открыть врата к своей магической ленте, потребуется заклинание авторизации через ВКонтакте.

Нажми на волшебную кнопку ниже и следуй по следу света! ✨`;

    bot.sendMessage(chatId, welcomeText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🪄 Открыть портал", url: vkAuthUrl }]
            ]
        }
    });
});
