import type { AIConversationStatus, AIMessage, PageContext } from "@/types/ai";
import { api } from "./api";

export interface SavedAIConversation {
  id: string;
  title: string;
  messages: AIMessage[];
  lastContext: PageContext | null;
  updatedAt: string;
  status: AIConversationStatus;
  blockReason: string | null;
}

export interface AIConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  status: AIConversationStatus;
  blockReason: string | null;
}

export async function getConversation(id: string): Promise<SavedAIConversation> {
  const conversation = await api.getAIConversation(id);
  return {
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages,
    lastContext: conversation.lastContext,
    updatedAt: conversation.updatedAt,
    status: conversation.status,
    blockReason: conversation.blockReason,
  };
}

export async function listConversations(limit?: number): Promise<AIConversationSummary[]> {
  const conversations = await api.listAIConversations();
  return conversations.slice(0, limit).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount,
    status: conversation.status,
    blockReason: conversation.blockReason,
  }));
}

export async function deleteConversation(id: string): Promise<void> {
  await api.deleteAIConversation(id);
}

export async function rollbackConversationToMessage(
  id: string,
  messageId: string
): Promise<{ message: AIMessage; conversation: SavedAIConversation }> {
  const result = await api.rollbackAIConversationToMessage(id, messageId);
  return {
    message: result.message,
    conversation: {
      id: result.conversation.id,
      title: result.conversation.title,
      messages: result.conversation.messages,
      lastContext: result.conversation.lastContext,
      updatedAt: result.conversation.updatedAt,
      status: result.conversation.status,
      blockReason: result.conversation.blockReason,
    },
  };
}
