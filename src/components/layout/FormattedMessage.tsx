import type { CSSProperties } from "react";
import type { OutputMessage, OutputMessageTextStyle } from "../../types/timer";
import { cn } from "../../lib/utils";

type FormattedMessageProps = {
  message: OutputMessage;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
};

const defaultTitleStyle: OutputMessageTextStyle = {
  bold: false,
  italic: false,
  color: "#ffffff",
};

const defaultBodyStyle: OutputMessageTextStyle = {
  bold: true,
  italic: false,
  color: "#ffffff",
};

export function FormattedMessage({ message, className, titleClassName, bodyClassName }: FormattedMessageProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <MessageText
        text={message.title}
        textStyle={message.formatting?.title ?? defaultTitleStyle}
        className={cn("whitespace-pre-wrap break-words", titleClassName)}
      />
      <MessageText
        text={message.body}
        textStyle={message.formatting?.body ?? defaultBodyStyle}
        className={cn("mt-2 whitespace-pre-wrap break-words", bodyClassName)}
      />
    </div>
  );
}

function MessageText({ text, textStyle, className }: { text: string; textStyle: OutputMessageTextStyle; className?: string }) {
  const style: CSSProperties = {
    color: textStyle.color || undefined,
    fontStyle: textStyle.italic ? "italic" : undefined,
    fontWeight: textStyle.bold ? 800 : undefined,
  };

  return (
    <div className={className} style={style}>
      {text}
    </div>
  );
}
