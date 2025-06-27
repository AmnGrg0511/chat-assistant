import React, { useEffect, useState } from 'react';
import { createHighlighter } from 'shiki';

interface ShikiCodeBlockProps {
  code: string;
  lang: string;
  theme: string;
}

const ShikiCodeBlock: React.FC<ShikiCodeBlockProps> = ({ code, lang = 'jsx', theme = 'github-dark' }) => {
  const [html, setHtml] = useState('');

  useEffect(() => {
    const highlight = async () => {
      const highlighter = await createHighlighter({
        themes: [theme],
        langs: [lang],
      });
      const newHtml = highlighter.codeToHtml(code, {
        lang,
        theme,
      });
      setHtml(newHtml);
    };

    highlight();
  }, [code, lang, theme]);

  if (!html) return <div>Loading...</div>;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

export default ShikiCodeBlock;
