import type { AIMessage, PageContext } from "@/types/ai";
import { api } from "./api";

export interface SavedAIConversation {
  id: string;
  title: string;
  messages: AIMessage[];
  lastContext: PageContext | null;
  updatedAt: string;
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

export async function restoreConversation(name: string): Promise<SavedAIConversation | null> {
  const conversations = await api.listAIConversations();
  const match = conversations.find((conversation) => conversation.title === name);
  if (!match) return null;
  const conversation = await api.getAIConversation(match.id);
  return {
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages,
    lastContext: conversation.lastContext,
    updatedAt: conversation.updatedAt,
  };
}

export async function listConversations(): Promise<Array<{ name: string; savedAt: string }>> {
  const conversations = await api.listAIConversations();
  return conversations.map((conversation) => ({
    name: conversation.title,
    savedAt: conversation.updatedAt,
  }));
}

export async function dropConversation(name: string): Promise<void> {
  await api.deleteAIConversationByTitle(name);
}
