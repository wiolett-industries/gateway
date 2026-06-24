import type { AIMessage, PageContext } from "@/types/ai";
import { api } from "./api";

export interface SavedAIConversation {
  id: string;
  title: string;
  messages: AIMessage[];
  lastContext: PageContext | null;
  updatedAt: string;
}

export interface AIConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export async function saveConversation(
  name: string,
  messages: AIMessage[],
  lastContext?: PageContext | null
): Promise<SavedAIConversation> {
  const saved = await api.saveAIConversation(name, messages, lastContext);
  return {
    id: saved.id,
    title: saved.title,
    messages: saved.messages,
    lastContext: saved.lastContext ?? null,
    updatedAt: saved.updatedAt,
  };
}

export async function compactConversation(
  id: string,
  messages: AIMessage[],
  lastContext?: PageContext | null
): Promise<SavedAIConversation> {
  const saved = await api.updateAIConversation(id, { messages, lastContext });
  return {
    id: saved.id,
    title: saved.title,
    messages: saved.messages,
    lastContext: saved.lastContext ?? null,
    updatedAt: saved.updatedAt,
  };
}

export async function restoreConversation(name: string): Promise<SavedAIConversation | null> {
  const conversations = await api.listAIConversations();
  const match = conversations.find((conversation) => conversation.title === name);
  if (!match) return null;
  return getConversation(match.id);
}

export async function getConversation(id: string): Promise<SavedAIConversation> {
  const conversation = await api.getAIConversation(id);
  return {
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages,
    lastContext: conversation.lastContext,
    updatedAt: conversation.updatedAt,
  };
}

export async function listConversations(limit?: number): Promise<AIConversationSummary[]> {
  const conversations = await api.listAIConversations();
  return conversations.slice(0, limit).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount,
  }));
}

export async function dropConversation(name: string): Promise<void> {
  await api.deleteAIConversationByTitle(name);
}

export async function deleteConversation(id: string): Promise<void> {
  await api.deleteAIConversation(id);
}
