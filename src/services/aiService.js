import { mockSuggestedPrompts, mockDefaultChatHistory, mockAiResponses } from '../data/aiChatData';

export const aiService = {
  async getSuggestedPrompts() {
    return mockSuggestedPrompts;
  },

  async getDefaultHistory() {
    return mockDefaultChatHistory;
  },

  async sendQuery(query, repoName = 'payment-service') {
    // Simulate streaming / thinking delay
    await new Promise(resolve => setTimeout(resolve, 600));

    // Check if we have a direct match or semantic keyword match
    for (const [key, val] of Object.entries(mockAiResponses)) {
      if (query.toLowerCase().includes(key.toLowerCase().slice(0, 15)) || key.toLowerCase().includes(query.toLowerCase().slice(0, 15))) {
        return {
          id: `msg-${Date.now()}`,
          sender: 'assistant',
          timestamp: 'Just now',
          text: val.text,
          citations: val.citations
        };
      }
    }

    // Default intelligent developer response
    return {
      id: `msg-${Date.now()}`,
      sender: 'assistant',
      timestamp: 'Just now',
      text: `### Analysis for: "${query}" in \`${repoName}\`

I analyzed the repository AST and dependency map regarding your question.

**Key Findings**:
- The subsystem correlates with \`src/api/payment.ts\` and \`src/auth/AuthService.ts\`.
- 3 dependent services call this layer with p99 latency currently tracking at 240ms.
- 1 open security alert (hardcoded credential in database pool) should be reviewed prior to major refactors.

\`\`\`typescript
// Relevant code path in src/api/payment.ts
export async function executeServiceCall(context: SecurityContext) {
  return await paymentGateway.verifyAndDispatch(context);
}
\`\`\`

Would you like me to generate a remediation patch or investigate dependent API routes?`,
      citations: [
        { name: 'payment.ts', path: 'src/api/payment.ts', line: 12 },
        { name: 'AuthService.ts', path: 'src/auth/AuthService.ts', line: 18 }
      ]
    };
  }
};
