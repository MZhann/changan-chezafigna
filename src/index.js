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
  PORT = 3000,
} = process.env;

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в переменных окружения');
if (!OPENAI_API_KEY) throw new Error('Нет OPENAI_API_KEY в переменных окружения');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const bot = new Telegraf(BOT_TOKEN);

const trigger = TRIGGER.toLowerCase();

// Генерим ответку через самую дешёвую модель
async function generateReply(userMessage, authorName) {
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 1,
    max_tokens: 120,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Сообщение от ${authorName || 'кого-то из чата'}: "${userMessage}"`,
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() || 'я завис, повтори';
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim() ?? '';
  if (!text.toLowerCase().startsWith(trigger)) return;

  // убираем слово-триггер из начала, оставляем саму команду/вопрос
  const command = text.slice(trigger.length).replace(/^[\s,!:.\-]+/, '').trim();
  const authorName = ctx.message.from?.first_name;

  try {
    await ctx.sendChatAction('typing');
    const reply = await generateReply(command || text, authorName);
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

bot.launch(() => console.log(`Бот запущен. Триггер: "${trigger}", модель: ${OPENAI_MODEL}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
