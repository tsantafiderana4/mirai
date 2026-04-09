import React, { useRef, useEffect } from 'react';
import { ChatMessage } from '../../types';
import { MessageItem } from './MessageItem';

interface Props {
    messages: ChatMessage[];
    speakingMessageId: string | null;
    isLoadingAudio: boolean;
    onPlayAudio: (text: string, id: string, cost: number) => void;
    onStopAudio: () => void;
    onExit: () => void;
}

export const MessageList: React.FC<Props> = ({ messages, speakingMessageId, isLoadingAudio, onPlayAudio, onStopAudio, onExit }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <div className="space-y-6">
            {messages.map((msg, idx) => (
                <MessageItem 
                    key={msg.id || idx} 
                    msg={msg} 
                    speakingMessageId={speakingMessageId}
                    isLoadingAudio={isLoadingAudio}
                    onPlayAudio={onPlayAudio}
                    onStopAudio={onStopAudio}
                    onExit={onExit}
                />
            ))}
            <div ref={scrollRef} className="h-4" />
        </div>
    );
};
