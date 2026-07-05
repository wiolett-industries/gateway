DELETE FROM "ai_conversation_search_documents"
WHERE "kind" IN ('tool_call', 'tool_result', 'window') OR "role" = 'tool';
