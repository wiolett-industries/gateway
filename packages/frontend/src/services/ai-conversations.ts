import type { AIMessage } from "@/types/ai";
import { api } from "./api";

export async function saveConversation(name: string, messages: AIMessage[]): Promise<void> {
  await api.saveAIConversation(name, messages);
}

export async function restoreConversation(name: string): Promise<AIMessage[] | null> {
  const conversations = await api.listAIConversations();
  const match = conversations.find((conversation) => conversation.title === name);
  if (!match) return null;
  const conversation = await api.getAIConversation(match.id);
  return conversation.messages;
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
