import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { aiService } from '../../services/aiService';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
  FileCode,
  CornerDownLeft,
  X,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function AIChat({ isEmbedded = false, onCitationClick }) {
  const { currentRepo } = useApp();
  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function init() {
      const history = await aiService.getDefaultHistory();
      const prompts = await aiService.getSuggestedPrompts();
      setMessages(history);
      setSuggestedPrompts(prompts);
    }
    init();
  }, [currentRepo.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (queryText) => {
    const text = queryText || inputQuery;
    if (!text.trim() || isLoading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: 'Just now',
      text: text.trim(),
      citations: []
    };

    setMessages(prev => [...prev, userMessage]);
    setInputQuery('');
    setIsLoading(true);

    try {
      const response = await aiService.sendQuery(text, currentRepo.name);
      setMessages(prev => [...prev, response]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleJumpToFile = (path) => {
    if (onCitationClick) {
      onCitationClick(path);
    } else {
      navigate('/code');
    }
  };

  // Simple Markdown Formatter for Assistant Responses
  const renderFormattedContent = (content) => {
    const lines = content.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer = [];
    let tableBuffer = [];
    let inTable = false;

    lines.forEach((line, idx) => {
      // Code block toggle
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          const codeText = codeBuffer.join('\n');
          const blockId = `code-${idx}`;
          elements.push(
            <div key={`code-block-${idx}`} className="my-3 rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden font-mono text-xs">
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                <span>{codeLanguage || 'code'}</span>
                <button
                  onClick={() => handleCopy(codeText, blockId)}
                  className="flex items-center gap-1 hover:text-zinc-200 text-zinc-400 transition-colors"
                >
                  {copiedId === blockId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedId === blockId ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="p-3 overflow-x-auto text-cyan-200/90 leading-relaxed font-mono">
                <code>{codeText}</code>
              </pre>
            </div>
          );
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLanguage = line.replace('```', '').trim();
        }
        return;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        return;
      }

      // Markdown Table Handling
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableBuffer = [];
        }
        tableBuffer.push(line);
        return;
      } else if (inTable) {
        inTable = false;
        elements.push(renderTable(tableBuffer, `table-${idx}`));
        tableBuffer = [];
      }

      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h4 key={idx} className="text-sm font-bold text-zinc-100 mt-3 mb-1.5">
            {line.replace('### ', '')}
          </h4>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h3 key={idx} className="text-base font-bold text-zinc-100 mt-4 mb-2">
            {line.replace('## ', '')}
          </h3>
        );
      } else if (line.startsWith('- ')) {
        elements.push(
          <li key={idx} className="text-xs text-zinc-300 ml-4 list-disc my-0.5">
            {renderInlineMarkdown(line.replace('- ', ''))}
          </li>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <div key={idx} className="my-2 p-2.5 rounded-md border border-amber-800/40 bg-amber-950/20 text-xs text-amber-200/90">
            {renderInlineMarkdown(line.replace('> ', ''))}
          </div>
        );
      } else if (line.trim() !== '') {
        elements.push(
          <p key={idx} className="text-xs text-zinc-300 my-1 leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>
        );
      }
    });

    if (inTable && tableBuffer.length > 0) {
      elements.push(renderTable(tableBuffer, 'table-end'));
    }

    return elements;
  };

  const renderTable = (rows, key) => {
    const parsed = rows.map(r => r.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim()));
    if (parsed.length < 2) return null;
    const headers = parsed[0];
    const dataRows = parsed.slice(2);

    return (
      <div key={key} className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900 text-zinc-400 font-medium border-b border-zinc-800">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="py-2 px-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px]">
            {dataRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-zinc-900/30">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="py-2 px-3 text-zinc-300">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderInlineMarkdown = (text) => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={i} className="px-1 py-0.2 rounded bg-zinc-800 text-cyan-300 font-mono text-[11px] border border-zinc-750">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-zinc-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 text-left ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-md bg-cyan-950 border border-cyan-800/70 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
                  <Bot size={15} />
                </div>
              )}

              <div
                className={`max-w-[88%] rounded-xl p-3.5 ${
                  isUser
                    ? 'bg-cyan-950/60 border border-cyan-800/70 text-zinc-100'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-md'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5 text-[10px] font-mono text-zinc-400">
                  <span className="font-semibold">{isUser ? 'You' : 'GitLab AI'}</span>
                  <span>{msg.timestamp}</span>
                </div>

                <div className="font-sans text-xs">
                  {isUser ? msg.text : renderFormattedContent(msg.text)}
                </div>

                {/* File Citations if any */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-zinc-800 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                      Citations:
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <button
                        key={cIdx}
                        onClick={() => handleJumpToFile(cite.path)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-750 text-cyan-300 font-mono text-[11px] border border-zinc-700 transition-colors"
                      >
                        <FileCode size={11} />
                        <span>{cite.name}:{cite.line}</span>
                        <ChevronRight size={10} className="opacity-50" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0 mt-0.5">
                  <User size={14} />
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-3 items-start justify-start">
            <div className="w-7 h-7 rounded-md bg-cyan-950 border border-cyan-800/70 flex items-center justify-center text-cyan-400 shrink-0">
              <Sparkles size={14} className="animate-spin text-cyan-400" />
            </div>
            <div className="rounded-xl p-3.5 bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>Analyzing AST and reasoning across {currentRepo.name}...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompt Pills */}
      {messages.length < 3 && (
        <div className="px-4 py-2 bg-zinc-950/80 border-t border-zinc-850">
          <div className="text-[11px] font-mono text-zinc-400 mb-1.5">Suggested Prompts:</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestedPrompts.slice(0, 3).map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt)}
                className="text-left text-xs px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 hover:border-cyan-700 hover:text-cyan-300 text-zinc-300 transition-colors font-sans"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Composer */}
      <div className="p-3 border-t border-zinc-850 bg-zinc-900/60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={`Ask GitLab AI about ${currentRepo.name}...`}
            className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 text-xs rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-cyan-500 font-sans"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isLoading}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        </form>
        <div className="flex items-center justify-between mt-2 px-1 text-[10px] font-mono text-zinc-400">
          <span>Context: {currentRepo.name} (main)</span>
          <span>Indexed: 284 files</span>
        </div>
      </div>
    </div>
  );
}

export function AIChatPanel() {
  const { isAiPanelOpen, toggleAiPanel, currentRepo } = useApp();

  if (!isAiPanelOpen) return null;

  return (
    <aside className="fixed top-14 right-0 bottom-0 z-40 w-full sm:w-[380px] md:w-[420px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800 bg-zinc-900/70">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-100 font-mono">GitLab Copilot AI</div>
            <div className="text-[10px] text-zinc-400 font-mono truncate">{currentRepo.name}</div>
          </div>
        </div>

        <button
          onClick={toggleAiPanel}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          aria-label="Close panel"
        >
          <X size={15} />
        </button>
      </div>

      {/* Chat Body */}
      <div className="flex-1 overflow-hidden">
        <AIChat isEmbedded={true} />
      </div>
    </aside>
  );
}
