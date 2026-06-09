import 'dotenv/config';
import http from 'node:http';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './persona.js';

const {
  BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini', // самая дешёвая и при этом адекватная для болтовни
  TRIGGER = 'чанган',
  COOLDOWN_SEC = '8', // анти-спам: не чаще раза в N секунд на чат
  PORT = 3000,
} = process.env;

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в переменных окружения');
if (!OPENAI_API_KEY) throw new Error('Нет OPENAI_API_KEY в переменных окружения');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const bot = new Telegraf(BOT_TOKEN);

const trigger = TRIGGER.toLowerCase();
const cooldownMs = Number(COOLDOWN_SEC) * 1000;

// Анти-спам: запоминаем время последнего ответа в каждом чате
const lastReplyAt = new Map();

function onCooldown(chatId) {
  const now = Date.now();
  const last = lastReplyAt.get(chatId) ?? 0;
  if (now - last < cooldownMs) return true;
  lastReplyAt.set(chatId, now);
  return false;
}

// Достаём команду после слова-триггера (триггер может быть где угодно в сообщении)
function extractCommand(text) {
  const idx = text.toLowerCase().indexOf(trigger);
  if (idx === -1) return null;
  const after = text.slice(idx + trigger.length).replace(/^[\s,!:.\-]+/, '').trim();
  // если после триггера пусто (написали просто "чанган") — отдаём весь текст
  return after || text.trim();
}

// Генерим ответку через самую дешёвую модель
async function generateReply({ userMessage, authorName, repliedText, repliedAuthor }) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  // Если это реплай на чужое сообщение — даём боту контекст ветки
  if (repliedText) {
    messages.push({
      role: 'user',
      content: `Контекст: ранее ${repliedAuthor || 'кто-то'} написал в чате: "${repliedText}"`,
    });
  }

  messages.push({
    role: 'user',
    content: `Сообщение от ${authorName || 'кого-то из чата'}: "${userMessage}"`,
  });

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 1,
    max_tokens: 120,
    messages,
  });
  return completion.choices[0]?.message?.content?.trim() || 'я завис, повтори';
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim() ?? '';
  if (!text.toLowerCase().includes(trigger)) return;

  if (onCooldown(ctx.chat.id)) return; // молча игнорим, чтобы не флудить

  const command = extractCommand(text);
  const authorName = ctx.message.from?.first_name;

  // контекст реплая, если есть
  const replied = ctx.message.reply_to_message;
  const repliedText = replied?.text || replied?.caption;
  const repliedAuthor = replied?.from?.first_name;

  try {
    await ctx.sendChatAction('typing');
    const reply = await generateReply({
      userMessage: command,
      authorName,
      repliedText,
      repliedAuthor,
    });
    await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id });
  } catch (err) {
    console.error('Ошибка генерации:', err);
    await ctx.reply('чанган перегрелся, дай отдышаться');
  }
});

bot.catch((err) => console.error('Telegraf error:', err));

// Мини HTTP-сервер, чтобы Railway видел открытый порт и не ругался
http
  .createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Chanган alive');
  })
  .listen(PORT, () => console.log(`Health server on :${PORT}`));

bot.launch(() =>
  console.log(`Бот запущен. Триггер: "${trigger}", модель: ${OPENAI_MODEL}, кулдаун: ${COOLDOWN_SEC}с`),
);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
