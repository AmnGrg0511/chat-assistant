import React from 'react';
import MonacoEditor from '@monaco-editor/react';

interface MonacoCodeBlockProps {
  code: string;
  language?: string;
}

const MonacoCodeBlock: React.FC<MonacoCodeBlockProps> = ({ code, language }) => {
  // Try to use the VSCode theme, fallback to 'vs-dark'
  // You can enhance this to detect the actual theme from VSCode if needed
  const theme = document.body.classList.contains('vscode-light') ? 'vs' : 'vs-dark';

  return (
    <div className="file-view">
      <MonacoEditor
        height="200px"
        defaultLanguage={language || 'plaintext'}
        value={code}
        theme={theme}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 14,
          lineNumbers: 'on',
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          folding: false,
          contextmenu: false,
        }}
      />
    </div>
  );
};

export default MonacoCodeBlock; 