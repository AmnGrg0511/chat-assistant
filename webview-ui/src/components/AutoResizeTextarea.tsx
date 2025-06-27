import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type TextareaHTMLAttributes,
  type ChangeEvent,
} from 'react';

interface AutoResizeTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  maxRows?: number;
}

const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ value, onChange, minRows = 1, maxRows, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    // Expose the inner ref to parent components
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    useEffect(() => {
      const textarea = innerRef.current;
      if (!textarea) return;

      textarea.style.height = 'auto';

      const computed = getComputedStyle(textarea);
      const lineHeight = parseFloat(computed.lineHeight);
      const paddingOffset = textarea.offsetHeight - textarea.clientHeight;

      let newHeight = textarea.scrollHeight;

      if (minRows) {
        const minHeight = lineHeight * minRows + paddingOffset;
        newHeight = Math.max(newHeight, minHeight);
      }

      if (maxRows) {
        const maxHeight = lineHeight * maxRows + paddingOffset;
        newHeight = Math.min(newHeight, maxHeight);
      }

      textarea.style.height = `${newHeight}px`;
    }, [value, minRows, maxRows]);

    return (
      <textarea
        ref={innerRef}
        value={value}
        onChange={onChange}
        rows={minRows}
        {...props}
        style={{
          overflow: 'auto',
          resize: 'none',
          width: '100%',
          fontSize: '16px',
          lineHeight: '1.5',
          ...props.style,
        }}
      />
    );
  }
);

export default AutoResizeTextarea;
