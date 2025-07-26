require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');   // <- ОДИН раз!
const path = require('path');
const usersPath = '/root/vk-backend/users.json';

// Подгружаем sentPosts из файла при запуске (или создаём пустой объект)
let sentPosts = {};
if (fs.existsSync('sentPosts.json')) {
  sentPosts = JSON.parse(fs.readFileSync('sentPosts.json', 'utf-8'));
}

// Функция для поиска пользователя по tg_id
function getUserData(tgId) {
  if (!fs.existsSync(usersPath)) return null;
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  return Object.values(users).find(u => String(u.tg_id) === String(tgId) && u.status === 'ok');
}

const MAX_GROUPS_FREE = 5; // сколько групп выбрать бесплатно
const UNLIMITED_USERS = [792903459, 1022172210];
const groupTitles = {};

let userSelectedGroups = {};
if (fs.existsSync('userSelectedGroups.json')) {
  userSelectedGroups = JSON.parse(fs.readFileSync('userSelectedGroups.json', 'utf-8'));
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const SUPPORT_CHAT_ID = -4778492984; // chat_id группы поддержки

if (!token) {
  console.error('❌ Ошибка: не указан TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const replyContext = {}; // Кому отвечает магистр поддержки

const MAX_TEXT_LENGTH = 2000;
const MAX_CAPTION_LENGTH = 1024; 

async function fetchGroupTitle(groupId, vkAccessToken) {
  try {
    const res = await axios.get('https://api.vk.com/method/groups.getById', {
      params: {
        group_id: Math.abs(groupId),
        access_token: vkAccessToken,
        v: '5.199'
      }
    });
    if (res.data.response && res.data.response[0]) {
      return res.data.response[0].name;
    }
    return null;
  } catch (e) {
    console.log('Ошибка получения названия группы:', e?.response?.data || e.message || e);
    return null;
  }
}

// --- Форматирование для обычного текста ---
function formatVkPost(text, groupName, postUrl) {
  const boldGroup = `<b>${groupName}</b>`;
  let body = text && text.trim().length > 0
    ? `${boldGroup}\n\n${text.trim()}`
    : boldGroup;
  let needCut = body.length > MAX_TEXT_LENGTH;
  let visibleText = needCut
    ? body.slice(0, MAX_TEXT_LENGTH - 20) + '\n\n...Продолжение ⬇️'
    : body;
  const buttons = [
    [{ text: "✨ Призвать весь пост в VK", url: postUrl }]
  ];
  return { text: visibleText, buttons };
}

// --- Форматирование для caption (фото, документы) ---
function formatVkCaption(text, groupName, postUrl) {
  const boldGroup = `<b>${groupName}</b>`;
  let body = text && text.trim().length > 0
    ? `${boldGroup}\n\n${text.trim()}`
    : boldGroup;
  let needCut = body.length > MAX_CAPTION_LENGTH;
  let visibleText = needCut
    ? body.slice(0, MAX_CAPTION_LENGTH - 20) + '\n\n...Продолжение ⬇️'
    : body;
  const buttons = [
    [{ text: "✨ Призвать весь пост в VK", url: postUrl }]
  ];
  return { caption: visibleText, buttons };
}


// =========================
// 1. СТАРТ, ПОРТАЛ, ПРИВЕТСТВИЕ
// =========================

bot.onText(/\/start/, async (msg) => { // <--- вот здесь добавь async
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const vkAuthUrl = `https://fokusnikaltair.xyz/vkid-auth.html?tg_id=${tgId}`;

  const welcomeText = `Абра-кадабра и немного кода 🧙‍♂️

Поздравляю, ты только что призвал Фокусника Альтаира! Теперь все важные новости, фото и сообщения из VK сами переносятся в твой Telegram - не по прихоти алгоритмов, а по настоящему волшебству.

Забудь об унылой и бесконечной ленте: твой личный маг аккуратно отсортирует всё самое интересное и важное одним щелчком пальцев (и кликом на портал).

Но помни - магия работает только с твоим участием. Активируй заклинание и начинай колдовать! ✨ 
`;

  // 1. Приветственное сообщение с inline-кнопками
  await bot.sendMessage(chatId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Сотворить заклинание перехода 🌀', url: vkAuthUrl }]
      ]
    }
  });

  // 2. Сразу после этого — reply-клавиатура "Завершить переход🔱"
  const sentWaitMsg = await bot.sendMessage(chatId, "Активируй портал кнопкой выше, затем заверши переход ✨", {
    reply_markup: {
      keyboard: [
        ['Завершить переход🔱']
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
  replyContext[tgId + '_waitMsg'] = sentWaitMsg.message_id;

  console.log(`📨 Отправлена ссылка авторизации пользователю ${tgId}`);
});
// =========================
// 2. ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ и callback'и
// =========================

bot.on('callback_query', async (query) => {

  // === Помощь: обработка категорий ===
if (query.data === "help_how") {
  await bot.editMessageText(
    "✨ <b>Как это работает?</b>\n\nБот пересылает важные посты из выбранных VK-групп в твой Telegram. Всё автоматом и без спама. Только волшебные новости — никаких хаотичных лент! 🪄",
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "help_back" }]
        ]
      }
    }
  );
  return;
}
if (query.data === "help_auth") {
  await bot.editMessageText(
    "🪄 <b>Авторизация</b>\n\n<b>Портал не открывается?</b>\nСмените волшебный инструмент (браузер) или попробуйте ещё раз чуть позже. Не помогло — пишите магистру! 🧙\n\n<b>Зачем проходить портал?</b>\nБез магического ключа бот не сможет доставлять вам новости из ваших волшебных групп VK. 🗝️\n\n<b>Почему нужно повторять ритуал?</b>\nПортал мог закапризничать или забыть вас — просто пройдите магию ещё раз! 🔄",
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "help_back" }]
        ]
      }
    }
  );
  return;
}
if (query.data === "help_groups") {
  await bot.editMessageText(
    "📜 <b>Работа с группами</b>\n\n<b>Не вижу нужную группу?</b>\nПроверьте, что она открытая — магия работает только с доступными для всех сообществами! ✨\n\n<b>Как добавить или убрать группу?</b>\nВыберите нужные группы в списке, бот покажет только то, что вы отметили. 📝\n\n<b>Почему новости не приходят?</b>\nУбедитесь, что выбрали группы и не отключили уведомления в Telegram. Если что — попробуйте обновить список! 📩\n\n<b>Почему бот не показывает некоторые фото, видео или документы из группы?</b>\nИногда магия не срабатывает для файлов, которые скрыты авторскими чарами или доступны только избранным. Бот отправляет только то, что разрешено видеть всем в открытых группах VK! 🔒",
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "help_back" }]
        ]
      }
    }
  );
  return;
}

