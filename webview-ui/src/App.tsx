import { useState, useRef, useEffect } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import './App.css';
import { marked } from 'marked';
import ShikiCodeBlock from './components/ShikiCodeBlock';
import AutoResizeTextarea from './components/AutoResizeTextarea';

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  // Instead of returning HTML, return a placeholder for MonacoCodeBlock
  // We'll replace this placeholder in renderMarkdown
  const encoded = encodeURIComponent(JSON.stringify({ code: text, language: lang }));
  return `<div data-shiki-code-block="${encoded}"></div>`;
};
marked.setOptions({ renderer });

interface ChatMessage {
  sender: 'user' | 'assistant';
  content: string;
}

interface VSCodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (newState: unknown) => void;
}

// Acquire the VSCode API object once
const vscode: VSCodeApi | undefined = (window as { acquireVsCodeApi?: () => VSCodeApi }).acquireVsCodeApi?.();

// Helper to split file path into name and parent folder
function splitFilePath(path: string) {
  const parts = path.replace(/\\/g, '/').split('/');
  const name = parts.pop() || '';
  const folder = parts.join('/') || '';
  return { name, folder };
}

function debounce<T extends (...args: any[]) => void>(func: T, delay: number) {
  let timeout: NodeJS.Timeout;
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [fileList, setFileList] = useState<{ [relative: string]: string }>({});
  const [selFiles, setSelFiles] = useState<{ [relative: string]: string }>({});
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [theme, setTheme] = useState(() => {
    const metaTag = document.querySelector('meta[name="vscode-theme"]');
    return metaTag ? metaTag.getAttribute('content') || 'vs-dark' : 'vs-dark';
  });

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for messages from the extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'assistant-reply') {
        setMessages((msgs) => [...msgs, { sender: 'assistant', content: event.data.content }]);
      } else if (event.data && event.data.type === 'workspace-files') {
        setFileList(event.data.files);
      } else if (event.data && event.data.type === 'set-theme') {
        setTheme(event.data.theme);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Send message to extension
  const sendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setMessages((msgs) => [...msgs, { sender: 'user', content: input }]);

    // Extract file tokens and resolve to absolute paths
    const attachments: string[] = [];
    let cleanedInput = input;
    for (const relativePath of Object.keys(selFiles)) {
      const token = `@${relativePath}`;
      if (cleanedInput.includes(token)) {
        attachments.push(selFiles[relativePath]);
        cleanedInput = cleanedInput.replace(token, ''); // Remove the token from the message
      }
    }

    // Send to extension
    if (vscode) {
      vscode.postMessage({
        type: 'user-message',
        content: cleanedInput.trim(),
        attachments,
      });
    }
    setInput('');
  };

  // Dropdown keyboard navigation
  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const files = Object.keys(fileList);
    if (showFileDropdown && files.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIdx(idx => (idx + 1) % files.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIdx(idx => (idx - 1 + files.length) % files.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleFileSelect(files[selectedFileIdx], fileList[files[selectedFileIdx]]);
      } else if (e.key === 'Escape') {
        setShowFileDropdown(false);
      }
    }
  };

  // Insert @filename at cursor position
  const handleFileSelect = (filename: string, path: string) => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    const cursorPos = el.selectionStart || 0;
    const atIdx = input.lastIndexOf('@', cursorPos - 1);
    if (atIdx === -1) return;
    // Replace from @ to cursor with @filename (relative path)
    const before = input.slice(0, atIdx + 1);
    const after = input.slice(cursorPos);
    const newValue = before + filename + ' ' + after;
    setInput(newValue);
    setShowFileDropdown(false);
    setSelFiles(files => {return {...files, [filename]: path}});
  };

  // Request file list when user types '@' or types after '@'
  const debouncedGetWorkspaceFiles = useRef(debounce((query: string) => {
    if (vscode)
      vscode.postMessage({ type: 'get-workspace-files', query });
  }, 300)).current;

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart || value.length;
    const atIdx = value.lastIndexOf('@', cursor - 1);
    if (atIdx !== -1) {
      const afterAt = value.slice(atIdx + 1, cursor);
      setShowFileDropdown(true);
      debouncedGetWorkspaceFiles(afterAt);
      setSelectedFileIdx(0);
      return;
    }
    setShowFileDropdown(false);
  };

  // Helper to render chat message with MonacoCodeBlock
  const renderChatMessage = (msg: ChatMessage, idx: number) => {
    if (msg.sender === 'user') {
      return <div key={idx} className={`chat-message user`}>{msg.content}</div>;
    }
    // For assistant, parse the HTML and replace Shiki placeholders
    const rawHtml = marked.parse(msg.content) as string;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawHtml;
    const nodes: React.ReactNode[] = [];
    tempDiv.childNodes.forEach((node, i) => {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.shikiCodeBlock) {
        const { code, language } = JSON.parse(decodeURIComponent((node as HTMLElement).dataset.shikiCodeBlock!));
        nodes.push(<ShikiCodeBlock key={i} code={code} lang={language} theme={theme} />);
      } else {
        if (node instanceof HTMLElement) {
          nodes.push(<span key={i} dangerouslySetInnerHTML={{ __html: node.outerHTML }} />);
        } else {
          nodes.push(<span key={i}>{node.textContent}</span>);
        }
      }
    });
    return <div key={idx} className="chat-message assistant">{nodes}</div>;
  };

  return (
    <div className="chat-container">
      <div className="chat-history">
        {messages.map((msg, idx) => renderChatMessage(msg, idx))}
        <div ref={chatEndRef} />
      </div>
      <div className="chat-input-bar">
        <form className="chat-input" onSubmit={sendMessage} style={{ position: 'relative', width: '100%' }}>
          {showFileDropdown && Object.keys(fileList).length > 0 && (
            <div className="file-dropdown file-dropdown-above">
              {Object.keys(fileList).map((file, idx) => {
                const { name, folder } = splitFilePath(file);
                return (
                  <div
                    key={file}
                    className={idx === selectedFileIdx ? 'selected' : ''}
                    onMouseDown={e => { e.preventDefault(); handleFileSelect(file, fileList[file]); }}
                    onMouseEnter={() => setSelectedFileIdx(idx)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ fontWeight: 500 }}>{name}</span>
                    {folder && <span style={{ color: 'var(--vscode-descriptionForeground, #888)', fontSize: '0.95em', marginLeft: 12 }}>{folder}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <AutoResizeTextarea
            ref={inputRef}
            value={input}
            minRows={1}
            maxRows={5}
            autoFocus
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a message..."
            autoComplete="off"
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  );
}

export default App;
