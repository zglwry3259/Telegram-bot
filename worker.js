// ========================
// Telegram 双向话题机器人
// 基于 Cloudflare Workers + KV
// 仓库：https://github.com/你的用户名/仓库名
// ========================

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Bot is running. Use /setwebhook.', { status: 200 });
    }
    if (request.method === 'GET' && url.pathname === '/setwebhook') {
      const result = await setWebhook(request);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json();
      await handleUpdate(update);
      return new Response('OK', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  } catch (err) {
    console.error(err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
}

// ---------------------- 辅助函数 ----------------------
function getCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@|\s|$)/);
  return match ? match[1].toLowerCase() : null;
}

async function sendMessage(chatId, text, replyToMsgId = null, parseMode = 'HTML', replyMarkup = null, threadId = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode,
  };
  if (replyToMsgId) body.reply_to_message_id = replyToMsgId;
  if (threadId) body.message_thread_id = threadId;
  if (replyMarkup && typeof replyMarkup === 'object') body.reply_markup = replyMarkup;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.description);
  return data.result;
}

async function sendPhoto(chatId, fileId, caption = '', replyToMsgId = null, threadId = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', fileId);
  if (caption) form.append('caption', caption);
  if (replyToMsgId) form.append('reply_to_message_id', replyToMsgId);
  if (threadId) form.append('message_thread_id', threadId);
  const resp = await fetch(url, { method: 'POST', body: form });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.description);
  return data.result;
}