// === Возврат к категориям помощи ===
if (query.data === "help_back") {
  await bot.editMessageText('🦄 <b>Выбери категорию, в которой нужна поддержка:</b>', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✨ Как это работает", callback_data: "help_how" }],
        [{ text: "🪄 Авторизация (портал)", callback_data: "help_auth" }],
        [{ text: "📜 Работа с группами", callback_data: "help_groups" }]
      ]
    }
  });
  return;
}
  // ======= конец блока помощи =======

  // --- Поиск группы ---
if (query.data === 'search_group') {
  await bot.sendMessage(query.message.chat.id, '🔍 Введи часть названия группы для поиска:');
  userSelectedGroups[query.from.id + '_waitingForSearch'] = true;
  await bot.answerCallbackQuery(query.id);
  return;
}

// --- Возврат к полному списку после поиска ---
if (query.data === 'back_to_all_groups') {
  const userId = query.from.id;
  // ИСПОЛЬЗУЕМ ПОЛНЫЙ СПИСОК!
  const allGroups = userSelectedGroups[userId + '_fullList'] || [];
  const selectMsgId = userSelectedGroups[userId + '_selectMsgId'];
  userSelectedGroups[userId + '_isSearch'] = false;
  await showGroupSelection(bot, query.message.chat.id, userId, allGroups, 0, selectMsgId, false);
  await bot.answerCallbackQuery(query.id);
  return;
}
 

  // --- Ответить пользователю из группы поддержки ---
  if (query.data.startsWith('reply_')) {
    const userId = query.data.split('_')[1];
    replyContext[query.from.id] = userId;
    await bot.sendMessage(
      query.message.chat.id,
      `✍️ Напишите свой ответ для пользователя (ID: ${userId}), отправьте следующим сообщением прямо в этот чат.`
    );
    await bot.answerCallbackQuery(query.id, { text: 'Жду вашего ответа!' });
    return;
  }

    // --- Обработка выбора групп пользователя (инлайн кнопки) ---
  if (query.data.startsWith('select_group:')) {
    const [_, groupId, page] = query.data.split(':');
    const userId = query.from.id;
    const groupIdNum = Number(groupId);

    // Получаем список уже выбранных групп (или пустой)
    if (!userSelectedGroups[userId]) userSelectedGroups[userId] = [];
    const selected = userSelectedGroups[userId];

     // --- ПРАВИЛЬНО: здесь получаешь allGroups и selectMsgId!
    const allGroups = userSelectedGroups[userId + '_all'] || [];
    const selectMsgId = userSelectedGroups[userId + '_selectMsgId'];

    const isSearch = userSelectedGroups[userId + '_isSearch'] || false; 
    
     // Логика выбора
   if (selected.includes(groupIdNum)) {
  userSelectedGroups[userId] = selected.filter(id => id !== groupIdNum);
  fs.writeFileSync('userSelectedGroups.json', JSON.stringify(userSelectedGroups, null, 2));
    } else {
      const isUnlimited = UNLIMITED_USERS.includes(userId);
if (!isUnlimited && selected.length >= MAX_GROUPS_FREE) {
  await bot.answerCallbackQuery(query.id, { 
    text: '✨ О, сила магии ещё не столь велика!\nМожно выбрать только 3 группы - остальные скоро будут доступны.', 
    show_alert: true 
  });
  return;
}
    userSelectedGroups[userId].push(groupIdNum);
  fs.writeFileSync('userSelectedGroups.json', JSON.stringify(userSelectedGroups, null, 2));
    }

     if (!groupTitles[groupIdNum]) {
    const userData = getUserData(userId);
    if (userData && userData.access_token) {
      const title = await fetchGroupTitle(groupIdNum, userData.access_token);
      if (title) {
        groupTitles[groupIdNum] = title;
        fs.writeFileSync('groupTitles.json', JSON.stringify(groupTitles, null, 2));
      }
    }
  }
    
    // Обновляем инлайн-кнопки
     await showGroupSelection(bot, query.message.chat.id, userId, allGroups, Number(page), selectMsgId, isSearch);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // --- Пагинация групп ---
  if (query.data.startsWith('groups_prev:') || query.data.startsWith('groups_next:')) {
    const isPrev = query.data.startsWith('groups_prev:');
    const page = Number(query.data.split(':')[1]);
    const userId = query.from.id;
    const allGroups = userSelectedGroups[userId + '_all'] || [];
    const selectMsgId = userSelectedGroups[userId + '_selectMsgId'];
    await showGroupSelection(bot, query.message.chat.id, userId, allGroups, Number(page), selectMsgId);
  }

  // --- "Готово" ---
if (query.data === 'groups_done') {
  const selectedGroups = userSelectedGroups[query.from.id] || [];
  if (selectedGroups.length) {
  const allGroups = userSelectedGroups[query.from.id + '_all'] || [];
  const selectedGroupsNames = selectedGroups.map(id => {
    const group = allGroups.find(g => g.id === id);
    return group
    ? `${group.name || group.screen_name || 'Без названия'}`
    : 'Группа без названия';
  });
  console.log(`[Выбор групп] Пользователь ${query.from.id} выбрал:\n` + selectedGroupsNames.join('\n'));

    
  
    await bot.sendMessage(query.message.chat.id,
      `<b>Группы выбраны! ⚡️</b>\nСовсем скоро лента наполнится магией именно для тебя.\n\nЖди новости из:\n${selectedGroupsNames.map(name => `🔸${name}`).join('\n')}`,
      { parse_mode: 'HTML' }
    );

    await sendFreshestPostForUser(query.from.id);
    
  } else {
    await bot.sendMessage(query.message.chat.id,
      'Ты ничего не выбрал — но всегда можно вернуться 😉'
    );
  }
  await bot.answerCallbackQuery(query.id);
  return;
}


});

