import { readFile } from 'node:fs/promises';
import { sha256File } from './integrity.mjs';

export async function loadLoCoMo(datasetPath) {
  const raw = await readFile(datasetPath, 'utf8');
  const dataset = JSON.parse(raw);
  if (!dataset || !Array.isArray(dataset.conversations)) {
    throw new Error('LoCoMo dataset must have a conversations array');
  }
  return dataset;
}

export async function verifyDatasetHash(datasetPath, expectedHash) {
  const actual = await sha256File(datasetPath);
  if (actual !== expectedHash) {
    throw new Error(
      `Dataset hash mismatch: expected ${expectedHash}, got ${actual}. ` +
      'The dataset file has changed or is corrupted.'
    );
  }
  return actual;
}

export function verifyDatasetCommit(expectedCommit) {
  return expectedCommit;
}

export function getConversation(dataset, conversationId) {
  const conv = dataset.conversations.find(
    (c) => c.id === conversationId || c.conversation_id === conversationId
  );
  if (!conv) {
    throw new Error('Conversation ' + conversationId + ' not found in dataset');
  }
  return conv;
}

export function getConversationQAs(dataset, conversationId) {
  const qaList = dataset.qa_pairs || dataset.qa || [];
  return qaList.filter((qa) => {
    const cid = qa.conversation_id !== undefined
      ? qa.conversation_id : qa.conversationId;
    return Number(cid) === Number(conversationId);
  });
}

export function getSessions(conv) {
  const sessions = conv.sessions || conv.turns || [];
  return sessions.sort((a, b) => {
    const at = new Date(a.timestamp || a.created_at || a.date || 0).getTime();
    const bt = new Date(b.timestamp || b.created_at || b.date || 0).getTime();
    return at - bt;
  });
}