async function createForumTopic(chatId, userId, firstName, lastName, username) {
  let name = `${userId}`;
  if (firstName) {
    name += ` (${firstName}`;
    if (lastName) name += ` ${lastName}`;
    name += `)`;
  } else if (username) {
    name += ` (@${username})`;
  } else {
    name += ` (用户)`;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`;
  const body = { chat_id: chatId, name: name };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!data.ok) {
    console.error('创建话题失败:', data);
    throw new Error(`创建话题失败: ${data.description}`);
  }
  return data.result.message_thread_id;
}

async function getChatInfo(chatId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${chatId}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.description);
  return data.result;
}

// KV 操作
const TOPIC_GROUP_KEY = 'topic_group_id';
const TOPIC_GROUP_NAME_KEY = 'topic_group_name';

async function getTopicGroupId() {
  if (typeof RELAYGO_KV === 'undefined') return null;
  return await RELAYGO_KV.get(TOPIC_GROUP_KEY);
}
async function setTopicGroupId(groupId, groupName = '') {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.put(TOPIC_GROUP_KEY, groupId);
  if (groupName) await RELAYGO_KV.put(TOPIC_GROUP_NAME_KEY, groupName);
}
async function clearTopicGroup() {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.delete(TOPIC_GROUP_KEY);
  await RELAYGO_KV.delete(TOPIC_GROUP_NAME_KEY);
}

async function getUserTopic(userId) {
  if (typeof RELAYGO_KV === 'undefined') return null;
  const topicId = await RELAYGO_KV.get(`user_topic_${userId}`);
  return topicId ? parseInt(topicId) : null;
}
async function setUserTopic(userId, topicId) {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.put(`user_topic_${userId}`, topicId.toString(), { expirationTtl: 86400 * 30 });
}
async function deleteUserTopic(userId) {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.delete(`user_topic_${userId}`);
}
async function getTopicUser(topicId) {
  if (typeof RELAYGO_KV === 'undefined') return null;
  const userId = await RELAYGO_KV.get(`topic_user_${topicId}`);
  return userId ? parseInt(userId) : null;
}
async function setTopicUser(topicId, userId) {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.put(`topic_user_${topicId}`, userId.toString(), { expirationTtl: 86400 * 30 });
}
async function deleteTopicUser(topicId) {
  if (typeof RELAYGO_KV === 'undefined') return;
  await RELAYGO_KV.delete(`topic_user_${topicId}`);
}

async function isAdmin(userId) {
  if (typeof ADMIN_ID === 'undefined') return false;
  const adminIds = ADMIN_ID.split(',').map(id => id.trim());
  return adminIds.includes(userId.toString());
}

async function setWebhook(request) {
  const url = new URL(request.url);
  const workerUrl = `${url.protocol}//${url.host}/webhook`;
  const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${workerUrl}&allowed_updates=["message","callback_query","chat_member"]`;
  const resp = await fetch(apiUrl, { method: 'POST' });
  return await resp.json();
}

async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  const body = { callback_query_id: callbackQueryId, text: text, show_alert: showAlert };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------- 核心处理 ----------------------
async function handleUpdate(update) {
  // 处理 chat_member 更新（机器人被加入群组）
  if (update.chat_member) {
    const chatMemberUpdate = update.chat_member;
    const chat = chatMemberUpdate.chat;
    const newChatMember = chatMemberUpdate.new_chat_member;
    const botId = BOT_TOKEN.split(':')[0];
    if (newChatMember && newChatMember.user && newChatMember.user.id.toString() === botId) {
      const status = newChatMember.status;
      if (status === 'member' || status === 'administrator') {
        const groupId = chat.id;
        const groupTitle = chat.title || '未命名群组';
        let isForum = false;
        try {
          const chatInfo = await getChatInfo(groupId);
          isForum = chatInfo.is_forum === true;
        } catch (e) {}
        const adminIds = (ADMIN_ID || '').split(',').map(id => id.trim());
        if (adminIds.length > 0) {
          let message = `🤖 机器人被添加到了群组：\n名称：${groupTitle}\nID：${groupId}\n`;
          message += `话题功能：${isForum ? '✅ 已开启' : '❌ 未开启'}\n`;
          message += `\n是否将此群设置为话题群？\n（用户私聊消息将转发到此群的话题中）\n\n*注意：只有已开启话题的超级群组才能正常使用。`;
          const inlineKeyboard = {
            inline_keyboard: [[
              { text: '✅ 同意设置', callback_data: `set_topic_group_${groupId}_${groupTitle}` },
              { text: '❌ 拒绝', callback_data: 'reject_topic_group' }
            ]]
          };
          for (const aid of adminIds) {
            try {
              await sendMessage(aid, message, null, 'HTML', inlineKeyboard);
            } catch (e) {}
          }
        }
      }
    }
    return;
  }

  // 处理回调查询
  if (update.callback_query) {
    const query = update.callback_query;
    const data = query.data;
    const fromId = query.from.id;
    const messageId = query.message.message_id;
    const chatId = query.message.chat.id;
    const admin = await isAdmin(fromId);
    if (!admin) {
      await answerCallbackQuery(query.id, '无权操作', true);
      return;
    }
    if (data.startsWith('set_topic_group_')) {
      let suffix = data.substring('set_topic_group_'.length);
      const firstUnderscore = suffix.indexOf('_');
      const groupId = suffix.substring(0, firstUnderscore);
      const groupName = suffix.substring(firstUnderscore + 1);
      let isForum = false;
      try {
        const chatInfo = await getChatInfo(groupId);
        isForum = chatInfo.is_forum === true;
      } catch (e) {}
      if (!isForum) {
        await answerCallbackQuery(query.id, '该群未开启话题功能，无法设置', true);
        await sendMessage(chatId, `❌ 群组 ${groupName} (${groupId}) 未开启话题，请先在群设置中开启话题。`);
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId })
          });
        } catch (e) {}
        return;
      }
      await setTopicGroupId(groupId, groupName);
      await answerCallbackQuery(query.id, `已设置 ${groupName} 为话题群`, false);
      await sendMessage(chatId, `✅ 已成功设置群组 ${groupName} (${groupId}) 为话题群。`);
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
      } catch (e) {}
      return;
    }
    if (data === 'reject_topic_group') {
      await answerCallbackQuery(query.id, '已忽略', false);
      await sendMessage(chatId, `❌ 已拒绝将该群设为话题群。`);
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
      } catch (e) {}
      return;
    }
    return;
  }

  if (!update.message) return;

  const msg = update.message;
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const text = msg.text || '';
  const fromId = msg.from.id;
  const cmd = getCommand(text);
  const admin = await isAdmin(fromId);

  let photoFileId = null;
  let caption = msg.caption || '';
  if (msg.photo && msg.photo.length > 0) {
    photoFileId = msg.photo[msg.photo.length - 1].file_id;
  }

  // /start 命令
  if (cmd === 'start' && chatType === 'private') {
    const topicGroupId = await getTopicGroupId();
    if (!topicGroupId) {
      await sendMessage(chatId, '🤖 机器人尚未设置话题群。\n管理员请将机器人加入一个已开启话题的群组，或使用 /setchat 命令手动指定。');
    } else {
      await sendMessage(chatId, '🤖 双向机器人已启动。\n发送文字/图片，管理员会在话题中回复你。');
    }
    return;
  }

  // 管理员私聊命令
  if (admin && chatType === 'private') {
    // 手动设置话题群
    if (cmd === 'setchat') {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sendMessage(chatId, '用法: /setchat 群ID\n例如: /setchat -1001234567890');
        return;
      }
      const groupId = parts[1];
      if (!groupId.match(/^-?\d+$/)) {
        await sendMessage(chatId, '群ID必须是数字');
        return;
      }
      let groupName = groupId;
      let isForum = false;
      try {
        const info = await getChatInfo(groupId);
        groupName = info.title || groupId;
        isForum = info.is_forum === true;
      } catch (e) {
        await sendMessage(chatId, `❌ 无法获取群信息: ${e.message}\n请确保机器人已在群中。`);
        return;
      }
      if (!isForum) {
        await sendMessage(chatId, `❌ 群组 ${groupName} (${groupId}) 未开启话题功能。请先在群设置中开启话题。`);
        return;
      }
      await setTopicGroupId(groupId, groupName);
      await sendMessage(chatId, `✅ 已设置话题群为：${groupName} (${groupId})`);
      return;
    }
    // 查看当前话题群
    if (cmd === 'topicgroup') {
      const groupId = await getTopicGroupId();
      if (!groupId) {
        await sendMessage(chatId, '当前未设置话题群。');
      } else {
        const groupName = await RELAYGO_KV.get(TOPIC_GROUP_NAME_KEY) || groupId;
        await sendMessage(chatId, `当前话题群：${groupName} (${groupId})`);
      }
      return;
    }
    // 清除话题群
    if (cmd === 'cleartopicgroup') {
      await clearTopicGroup();
      await sendMessage(chatId, '✅ 已清除话题群设置。');
      return;
    }
  }

  // 普通用户私聊 -> 转发到话题群
  if (!admin && chatType === 'private') {
    if (typeof RELAYGO_KV === 'undefined') {
      await sendMessage(chatId, '❌ KV 未绑定');
      return;
    }
    const topicGroupId = await getTopicGroupId();
    if (!topicGroupId) {
      await sendMessage(chatId, '❌ 机器人尚未设置话题群，请联系管理员。');
      return;
    }
    let topicId = await getUserTopic(fromId);
    if (topicId) {
      try {
        if (photoFileId) {
          await sendPhoto(topicGroupId, photoFileId, caption, null, topicId);
        } else {
          await sendMessage(topicGroupId, text, null, 'HTML', null, topicId);
        }
        return;
      } catch (e) {
        if (e.message.includes('message thread not found') || e.message.includes('thread not found')) {
          console.log(`用户 ${fromId} 的话题 ${topicId} 失效，重建`);
          await deleteUserTopic(fromId);
          await deleteTopicUser(topicId);
          topicId = null;
        } else {
          await sendMessage(chatId, `❌ 发送失败: ${e.message}`);
          return;
        }
      }
    }
    if (!topicId) {
      try {
        const user = msg.from;
        topicId = await createForumTopic(topicGroupId, fromId, user.first_name, user.last_name, user.username);
        await setUserTopic(fromId, topicId);
        await setTopicUser(topicId, fromId);
      } catch (e) {
        console.error('创建话题失败:', e);
        await sendMessage(chatId, `❌ 创建话题失败: ${e.message}`);
        return;
      }
    }
    try {
      if (photoFileId) {
        await sendPhoto(topicGroupId, photoFileId, caption, null, topicId);
      } else {
        await sendMessage(topicGroupId, text, null, 'HTML', null, topicId);
      }
    } catch (e) {
      console.error('转发失败:', e);
      await sendMessage(chatId, `❌ 转发失败: ${e.message}`);
    }
    return;
  }

  // 管理员在话题中回复 -> 转发给用户
  if (admin && chatType !== 'private' && msg.reply_to_message) {
    const repliedMsg = msg.reply_to_message;
    const topicId = repliedMsg.message_thread_id;
    if (!topicId) return;
    const userId = await getTopicUser(topicId);
    if (!userId) return;
    try {
      if (photoFileId) {
        await sendPhoto(userId, photoFileId, caption);
      } else {
        await sendMessage(userId, text);
      }
    } catch (e) {
      console.error(`回复用户 ${userId} 失败:`, e);
    }
    return;
  }
}