// =========================
// 3. ОСНОВНАЯ ЛОГИКА (reply-кнопки)
// =========================

bot.on('message', async (msg) => {
 // --- Поиск группы ---
if (userSelectedGroups[msg.from.id + '_waitingForSearch']) {
  delete userSelectedGroups[msg.from.id + '_waitingForSearch'];
  const allGroups = userSelectedGroups[msg.from.id + '_all'] || [];
  console.log('🔍 [ПОИСК] allGroups:', allGroups);
  const search = msg.text.trim().toLowerCase();
  console.log('🔍 [ПОИСК] search text:', search);
  const results = allGroups.filter(g =>
    (g.name && g.name.toLowerCase().includes(search)) ||
    (g.screen_name && g.screen_name.toLowerCase().includes(search)) ||
    (g.title && g.title.toLowerCase().includes(search))
  );
  console.log('🔍 [ПОИСК] results:', results);

  userSelectedGroups[msg.from.id + '_isSearch'] = true;
  
  if (!results.length) {
    await bot.sendMessage(msg.chat.id, 'Ничего не найдено! Попробуй другое слово или проверь написание.');
    const selectMsgId = userSelectedGroups[msg.from.id + '_selectMsgId'] || null;
    await showGroupSelection(bot, msg.chat.id, msg.from.id, results, 0, selectMsgId, true);

    return;
  }
  const selectMsgId = userSelectedGroups[msg.from.id + '_selectMsgId'] || null;
  await showGroupSelection(bot, msg.chat.id, msg.from.id, results, 0, selectMsgId, true);

  return;
}



  // 1. Завершить переход
  if (msg.text === 'Завершить переход🔱') {
    // Удаляем предыдущее сообщение "Подожди, магия настраивается ✨"
    const waitMsgId = replyContext[msg.from.id + '_waitMsg'];
    if (waitMsgId) {
      try { await bot.deleteMessage(msg.chat.id, waitMsgId); } catch(e){}
      delete replyContext[msg.from.id + '_waitMsg'];
    }

    const res = await axios.get(`https://api.fokusnikaltair.xyz/users/check?tg_id=${msg.from.id}`);
    if (res.data.success) {
      // Сообщение о квесте + кнопка "Групписо призывус! 📜"
      await bot.sendMessage(msg.chat.id, 
        `<b>💫 Ура! Квест пройден.</b>  \nДобро пожаловать в наш уютный мир новостей.\n\nОсталось последнее заклинание: призвать любимые группы и получать магические вести прямо сюда.`,
        { parse_mode: 'HTML' }
      );
      const sentGroupWaitMsg = await bot.sendMessage(msg.chat.id, "Готовь заклинание!", {
  reply_markup: {
    keyboard: [
      ['Групписо призывус! 📜']
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
});
replyContext[msg.from.id + '_groupWaitMsg'] = sentGroupWaitMsg.message_id;
    } else {
      await bot.sendMessage(msg.chat.id, 
        `<b>Упс, заклинание сегодня не в духе 😔</b>\n\nПереход пока не удался, но не переживай - такое бывает даже у самых опытных магов!\n\nПопробуй ещё раз или дай магистру знать, если чары не слушаются. 🧙‍♂️✨`,
        { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
      );
    }
    return;
  }


 // 2. Групписо призывус!
if (msg.text === 'Групписо призывус! 📜') {
  // Удаляем сообщение "Готовь заклинание!"
  const groupWaitMsgId = replyContext[msg.from.id + '_groupWaitMsg'];
  if (groupWaitMsgId) {
    try { await bot.deleteMessage(msg.chat.id, groupWaitMsgId); } catch(e){}
    delete replyContext[msg.from.id + '_groupWaitMsg'];
  }

  // 2.1 Отправляем послание
  await bot.sendMessage(msg.chat.id, 
    `<b>✨ Послание от стражей портала</b>\nВсе новости, картинки и видео приходят только из открытых групп VK.\n\nЕсли что-то не видно - значит, магия чуть-чуть устала и не смогла пройти защиту чар.`,
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
  );

  // 2.2 Запрашиваем группы с бэкенда
  try {
    const res = await axios.get(`https://api.fokusnikaltair.xyz/users/groups?tg_id=${msg.from.id}`);
    if (!res.data.success || !res.data.groups || !Array.isArray(res.data.groups)) {
      await bot.sendMessage(msg.chat.id, 'Магия не смогла найти ни одной группы. Попробуйте позже или напишите в поддержку!');
      return;
    }

    // Сохраняем все группы пользователя
    userSelectedGroups[msg.from.id] = [];

       // сохраняем "основной" полный список
    userSelectedGroups[msg.from.id + '_all'] = res.data.groups;
    userSelectedGroups[msg.from.id + '_fullList'] = res.data.groups;

    // Вызываем функцию, которая покажет кнопки с группами (по 10 штук, первая страница)
    userSelectedGroups[msg.from.id + '_all'] = res.data.groups;
    await showGroupSelection(bot, msg.chat.id, msg.from.id, res.data.groups, 0, null);

  } catch (e) {
    await bot.sendMessage(msg.chat.id, 'Что-то пошло не так при получении групп 😥');
  }
  return;
}


  // --- Поддержка: ответы магистра ---
  if (replyContext[msg.from.id] && msg.chat.id === SUPPORT_CHAT_ID) {
    const targetUserId = replyContext[msg.from.id];
    bot.sendMessage(targetUserId, `🧙 Магистр бота отвечает:\n${msg.text}`);
    bot.sendMessage(msg.chat.id, "✅ Ответ отправлен пользователю!");
    delete replyContext[msg.from.id];
    return;
  }

  // --- Поддержка: новые вопросы пользователя ---
  if (
    msg.chat.id === SUPPORT_CHAT_ID ||
    (msg.text && msg.text.startsWith('/')) ||
    msg.from.is_bot
  ) return;

  bot.sendMessage(SUPPORT_CHAT_ID,
    `🧙 Вопрос от @${msg.from.username || msg.from.id} (ID: ${msg.from.id}):\n${msg.text}`, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: "Ответить",
            callback_data: `reply_${msg.from.id}`
          }]
        ]
      }
    }
  );
});

