import { z } from 'zod';

export const ASK_QUERY_MAX_CHARS = 8_000;
export const ASK_MESSAGE_MAX_CHARS = 4_000;
export const ASK_MESSAGES_MAX_ITEMS = 8;
// The per-message and count limits together guarantee this aggregate ceiling.
export const ASK_HISTORY_MAX_CHARS = ASK_MESSAGE_MAX_CHARS * ASK_MESSAGES_MAX_ITEMS;

export const AskMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(ASK_MESSAGE_MAX_CHARS, `单条对话不能超过 ${ASK_MESSAGE_MAX_CHARS} 个字符`),
});

export const AskMessagesSchema = z.array(AskMessageSchema)
  .max(ASK_MESSAGES_MAX_ITEMS, `对话最多保留 ${ASK_MESSAGES_MAX_ITEMS} 条消息`);

const AskQuestionSchema = z.string().trim()
  .min(1, '必须提供非空的问题')
  .max(ASK_QUERY_MAX_CHARS, `问题不能超过 ${ASK_QUERY_MAX_CHARS} 个字符`);

export type AskMessage = z.infer<typeof AskMessageSchema>;

export interface ResolvedAskTurn {
  messages: AskMessage[];
  question: string;
}

/** Shared, side-effect-free history validation and question fallback for Ask tools. */
export function resolveAskTurn(query: unknown, rawMessages: unknown): ResolvedAskTurn {
  const messages = AskMessagesSchema.parse(rawMessages ?? []);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestUserQuestion = latestUserMessage?.content.trim() || '';
  const question = AskQuestionSchema.parse(
    latestUserQuestion || (typeof query === 'string' ? query : ''),
  );
  if (latestUserQuestion) return { messages, question };

  // A query fallback is also the current turn, not merely a retrieval hint.
  // Append it so assistant-only/blank-user history cannot reach the provider
  // without the user's actual question. Keep the effective prompt within the
  // same eight-message window used by the provider calls.
  const history = latestUserMessage
    ? messages.filter((message) => message !== latestUserMessage)
    : messages;
  return {
    messages: [
      ...history.slice(-(ASK_MESSAGES_MAX_ITEMS - 1)),
      { role: 'user', content: question },
    ],
    question,
  };
}
