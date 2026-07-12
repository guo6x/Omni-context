export const DEVELOPMENT_CONVERSATIONS = Object.freeze([1]);
export const HELDOUT_CONVERSATIONS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function assertConversationAllowed({ split, conversationId, heldoutAuthorization }) {
  const id = Number(conversationId);
  if (split === 'development') {
    if (!DEVELOPMENT_CONVERSATIONS.includes(id)) {
      throw new Error(`Conversation ${id} is not in the development split.`);
    }
    return;
  }
  if (split !== 'heldout' || !HELDOUT_CONVERSATIONS.includes(id)) {
    throw new Error(`Unknown benchmark split or conversation: ${split}/${conversationId}.`);
  }
  if (heldoutAuthorization !== 'Omni-Context Evaluation Freeze v1') {
    throw new Error('Held-out access denied until an explicit Evaluation Freeze v1 authorization is supplied.');
  }
}