// --- Поддержка /support ---
bot.onText(/\/support/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "Если у тебя есть вопрос, пожелание или что-то не работает - просто опиши проблему в следующем сообщении! Магистр прочитает и обязательно ответит. Твой Telegram ник останется скрыт, а магическая поддержка уже рядом! ✉️"
  );
});

//===================КНОПКА ПОМОЩЬ====================
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🦄 <b>Выбери категорию, в которой нужна поддержка:</b>', {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✨ Как это работает", callback_data: "help_how" }],
        [{ text: "🪄 Авторизация", callback_data: "help_auth" }],
        [{ text: "📜 Работа с группами", callback_data: "help_groups" }]
      ]
    }
  });
});


async function showGroupSelection(bot, chatId, userId, allGroups, page = 0, messageId = null, isSearch = false) {
  const MAX_GROUPS_PER_PAGE = 10;
  const selected = userSelectedGroups[userId] || [];
  let inline_keyboard = [];
  let text = "";

  if (!isSearch) {
    // Обычный режим: пагинация и выбор
    const start = page * MAX_GROUPS_PER_PAGE;
    const pageGroups = allGroups.slice(start, start + MAX_GROUPS_PER_PAGE);

    inline_keyboard = pageGroups.map((group, idx) => {
      const isSelected = selected.includes(group.id);
      const groupNumber = start + idx + 1;
      return [{
        text: (isSelected ? '✅ ' : '') + `${groupNumber}. ` + (group.name || group.screen_name || `ID${group.id}`),
        callback_data: `select_group:${group.id}:${page}`
      }];
    });

    // Кнопки навигации
    const navButtons = [];
    if (page > 0) navButtons.push({ text: '⬅️', callback_data: `groups_prev:${page - 1}` });
    navButtons.push({ text: '✅ Готово', callback_data: 'groups_done' });
    if (allGroups.length > start + MAX_GROUPS_PER_PAGE) navButtons.push({ text: '➡️', callback_data: `groups_next:${page + 1}` });
    inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '🔎 Поиск', callback_data: 'search_group' }]);
    text = `🦄 У тебя аж <b>${allGroups.length}</b> магических групп!\nКакой сегодня у нас настрой? Котики? Новости? Тык-тык — выбирай!`;

  } else {
    // 🔥 РЕЖИМ ПОИСКА — показываем кнопки найденных групп
    const start = page * MAX_GROUPS_PER_PAGE;
    const pageGroups = allGroups.slice(start, start + MAX_GROUPS_PER_PAGE);

    inline_keyboard = pageGroups.map((group, idx) => {
      const isSelected = selected.includes(group.id);
      const groupNumber = start + idx + 1;
      return [{
        text: (isSelected ? '✅ ' : '') + `${groupNumber}. ` + (group.name || group.screen_name || `ID${group.id}`),
        callback_data: `select_group:${group.id}:${page}`
      }];
    });

    // Кнопки поиска/возврата/готово — отдельной строкой!
    inline_keyboard.push([{ text: '🔎 Поиск', callback_data: 'search_group' }]);
    inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_all_groups' }]);
    inline_keyboard.push([{ text: '✅ Готово', callback_data: 'groups_done' }]);

    text = `🔍 Найдено групп: <b>${allGroups.length}</b>\nМожешь выбрать одну или вернуться назад.`;
  }

  userSelectedGroups[userId + '_all'] = allGroups;

  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
  } else {
    const sent = await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
    userSelectedGroups[userId + '_selectMsgId'] = sent.message_id;
  }
}


