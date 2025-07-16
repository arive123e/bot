require('dotenv').config(); // 🔐 Загружаем переменные из .env

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const fs = require('fs');
const path = require('path');
const usersPath = '/root/vk-backend/users.json';

// Функция для поиска пользователя по tg_id
function getUserData(tgId) {
  if (!fs.existsSync(usersPath)) return null;
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  return Object.values(users).find(u => String(u.tg_id) === String(tgId) && u.status === 'ok');
}

const MAX_GROUPS_FREE = 3; // сколько групп выбрать бесплатно
const UNLIMITED_USERS = [792903459, 1022172210];
const userSelectedGroups = {};

const token = process.env.TELEGRAM_BOT_TOKEN;
const SUPPORT_CHAT_ID = -4778492984; // chat_id группы поддержки

if (!token) {
  console.error('❌ Ошибка: не указан TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const replyContext = {}; // Кому отвечает магистр поддержки
const sentPosts = {}; // { [tgUserId]: { [groupId]: [postId, ...] } }

// =========================
// 1. СТАРТ, ПОРТАЛ, ПРИВЕТСТВИЕ
// =========================

bot.onText(/\/start/, async (msg) => { // <--- вот здесь добавь async
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const vkAuthUrl = `https://fokusnikaltair.xyz/vkid-auth.html?tg_id=${tgId}`;

  const welcomeText = `Абра-кадабра и немного кода 🧙‍♂️

Ты только что призвал Фокусника Альтаира - теперь твои VK-новости сами переползают в Telegram по волшебству, а не по прихоти алгоритмов.

Забудь про унылые бесконечные ленты, ведь у тебя есть личный маг, который сортирует новости по щелчку пальцев (и клику на портал).

Магия не работает без твоего участия - активируй портал и начни колдовать ✨ 
`;

  // 1. Приветственное сообщение с inline-кнопками
  await bot.sendMessage(chatId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Сотворить заклинание перехода 🌀', url: vkAuthUrl }],
        [{ text: 'Магическая безопасность 🔐', callback_data: 'privacy' }]
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


  // --- Магическая безопасность (политика) ---
  if (query.data === 'privacy') {
    const privacyText = `Ваша приватность - под надёжной защитой магии и современных технологий 🛡
Данные используются только для отправки новостей из выбранных вами VK-групп. 
Токены хранятся на сервере, не передаются третьим лицам.

Полная политика конфиденциальности:
https://api.fokusnikaltair.xyz/privacy.html`;

    await bot.sendMessage(query.message.chat.id, privacyText, {
      disable_web_page_preview: true
    });
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
      ? `ID: ${id} | Название: ${group.name || group.screen_name || `ID${id}`}`
      : `ID: ${id}`;
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

// === ОТПРАВИТЬ СРАЗУ ОДИН СВЕЖИЙ ПОСТ ПОЛЬЗОВАТЕЛЮ ===
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
        params: { owner_id, count: 1, access_token: vkAccessToken, v: '5.199' }
      });
      const posts = (res.data.response && res.data.response.items) ? res.data.response.items : [];
      const nonAdPosts = posts.filter(post => !post.marked_as_ads);
      if (nonAdPosts.length) {
        const post = nonAdPosts[0];
        if (!freshestPost || post.date > freshestPost.date) {
          freshestPost = post;
          freshestGroup = groupId;
        }
      }
    } catch (e) { }
  }
  if (freshestPost) {
    let text = freshestPost.text || '[без текста]';
    const postUrl = "https://vk.com/wall" + -Math.abs(freshestGroup) + "_" + freshestPost.id;
    text += "\n\n<a href=\"" + postUrl + "\">Открыть в VK</a>";
    await bot.sendMessage(tgUserId, text, { parse_mode: 'HTML', disable_web_page_preview: false });
    if (freshestPost.attachments && Array.isArray(freshestPost.attachments)) {
      for (const att of freshestPost.attachments) {
        if (att.type === 'photo' && att.photo && att.photo.sizes) {
          const photo = att.photo.sizes.sort((a, b) => b.width - a.width)[0];
          await bot.sendPhoto(tgUserId, photo.url);
        }
        if (att.type === 'doc' && att.doc && att.doc.url) {
          await bot.sendDocument(tgUserId, att.doc.url, { caption: att.doc.title || '' });
        }
        if (att.type === 'video' && att.video) {
          const videoUrl = "https://vk.com/video" + att.video.owner_id + "_" + att.video.id;
          await bot.sendMessage(tgUserId, "🎬 <b>Видео:</b> " + videoUrl, { parse_mode: 'HTML' });
        }
      }
    }
  }
}


// ======== [АВТОМАТИЧЕСКАЯ РАССЫЛКА VK-ПОСТОВ КАЖДЫЕ 30 МИНУТ] ========
async function sendLatestVkPosts() {
  for (const userKey in userSelectedGroups) {
    if (!/^\d+$/.test(userKey)) continue;
    const tgUserId = Number(userKey);
    const selectedGroupIds = userSelectedGroups[tgUserId];
    if (!Array.isArray(selectedGroupIds) || !selectedGroupIds.length) continue;

    const userData = getUserData(tgUserId);
    if (!userData || !userData.access_token) continue;
    const vkAccessToken = userData.access_token;

    let allNewPosts = [];

    // 1. Собираем новые посты из всех групп пользователя
for (const groupId of selectedGroupIds) {
  const owner_id = -Math.abs(groupId);
  try {
    const res = await axios.get('https://api.vk.com/method/wall.get', {
      params: {
        owner_id,
        count: 5,
        access_token: vkAccessToken,
        v: '5.199'
      }
    });
    const posts = (res.data.response && res.data.response.items) ? res.data.response.items : [];
    const nonAdPosts = posts.filter(post => !post.marked_as_ads);

    sentPosts[tgUserId] = sentPosts[tgUserId] || {};
    sentPosts[tgUserId][groupId] = sentPosts[tgUserId][groupId] || [];

    // ---- ЛОГИ ----
    let newPostsHere = [];
    for (const post of nonAdPosts) {
      if (!sentPosts[tgUserId][groupId].includes(post.id)) {
        newPostsHere.push(post);
        allNewPosts.push({
          ...post,
          groupId,
          owner_id
        });
      }
    }
    if (newPostsHere.length) {
      const groupInfo = groupId + ' | ' +
        ((userSelectedGroups[tgUserId + '_all'] || []).find(g => g.id === groupId)?.name || '');
      console.log(`[Новые посты] Пользователь ${tgUserId} | Группа: ${groupInfo} | Новых: ${newPostsHere.length}`);
      newPostsHere.forEach(post => {
        console.log(`  - post.id = ${post.id}, дата = ${new Date(post.date * 1000).toLocaleString()}`);
      });
    }
    // --------------
  } catch (e) {
    console.log('🔴 [Ошибка wall.get]:', e?.response?.data || e.message || e);
  }
}

    // 3. Сортируем все новые посты по времени (от старого к новому)
    allNewPosts.sort((a, b) => a.date - b.date);

    // 4. Отправляем только ОДИН (самый ранний)
    if (allNewPosts.length) {
      const post = allNewPosts[0];
      let text = post.text || '[без текста]';
      const postUrl = "https://vk.com/wall" + post.owner_id + "_" + post.id;
      text += "\n\n<a href=\"" + postUrl + "\">Открыть в VK</a>";
      await bot.sendMessage(tgUserId, text, { parse_mode: 'HTML', disable_web_page_preview: false });

      // Вложения
      if (post.attachments && Array.isArray(post.attachments)) {
        for (const att of post.attachments) {
          if (att.type === 'photo' && att.photo && att.photo.sizes) {
            const photo = att.photo.sizes.sort((a, b) => b.width - a.width)[0];
            await bot.sendPhoto(tgUserId, photo.url);
          }
          if (att.type === 'doc' && att.doc && att.doc.url) {
            await bot.sendDocument(tgUserId, att.doc.url, { caption: att.doc.title || '' });
          }
          if (att.type === 'video' && att.video) {
            const videoUrl = "https://vk.com/video" + att.video.owner_id + "_" + att.video.id;
            await bot.sendMessage(tgUserId, "🎬 <b>Видео:</b> " + videoUrl, { parse_mode: 'HTML' });
          }
        }
      }

      // Отметим пост как отправленный
      sentPosts[tgUserId][post.groupId].push(post.id);
      if (sentPosts[tgUserId][post.groupId].length > 1000) {
        sentPosts[tgUserId][post.groupId] = sentPosts[tgUserId][post.groupId].slice(-1000);
      }
    }
  }
}


setInterval(sendLatestVkPosts, 60 * 1000);