//===============================================ТЕСТОВЫЙ ПОСТ==============================================
async function sendFreshestPostForUser(tgUserId) {
  const selectedGroupIds = userSelectedGroups[tgUserId];
  if (!Array.isArray(selectedGroupIds) || !selectedGroupIds.length) return;
  const userData = getUserData(tgUserId);
  if (!userData || !userData.access_token) return;
  const vkAccessToken = userData.access_token;

  let freshestPost = null;
  let freshestGroup = null;

  for (const groupId of selectedGroupIds) {
    const owner_id = -Math.abs(groupId);
    try {
      const res = await axios.get('https://api.vk.com/method/wall.get', {
        params: { 
          owner_id, 
          count: 3, // <-- три последних поста с группы
          access_token: vkAccessToken, 
          v: '5.199' 
        }
      });
      const posts = (res.data.response && res.data.response.items) ? res.data.response.items : [];
      // Оставляем только не рекламу и не закреп
      const validPosts = posts.filter(post =>
        !post.marked_as_ads && // <-- не реклама
        !post.is_pinned       // <-- не закреп
      );
      if (validPosts.length) {
        const post = validPosts[0]; // самый свежий из этой группы
        if (!freshestPost || post.date > freshestPost.date) {
          freshestPost = post;      // сохраняем самый свежий среди всех групп
          freshestGroup = groupId;
        }
      }
    } catch (e) {
      // Можно раскомментировать для отладки:
      // console.error(`[wall.get] ${groupId}:`, e?.response?.data || e.message);
    }
  }

  // Если нет подходящих постов, выходим
  if (!freshestPost) return;
// -----------------отправка постов для тестового сообщения---------------------------------------
// Получаем массив всех групп пользователя
const allGroups = userSelectedGroups[tgUserId + '_all'] || [];
// Ищем объект группы по id
const groupInfo = allGroups.find(g => String(g.id) === String(freshestGroup));
// Название, если есть, иначе "Группа"
const groupName = groupInfo ? groupInfo.name : "Группа";

// Дальше всё как было:
const isTextExists = (freshestPost.text && freshestPost.text.trim().length > 0);
const boldGroup = `<b>${groupName}</b>`;
const caption = isTextExists
  ? `${boldGroup}\n\n${freshestPost.text.trim()}`
  : boldGroup;


// 3. Кнопка на пост
const postUrl = `https://vk.com/wall${-Math.abs(freshestGroup)}_${freshestPost.id}`;
const buttons = [
  [{ text: '🧙‍♂️ Открыть источник', url: postUrl }]
];

// 4. Разбираем вложения
const attachments = freshestPost.attachments || [];
const photos = attachments.filter(att => att.type === 'photo');
const docs = attachments.filter(att => att.type === 'doc');
const videos = attachments.filter(att => att.type === 'video');

if (photos.length === 1) {
  // Одиночная фотка: подпись и кнопка прямо под фото
  const photo = photos[0].photo.sizes.sort((a, b) => b.width - a.width)[0];
  const { caption, buttons } = formatVkCaption(freshestPost.text, groupName, postUrl);
  await bot.sendPhoto(tgUserId, photo.url, {
    caption: caption,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });

} else if (photos.length > 1) {
  // Альбом: отправляем только фото
  const media = photos.map(att => {
    const photo = att.photo.sizes.sort((a, b) => b.width - a.width)[0];
    return { type: 'photo', media: photo.url };
  });
  const messages = await bot.sendMediaGroup(tgUserId, media);

  // Текст-пост (с кнопкой и обрезкой) отправляем reply на первую фотку
  const replyToId = messages[0].message_id;
  const { text, buttons } = formatVkPost(freshestPost.text, groupName, postUrl);
  await bot.sendMessage(tgUserId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
    reply_to_message_id: replyToId
  });

} else if (isTextExists) {
  // Нет фото — просто текст с кнопкой и обрезкой
  const { text, buttons } = formatVkPost(freshestPost.text, groupName, postUrl);
  await bot.sendMessage(tgUserId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

// 6. Отправляем документы и видео отдельными сообщениями (по желанию можно добавить описание)
for (const att of docs) {
  // Обрезаем caption до 1024 символов и добавляем "...Продолжение ⬇️" если что
  let docCaption = att.doc.title || '';
  if (docCaption.length > MAX_CAPTION_LENGTH) {
    docCaption = docCaption.slice(0, MAX_CAPTION_LENGTH - 20) + '\n\n...Продолжение ⬇️';
  }
  await bot.sendDocument(tgUserId, att.doc.url, {
    caption: docCaption,
    parse_mode: 'HTML'
  });
}

for (const att of videos) {
  const videoUrl = `https://vk.com/video${att.video.owner_id}_${att.video.id}`;
  await bot.sendMessage(tgUserId, "🎬 <b>Видео:</b> " + videoUrl, { parse_mode: 'HTML' });
}

  // Обновляем ОБЩУЮ границу (borderDate) для пользователя (а не для группы!)
  sentPosts[tgUserId] = sentPosts[tgUserId] || {};
  sentPosts[tgUserId].borderDate = freshestPost.date;
  fs.writeFileSync('sentPosts.json', JSON.stringify(sentPosts, null, 2));
}


// ========================================= [АВТОМАТИЧЕСКАЯ РАССЫЛКА VK-ПОСТОВ КАЖДЫЕ 30 МИНУТ] =====================================

async function sendLatestVkPosts() {
  for (const userKey in userSelectedGroups) {
    if (!/^\d+$/.test(userKey)) continue; // Только id пользователей
    const tgUserId = Number(userKey);
    const selectedGroupIds = userSelectedGroups[tgUserId];
    if (!Array.isArray(selectedGroupIds) || !selectedGroupIds.length) continue;

    const userData = getUserData(tgUserId);
    if (!userData || !userData.access_token) continue;
    const vkAccessToken = userData.access_token;

    sentPosts[tgUserId] = sentPosts[tgUserId] || {};

    let allNewPosts = [];

    // Получаем границу для пользователя (общая для всех групп!)
    const borderDate = sentPosts[tgUserId].borderDate || 0;

    // Собираем новые посты из всех групп, опубликованные строго после borderDate
    for (const groupId of selectedGroupIds) {
      const owner_id = -Math.abs(groupId);
      try {
        const res = await axios.get('https://api.vk.com/method/wall.get', {
          params: {
            owner_id,
            count: 5, // Можно увеличить, если много закрепов/рекламы
            access_token: vkAccessToken,
            v: '5.199'
          }
        });

        const posts = (res.data.response && res.data.response.items) ? res.data.response.items : [];
        const nonAdPosts = posts.filter(post => !post.marked_as_ads && !post.is_pinned);

        // Берём только новые посты после borderDate
        const freshPosts = nonAdPosts.filter(post => post.date > borderDate);

        freshPosts.forEach(post => {
          allNewPosts.push({ ...post, groupId, owner_id });
        });
      } catch (e) {
        console.log('🔴 [Ошибка wall.get]:', e?.response?.data || e.message || e);
      }
    }

    // Сортируем новые посты по времени (старые первыми)
    allNewPosts.sort((a, b) => a.date - b.date);

    if (!allNewPosts.length) continue;

    // ================================ВЛОЖЕНИЯ ДЛЯ РАССЫЛКИ ПОСТОВ================================
const post = allNewPosts[0];

// Получаем массив всех групп пользователя
const allGroups = userSelectedGroups[tgUserId + '_all'] || [];
// Находим нужную группу по id
const groupInfo = allGroups.find(g => String(g.id) === String(post.groupId));
// Получаем имя группы или fallback "Группа"
const groupName = groupInfo ? groupInfo.name : "Группа";

// Дальше всё как раньше
const isTextExists = (post.text && post.text.trim().length > 0);
const boldGroup = `<b>${groupName}</b>`;
const caption = isTextExists
  ? `${boldGroup}\n\n${post.text.trim()}`
  : boldGroup;

const postUrl = `https://vk.com/wall${post.owner_id}_${post.id}`;
const buttons = [
  [{ text: '🧙‍♂️ Открыть источник', url: postUrl }]
];

const attachments = post.attachments || [];
const photos = attachments.filter(att => att.type === 'photo');
const docs = attachments.filter(att => att.type === 'doc');
const videos = attachments.filter(att => att.type === 'video');

if (photos.length === 1) {
  // Одиночная фотка — подпись и кнопка прямо под фото
  const photo = photos[0].photo.sizes.sort((a, b) => b.width - a.width)[0];
const { caption, buttons } = formatVkCaption(post.text, groupName, postUrl);
await bot.sendPhoto(tgUserId, photo.url, {
  caption: caption,
  parse_mode: 'HTML',
  reply_markup: { inline_keyboard: buttons }
});
} else if (photos.length > 1) {
  // Альбом: все фото одной медиагруппой, caption и кнопка reply на первую фотку
  const media = photos.map(att => {
    const photo = att.photo.sizes.sort((a, b) => b.width - a.width)[0];
    return { type: 'photo', media: photo.url };
  });
  const messages = await bot.sendMediaGroup(tgUserId, media);
const replyToId = messages[0].message_id;
const { text, buttons } = formatVkPost(post.text, groupName, postUrl);
await bot.sendMessage(tgUserId, text, {
  parse_mode: 'HTML',
  reply_markup: { inline_keyboard: buttons },
  reply_to_message_id: replyToId
});
} else {
  // Нет фото: просто текст с кнопкой, если текст есть
  if (isTextExists) {
  const { text, buttons } = formatVkPost(post.text, groupName, postUrl);
  await bot.sendMessage(tgUserId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Документы отдельными сообщениями
for (const att of docs) {
  let docCaption = att.doc.title || '';
  if (docCaption.length > MAX_CAPTION_LENGTH) {
    docCaption = docCaption.slice(0, MAX_CAPTION_LENGTH - 20) + '\n\n...Продолжение ⬇️';
  }
  await bot.sendDocument(tgUserId, att.doc.url, {
    caption: docCaption,
    parse_mode: 'HTML'
  });
}
  
// Видео отдельными сообщениями
for (const att of videos) {
  const videoUrl = `https://vk.com/video${att.video.owner_id}_${att.video.id}`;
  await bot.sendMessage(tgUserId, "🎬 <b>Видео:</b> " + videoUrl, { parse_mode: 'HTML' });
 }
} 

    // После успешной отправки обновляем ОБЩУЮ “границу” пользователя
    sentPosts[tgUserId].borderDate = post.date;

    // --- Сохраняем историю отправки ---
    fs.writeFileSync('sentPosts.json', JSON.stringify(sentPosts, null, 2));
  }
}

// Теперь рассылка будет работать по одной “ленте”, а не по группам!
setInterval(sendLatestVkPosts, 60 * 1000);
